// Run by Vercel Cron every five minutes (vercel.json). Stores the latest PSI, PM2.5 and
// wind from data.gov.sg in Supabase for the Trends and Wind charts, then sends PSI alerts
// for any band that changed.
//
// - PSI and PM2.5: one row per reading hour, overwritten when NEA revises it.
// - Wind: the first reading seen in each hour, so a snapshot per hour.
// - Backfill: every quarter hour, or whenever the last week is empty, SGT days in the
//   last seven with hours missing are fetched whole from data.gov.sg, newest first. That
//   fills the charts after the first few runs and patches over outages. data.gov.sg
//   refuses bursts (429), so each run asks for a few days at most, paced, and stops at
//   the first refusal; the next quarter hour carries on.
// - Wind backfill: the same, an hour at a time. A whole day of wind is dozens of pages,
//   but data.gov.sg answers a single moment with the one reading then, so each missing
//   hour is two requests: speed and direction.
//
// Supabase and the alerts are independent: either works without the other set up.

import { RateLimited, at, byRegion, day, latest, psiReadings, sgDate, sgMoment, windStations } from "../_lib/datagov.js";
import { T, rest, supabaseConfigured, upsert } from "../_lib/supabase.js";
import { notifyPsi, pushConfigured } from "../_push/notify.js";
import { releaseLock, storeConfigured, takeLock } from "../_push/store.js";

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const BACKFILL_DAYS = 7;
// A day with at least this many hours stored is left alone; NEA skips the odd hour.
const FULL_DAY_HOURS = 22;
// Longer than a run ever takes, shorter than the five minutes between them.
const LOCK_SECONDS = 240;
// Day fetches per run, and the pause before each: enough to fill a missing week within
// the hour without data.gov.sg turning the run away.
const BACKFILL_PER_RUN = 4;
// Measured: one request every 3 s goes through keyless, while the run's four live
// calls plus two quick day fetches get a 429.
const BACKFILL_GAP_MS = 4000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const psiRow = (item) => ({ reading_at: item.timestamp, psi: psiReadings(item), psi_updated_at: item.updatedTimestamp });
const pm25Row = (item) => ({
  reading_at: item.timestamp,
  pm25: byRegion(item.readings?.pm25_one_hourly),
  pm25_updated_at: item.updatedTimestamp,
});
const hasRegions = (row, key) => Object.keys(row[key] || {}).length > 0;

