// Supabase over its REST API with plain fetch: the hourly history in the sgpsi_ tables
// (migrations/001_sgpsi_schema.sql). Server side only: SUPABASE_SERVICE_KEY bypasses row
// level security, and nothing under api/_lib is served as a page or a function.

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

export const T = {
  readings: "sgpsi_readings",
  wind: "sgpsi_wind",
  stations: "sgpsi_wind_stations",
};

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

export async function rest(method, table, { params = {}, body, prefer } = {}) {
  if (!supabaseConfigured) throw new Error("Supabase is not configured");

  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: prefer || "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const err = new Error(`Supabase ${method} ${table} failed: ${res.status} ${await res.text()}`);
    err.status = res.status;
    throw err;
  }

  const text = await res.text();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

// Insert, or on a primary key clash either overwrite the columns sent (merge) or
// leave the row alone (ignore). Every row in one call must carry the same keys.
export function upsert(table, rows, { onConflict, ignore = false } = {}) {
  if (!rows.length) return Promise.resolve([]);
  return rest("POST", table, {
    params: onConflict ? { on_conflict: onConflict } : {},
    body: rows,
    prefer: `resolution=${ignore ? "ignore" : "merge"}-duplicates,return=minimal`,
  });
}
