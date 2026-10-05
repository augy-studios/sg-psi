// The last 24 hours or 7 days of PSI, PM2.5 and wind, for the Trends and Wind charts.
//
// GET /api/history?range=24h|7d
//
// From the hourly rows the collect cron keeps in Supabase. Without Supabase, or before
// the cron has stored anything, PSI and PM2.5 come from data.gov.sg a day at a time
// instead, and there is no wind history: data.gov.sg keeps wind by the minute, a few
// dozen pages a day, too many to fetch for each chart.

import { REGION_NAMES, byRegion, day, sgDate } from "./_lib/datagov.js";
import { T, rest, supabaseConfigured } from "./_lib/supabase.js";

const RANGES = { "24h": 24 * 3600 * 1000, "7d": 7 * 24 * 3600 * 1000 };
const round1 = (n) => Math.round(n * 10) / 10;

async function fromSupabase(since) {
  const iso = new Date(since).toISOString();
  const [readings, wind] = await Promise.all([
    rest("GET", T.readings, {
      params: { select: "reading_at,psi24:psi->psi_twenty_four_hourly,pm25", reading_at: `gte.${iso}`, order: "reading_at.asc", limit: "1000" },
    }),
    rest("GET", T.wind, {
      params: { select: "observed_at,speed", observed_at: `gte.${iso}`, order: "observed_at.asc", limit: "1000" },
    }),
  ]);
  return {
    points: readings.map((r) => ({ t: r.reading_at, psi: r.psi24 ? byRegion(r.psi24) : null, pm25: r.pm25 ? byRegion(r.pm25) : null })),
    wind: wind.map((w) => windPoint(w.observed_at, Object.values(w.speed || {}))).filter(Boolean),
  };
}

function windPoint(t, speeds) {
  const nums = speeds.filter(Number.isFinite);
  if (!nums.length) return null;
  return { t, mean: round1(nums.reduce((a, b) => a + b, 0) / nums.length), max: round1(Math.max(...nums)) };
}

async function fromDataGov(since) {
  const dates = [];
  for (let t = since; sgDate(t) <= sgDate(Date.now()); t += 24 * 3600 * 1000) dates.push(sgDate(t));
  if (dates.at(-1) !== sgDate(Date.now())) dates.push(sgDate(Date.now()));

  // A day that fails leaves a gap in the chart rather than failing the whole range.
  const fetchDay = (path, d) =>
    day(path, d, { retries: 1 }).catch((err) => {
      console.warn(`history: ${path} for ${d} failed:`, err.message);
      return [];
    });
  // A day at a time, its two feeds together: all sixteen at once is a burst data.gov.sg
  // answers with 429s.
  const psiDays = [];
  const pm25Days = [];
  for (const d of dates) {
    const [p, m] = await Promise.all([fetchDay("psi", d), fetchDay("pm25", d)]);
    psiDays.push(p);
    pm25Days.push(m);
  }

  const byTime = new Map();
  const at = (t) => byTime.get(t) || byTime.set(t, { t, psi: null, pm25: null }).get(t);
  for (const item of psiDays.flat()) at(item.timestamp).psi = byRegion(item.readings?.psi_twenty_four_hourly);
  for (const item of pm25Days.flat()) at(item.timestamp).pm25 = byRegion(item.readings?.pm25_one_hourly);

  const points = [...byTime.values()]
    .filter((p) => Date.parse(p.t) >= since)
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  return { points, wind: [] };
}

export default async function handler(req, res) {
  const range = RANGES[req.query.range] ? req.query.range : "24h";
  // An hour of slack, so the oldest hour in the window isn't the one left off.
  const since = Date.now() - RANGES[range] - 3600 * 1000;

  let stored = null;
  if (supabaseConfigured) {
    try {
      stored = await fromSupabase(since);
    } catch (err) {
      console.warn("history: Supabase failed, asking data.gov.sg:", err.message);
    }
  }

  let body = stored;
  let source = "stored";
  if (!stored?.points.length) {
    try {
      // Whatever wind Supabase did have still goes on the Wind chart.
      body = { points: (await fromDataGov(since)).points, wind: stored?.wind || [] };
      source = "data.gov.sg";
    } catch (err) {
      console.warn("history: data.gov.sg failed:", err.message);
    }
  }

  if (!body || !body.points.length) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: "No history to show right now" });
  }

  // New readings land hourly; ten minutes keeps the chart's last point current.
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
  return res.status(200).json({ range, regions: REGION_NAMES, source, ...body, fetchedAt: Date.now() });
}