// One hour's wind snapshot from a speed and a direction answer, or null if they share no
// station. Stored under the hour it falls in.
function windRow(speedData, directionData) {
  const stations = windStations(speedData, directionData);
  const time = speedData?.readings?.[0]?.timestamp;
  if (!stations.length || !time) return null;
  const hour = new Date(time);
  hour.setUTCMinutes(0, 0, 0);
  return {
    stations,
    row: {
      observed_at: hour.toISOString(),
      reading_at: time,
      speed: Object.fromEntries(stations.map((s) => [s.id, s.speed])),
      direction: Object.fromEntries(stations.map((s) => [s.id, s.direction])),
    },
  };
}

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

  const result = { stored: null, backfilled: null, windBackfilled: null, alerts: null };

  if (supabaseConfigured) {
    try {
      result.stored = await store(psiItem, pm25Item, speed, direction);
      result.backfilled = await backfill();
      // Not straight after a refusal: data.gov.sg would only turn this away too.
      result.windBackfilled = result.backfilled?.limited ? "skipped: data.gov.sg refused the PSI backfill" : await backfillWind();
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

  const wind = speed.status === "fulfilled" && direction.status === "fulfilled" ? windRow(speed.value, direction.value) : null;
  if (wind) {
    // ignore: the hour's first snapshot stays; later runs in the same hour change nothing.
    await upsert(T.wind, [wind.row], { onConflict: "observed_at", ignore: true });
    await upsert(T.stations, wind.stations.map((s) => ({
      id: s.id, name: s.name, latitude: s.lat, longitude: s.lng, seen_at: new Date().toISOString(),
    })), { onConflict: "id" });
    out.wind = wind.row.observed_at;
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

  // Every quarter hour, at the first run past it, unless there's nothing at all: then now.
  if (rows.length && new Date().getUTCMinutes() % 15 >= 5) return null;

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
  // Newest first: the days a reader sees first on the chart.
  const dates = [];
  for (let i = 0; i <= BACKFILL_DAYS; i++) dates.push(sgDate(Date.now() - i * DAY_MS));

  const feeds = [
    { path: "psi", hours: psiHours, toRow: psiRow, key: "psi" },
    { path: "pm25", hours: pm25Hours, toRow: pm25Row, key: "pm25" },
  ];
  const todo = dates.flatMap((d) => feeds.filter((f) => (f.hours[d] || 0) < expected(d)).map((f) => ({ d, ...f })));

  const filled = { psi: [], pm25: [] };
  let done = 0;
  let limited = false;
  for (const { d, path, toRow, key } of todo.slice(0, BACKFILL_PER_RUN)) {
    // A pause first, after the live readings this run has just asked for too.
    await sleep(BACKFILL_GAP_MS);
    let items;
    try {
      items = await day(path, d, { retries: 1 });
    } catch (err) {
      console.warn(`backfill ${path} ${d}:`, err.message);
      // Turned away: asking for the rest now would only be turned away too.
      if (err instanceof RateLimited) {
        limited = true;
        break;
      }
      done++;
      continue;
    }
    done++;
    const fresh = items.map(toRow).filter((r) => hasRegions(r, key));
    await upsert(T.readings, fresh, { onConflict: "reading_at" });
    if (fresh.length) filled[key].push(d);
  }
  // For the cron's log: how many day fetches the next quarter hour picks up.
  return { ...filled, left: todo.length - done, limited };
}

// Every hour in the last week with no wind snapshot, newest first, two at a time: the
// same pace as the PSI backfill, two requests an hour. The hour still going is left to
// the live snapshot.
async function backfillWind() {
  const now = Date.now();
  const thisHour = Math.floor(now / HOUR_MS) * HOUR_MS;
  const since = thisHour - BACKFILL_DAYS * DAY_MS;
  const rows = await rest("GET", T.wind, {
    params: { select: "observed_at", observed_at: `gte.${new Date(since).toISOString()}`, limit: "1000" },
  });

  // Every quarter hour, at the first run past it, unless there's nothing at all: then now.
  if (rows.length && new Date().getUTCMinutes() % 15 >= 5) return null;

  const have = new Set(rows.map((r) => Date.parse(r.observed_at)));
  const missing = [];
  for (let t = thisHour - HOUR_MS; t >= since; t -= HOUR_MS) if (!have.has(t)) missing.push(t);

  const filled = [];
  let done = 0;
  for (const hour of missing.slice(0, BACKFILL_PER_RUN / 2)) {
    const moment = sgMoment(hour);
    let wind;
    try {
      await sleep(BACKFILL_GAP_MS);
      const speed = await at("wind-speed", moment, { retries: 1 });
      await sleep(BACKFILL_GAP_MS);
      const direction = await at("wind-direction", moment, { retries: 1 });
      wind = windRow(speed, direction);
    } catch (err) {
      console.warn(`backfill wind ${moment}:`, err.message);
      if (err instanceof RateLimited) break;
      done++;
      continue;
    }
    done++;
    // The reading data.gov.sg had at that moment can be from a minute or two before,
    // in the hour before; stored under the hour asked for, which is what was missing.
    if (!wind) continue;
    await upsert(T.wind, [{ ...wind.row, observed_at: new Date(hour).toISOString() }], { onConflict: "observed_at", ignore: true });
    filled.push(moment);
  }
  return { filled, left: missing.length - done };
}
