// The latest PSI, PM2.5 and wind, for every view on the page.
//
// Straight from data.gov.sg, with the CDN holding each answer for two minutes so
// visitors share one upstream call. A feed that doesn't answer falls back to the newest
// row the collect cron stored in Supabase, marked "stored", so one being down doesn't
// blank the page. Each part is null when neither source has it.

import { REGIONS, latest, psiReadings, byRegion, regionsOf, windStations } from "./_lib/datagov.js";
import { T, rest, supabaseConfigured } from "./_lib/supabase.js";

async function livePsi() {
  const data = await latest("psi");
  const item = data.items?.[0];
  if (!item) throw new Error("data.gov.sg psi had no reading");
  return {
    regions: regionsOf(data),
    psi: { time: item.timestamp, updated: item.updatedTimestamp, readings: psiReadings(item) },
  };
}

async function livePm25() {
  const item = (await latest("pm25")).items?.[0];
  if (!item) throw new Error("data.gov.sg pm25 had no reading");
  return { time: item.timestamp, updated: item.updatedTimestamp, regions: byRegion(item.readings?.pm25_one_hourly) };
}

async function liveWind() {
  const [speed, direction] = await Promise.all([latest("wind-speed"), latest("wind-direction")]);
  const stations = windStations(speed, direction);
  if (!stations.length) throw new Error("data.gov.sg wind had no station with both readings");
  return { time: speed.readings?.[0]?.timestamp ?? null, stations };
}

async function newest(column) {
  const [row] = await rest("GET", T.readings, {
    params: { select: `reading_at,${column},${column}_updated_at`, [column]: "not.is.null", order: "reading_at.desc", limit: "1" },
  });
  return row || null;
}

async function storedPsi() {
  const row = await newest("psi");
  if (!row) throw new Error("no stored PSI");
  return { regions: REGIONS, psi: { time: row.reading_at, updated: row.psi_updated_at, readings: row.psi } };
}

async function storedPm25() {
  const row = await newest("pm25");
  if (!row) throw new Error("no stored PM2.5");
  return { time: row.reading_at, updated: row.pm25_updated_at, regions: row.pm25 };
}

async function storedWind() {
  const [[row], stations] = await Promise.all([
    rest("GET", T.wind, { params: { select: "reading_at,speed,direction", order: "observed_at.desc", limit: "1" } }),
    rest("GET", T.stations, { params: { select: "id,name,latitude,longitude" } }),
  ]);
  if (!row) throw new Error("no stored wind");
  return {
    time: row.reading_at,
    stations: stations
      .filter((s) => Number.isFinite(row.speed[s.id]) && Number.isFinite(row.direction[s.id]))
      .map((s) => ({ id: s.id, name: s.name, lat: s.latitude, lng: s.longitude, speed: row.speed[s.id], direction: row.direction[s.id] })),
  };
}

// The live answer, or the stored one if the live one failed and Supabase is set up.
async function either(name, live, stored) {
  try {
    return { value: await live(), source: "live" };
  } catch (err) {
    console.warn(`now: live ${name} failed:`, err.message);
    if (!supabaseConfigured) return { value: null, source: null };
    try {
      return { value: await stored(), source: "stored" };
    } catch (storedErr) {
      console.warn(`now: stored ${name} failed:`, storedErr.message);
      return { value: null, source: null };
    }
  }
}

export default async function handler(req, res) {
  const [psi, pm25, wind] = await Promise.all([
    either("PSI", livePsi, storedPsi),
    either("PM2.5", livePm25, storedPm25),
    either("wind", liveWind, storedWind),
  ]);

  if (!psi.value && !pm25.value && !wind.value) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: "Couldn't reach data.gov.sg, and nothing is stored yet" });
  }

  // NEA publishes PSI and PM2.5 hourly and wind every minute; two minutes keeps the
  // wind fresh while every visitor in that window shares one call upstream. A stored
  // fallback is cached for less, so the live answer comes back soon after it recovers.
  const stored = [psi, pm25, wind].some((p) => p.source === "stored");
  res.setHeader("Cache-Control", stored ? "public, s-maxage=30" : "public, s-maxage=120, stale-while-revalidate=600");
  return res.status(200).json({
    regions: psi.value?.regions || REGIONS,
    psi: psi.value?.psi || null,
    pm25: pm25.value,
    wind: wind.value,
    source: { psi: psi.source, pm25: pm25.source, wind: wind.source },
    fetchedAt: Date.now(),
  });
}
