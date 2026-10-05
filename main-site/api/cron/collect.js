// Run by Vercel Cron every five minutes (vercel.json). Stores the latest PSI, PM2.5 and
// wind from data.gov.sg in Supabase for the Trends and Wind charts, then sends PSI alerts
// for any band that changed.
//
// - PSI and PM2.5: one row per reading hour, overwritten when NEA revises it.
// - Wind: the first reading seen in each hour, so a snapshot per hour.
// - Backfill: at the top of each hour, or whenever the last week is empty, any SGT day
//   in the last seven with hours missing is fetched whole from data.gov.sg. That fills
//   the charts on the first run and patches over outages. Wind is not backfilled: a day
//   of it is dozens of pages.
//
// Supabase and the alerts are independent: either works without the other set up.

import { byRegion, day, latest, psiReadings, sgDate, windStations } from "../_lib/datagov.js";
import { T, rest, supabaseConfigured, upsert } from "../_lib/supabase.js";
import { notifyPsi, pushConfigured } from "../_push/notify.js";
import { releaseLock, storeConfigured, takeLock } from "../_push/store.js";

const DAY_MS = 24 * 3600 * 1000;
const BACKFILL_DAYS = 7;
// A day with at least this many hours stored is left alone; NEA skips the odd hour.
const FULL_DAY_HOURS = 22;
// Longer than a run ever takes, shorter than the five minutes between them.
const LOCK_SECONDS = 240;

const psiRow = (item) => ({ reading_at: item.timestamp, psi: psiReadings(item), psi_updated_at: item.updatedTimestamp });
const pm25Row = (item) => ({
  reading_at: item.timestamp,
  pm25: byRegion(item.readings?.pm25_one_hourly),
  pm25_updated_at: item.updatedTimestamp,
});
const hasRegions = (row, key) => Object.keys(row[key] || {}).length > 0;

export default async function handler(req, res) {
  // Vercel Cron sends CRON_SECRET as a bearer token; nobody else can make the server collect.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const locked = storeConfigured();
  if (locked && !(await takeLock("collect", LOCK_SECONDS))) {
    return res.status(200).json({ skipped: "a run is already going" });
  }
  try {
    return res.status(200).json(await collect());
  } catch (err) {
    console.error("collect failed:", err);
    return res.status(500).json({ error: "collect failed" });
  } finally {
    if (locked) await releaseLock("collect").catch(() => {});
  }
}

async function collect() {
  const [psi, pm25, speed, direction] = await Promise.allSettled([
    latest("psi"),
    latest("pm25"),
    latest("wind-speed"),
    latest("wind-direction"),
  ]);
  for (const [name, r] of Object.entries({ psi, pm25, speed, direction })) {
    if (r.status === "rejected") console.warn(`collect: ${name} failed:`, r.reason?.message ?? r.reason);
  }
  const psiItem = psi.status === "fulfilled" ? psi.value.items?.[0] : null;
  const pm25Item = pm25.status === "fulfilled" ? pm25.value.items?.[0] : null;

  const result = { stored: null, backfilled: null, alerts: null };

  if (supabaseConfigured) {
    try {
      result.stored = await store(psiItem, pm25Item, speed, direction);
      result.backfilled = await backfill();
    } catch (err) {
      console.error("collect: Supabase failed:", err.message);
      result.stored = { error: err.message };
    }
  } else {
    result.stored = "Supabase is not set up";
  }

  if (!pushConfigured()) {
    result.alerts = "PSI alerts are not set up";
  } else if (psiItem) {
    try {
      result.alerts = await notifyPsi(psiItem);
    } catch (err) {
      console.error("collect: alerts failed:", err);
      result.alerts = { error: err.message };
    }
  }

  return result;
}

async function store(psiItem, pm25Item, speed, direction) {
  const out = { psi: false, pm25: false, wind: false };

  // Separate calls: each upsert overwrites only the columns it sends, and PM2.5 can be
  // for a different hour than PSI.
  const p = psiItem && psiRow(psiItem);
  if (p && hasRegions(p, "psi")) {
    await upsert(T.readings, [p], { onConflict: "reading_at" });
    out.psi = p.reading_at;
  }
  const m = pm25Item && pm25Row(pm25Item);
  if (m && hasRegions(m, "pm25")) {
    await upsert(T.readings, [m], { onConflict: "reading_at" });
    out.pm25 = m.reading_at;
  }

  if (speed.status === "fulfilled" && direction.status === "fulfilled") {
    const stations = windStations(speed.value, direction.value);
    const time = speed.value.readings?.[0]?.timestamp;
    if (stations.length && time) {
      const hour = new Date(time);
      hour.setUTCMinutes(0, 0, 0);
      // ignore: the hour's first snapshot stays; later runs in the same hour change nothing.
      await upsert(T.wind, [{
        observed_at: hour.toISOString(),
        reading_at: time,
        speed: Object.fromEntries(stations.map((s) => [s.id, s.speed])),
        direction: Object.fromEntries(stations.map((s) => [s.id, s.direction])),
      }], { onConflict: "observed_at", ignore: true });
      await upsert(T.stations, stations.map((s) => ({
        id: s.id, name: s.name, latitude: s.lat, longitude: s.lng, seen_at: new Date().toISOString(),
      })), { onConflict: "id" });
      out.wind = hour.toISOString();
    }
  }
  return out;
}

async function backfill() {
  const since = Date.now() - BACKFILL_DAYS * DAY_MS;
  const rows = await rest("GET", T.readings, {
    // psi is keyed by reading then region, pm25 by region: probe one value of each.
    params: {
      select: "reading_at,has_psi:psi->psi_twenty_four_hourly->north,has_pm25:pm25->north",
      reading_at: `gte.${new Date(since).toISOString()}`,
      limit: "1000",
    },
  });

  // Hourly, at the first run past the hour, unless there's nothing at all: then now.
  if (rows.length && new Date().getUTCMinutes() >= 5) return null;

  const psiHours = {};
  const pm25Hours = {};
  for (const r of rows) {
    const d = sgDate(Date.parse(r.reading_at));
    if (r.has_psi != null) psiHours[d] = (psiHours[d] || 0) + 1;
    if (r.has_pm25 != null) pm25Hours[d] = (pm25Hours[d] || 0) + 1;
  }

  const today = sgDate(Date.now());
  // Today counts only the hours gone so far, less one NEA may not have published yet.
  const expected = (d) => (d === today ? Math.max(0, new Date(Date.now() + 8 * 3600 * 1000).getUTCHours() - 1) : FULL_DAY_HOURS);
  const dates = [];
  for (let i = BACKFILL_DAYS; i >= 0; i--) dates.push(sgDate(Date.now() - i * DAY_MS));

  const feeds = [
    { path: "psi", hours: psiHours, toRow: psiRow, key: "psi" },
    { path: "pm25", hours: pm25Hours, toRow: pm25Row, key: "pm25" },
  ];
  const filled = { psi: [], pm25: [] };
  for (const d of dates) {
    for (const { path, hours, toRow, key } of feeds) {
      if ((hours[d] || 0) >= expected(d)) continue;
      let items = [];
      try {
        items = await day(path, d);
      } catch (err) {
        // The next hour's run tries again.
        console.warn(`backfill ${path} ${d}:`, err.message);
      }
      const fresh = items.map(toRow).filter((r) => hasRegions(r, key));
      await upsert(T.readings, fresh, { onConflict: "reading_at" });
      if (fresh.length) filled[key].push(d);
    }
  }
  return filled;
}
