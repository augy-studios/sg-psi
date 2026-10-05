// data.gov.sg's real-time API: PSI, PM2.5, wind speed and wind direction.
// Shared by /api/now, /api/history and the collect cron.
//
// DATA_GOV_KEY is optional; it raises the rate limit. The feeds' shapes are in the
// JSON files at the repo root, with one difference found against the live API: wind
// stations carry `location`, not the `labelLocation` the spec shows.

const BASE = "https://api-open.data.gov.sg/v2/real-time/api";

export const REGION_NAMES = ["north", "south", "east", "west", "central"];

// Where NEA labels its regions. data.gov.sg's regionMetadata gives the same points;
// these stand in when a stored reading is served without it.
export const REGIONS = [
  { name: "north", lat: 1.41803, lng: 103.82 },
  { name: "south", lat: 1.29587, lng: 103.82 },
  { name: "east", lat: 1.35735, lng: 103.94 },
  { name: "west", lat: 1.35735, lng: 103.7 },
  { name: "central", lat: 1.35735, lng: 103.82 },
];

// A day's readings come back a page at a time. A PSI day is one page; this only
// stops a feed that keeps handing out tokens from looping.
const MAX_PAGES = 10;

// How long to wait before asking again after a 429, at most: data.gov.sg's Retry-After,
// or a few seconds if it sends none.
const MAX_RETRY_WAIT_MS = 10_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class RateLimited extends Error {}

// `retries`: how many times to wait and ask again after a 429. None for anything a page
// is waiting on; the cron's backfill can afford to wait.
async function get(path, params = {}, { retries = 0 } = {}) {
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const key = process.env.DATA_GOV_KEY;
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, {
      headers: { accept: "application/json", ...(key ? { "x-api-key": key } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status !== 429 || attempt >= retries) break;
    const after = Number(res.headers.get("retry-after")) * 1000;
    await sleep(Math.min(MAX_RETRY_WAIT_MS, after > 0 ? after : 5000 * (attempt + 1)));
  }
  if (res.status === 429) throw new RateLimited(`data.gov.sg ${path} answered 429`);
  if (!res.ok) throw new Error(`data.gov.sg ${path} answered ${res.status}`);
  const body = await res.json();
  if (body.code !== 0 || !body.data) throw new Error(`data.gov.sg ${path} said ${body.errorMsg || body.code}`);
  return body.data;
}

export const latest = (path) => get(path);

// The reading as it stood at one SGT moment, e.g. "2026-10-04T10:00:00": a single
// reading, where a whole day of wind is dozens of pages.
export const at = (path, moment, { retries = 0 } = {}) => get(path, { date: moment }, { retries });

// A moment as data.gov.sg's `date` parameter wants it: SGT, to the second, no zone.
export function sgMoment(ms) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 19);
}

// Every item (psi, pm25) or reading (wind) for one SGT date, following pages.
export async function day(path, date, { retries = 0 } = {}) {
  const field = path.startsWith("wind") ? "readings" : "items";
  const out = [];
  let token = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await get(path, { date, paginationToken: token }, { retries });
    out.push(...(data[field] || []));
    token = data.paginationToken;
    if (!token) break;
  }
  return out;
}

// The SGT calendar date of a moment, as data.gov.sg's `date` parameter wants it.
export function sgDate(ms) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function regionsOf(data) {
  const meta = data?.regionMetadata;
  if (!Array.isArray(meta) || !meta.length) return REGIONS;
  return meta
    .map((r) => ({ name: r.name, lat: r.labelLocation?.latitude, lng: r.labelLocation?.longitude }))
    .filter((r) => REGION_NAMES.includes(r.name) && Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

// Only the five regions, only finite numbers: whatever else a feed sends is dropped.
export function byRegion(values) {
  const out = {};
  for (const name of REGION_NAMES) {
    const v = values?.[name];
    if (Number.isFinite(v)) out[name] = v;
  }
  return out;
}

// One PSI item as /api/now and the table both keep it: every reading, by region.
export function psiReadings(item) {
  const out = {};
  for (const [key, values] of Object.entries(item?.readings || {})) {
    const regions = byRegion(values);
    if (Object.keys(regions).length) out[key] = regions;
  }
  return out;
}

// The two wind feeds joined by station: [{ id, name, lat, lng, speed, direction }].
// Only stations both feeds reported, so every arrow has a length and a heading.
export function windStations(speedData, directionData) {
  const speeds = toMap(speedData?.readings?.[0]?.data);
  const directions = toMap(directionData?.readings?.[0]?.data);
  const stations = new Map();
  for (const s of [...(speedData?.stations || []), ...(directionData?.stations || [])]) {
    const loc = s.location || s.labelLocation || {};
    if (!stations.has(s.id) && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
      stations.set(s.id, { id: s.id, name: s.name, lat: loc.latitude, lng: loc.longitude });
    }
  }
  return [...stations.values()]
    .filter((s) => speeds.has(s.id) && directions.has(s.id))
    .map((s) => ({ ...s, speed: speeds.get(s.id), direction: directions.get(s.id) }));
}

function toMap(data) {
  const map = new Map();
  for (const d of data || []) if (Number.isFinite(d.value)) map.set(d.stationId, d.value);
  return map;
}
