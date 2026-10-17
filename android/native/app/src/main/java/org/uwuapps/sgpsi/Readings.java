/*
 * The latest readings, kept on the phone for what shows them with the app closed: the home
 * screen widgets (Glance), the Quick Settings tile (PsiTile), the launcher icon (LiveIcon) and
 * "Where I am" (Follow).
 *
 * Fetched from the site's /api/now (main-site/api/now.js) by ReadingsWorker, the widgets'
 * refresh buttons and the tile, and handed over by the page whenever it loads them itself
 * (SgPsiPlugin.readings), so an open app keeps them fresh for free. Only what's shown is
 * kept: each region's 24-hour PSI and 1-hour PM2.5, the wind's summary, and when they're for.
 *
 * The bands are NEA's, the same as main-site/js/bands.js: keep them in step.
 */
package org.uwuapps.sgpsi;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

final class Readings {
    private static final String TAG = "SgPsiReadings";
    static final String[] REGIONS = {"north", "south", "east", "west", "central"};
    private static final String[] LABELS = {"North", "South", "East", "West", "Central"};

    // Older than this and the tile fetches again as it's shown. NEA publishes hourly.
    static final long STALE_MS = 30 * 60 * 1000L;

    private static final String PREFS = "sgpsi.readings";
    private static final String KEY = "now";

    // The 24-hour PSI's bands: Good, Moderate, Unhealthy, Very unhealthy, Hazardous.
    private static final int[] PSI_MAX = {50, 100, 200, 300};
    static final String[] PSI_LABELS = {"Good", "Moderate", "Unhealthy", "Very unhealthy", "Hazardous"};
    // The 1-hour PM2.5's: Normal, Elevated, High, Very high.
    private static final int[] PM25_MAX = {55, 150, 250};
    private static final String[] PM25_LABELS = {"Normal", "Elevated", "High", "Very high"};

    private Readings() {}

    // ---------- what's kept ----------

    // { at, psiTime, pm25Time, psi: { north: 45, ... }, pm25: { ... } }, or null before the
    // first fetch.
    static JSONObject saved(Context context) {
        String raw = prefs(context).getString(KEY, null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (JSONException e) {
            return null;
        }
    }

    static boolean stale(Context context) {
        JSONObject r = saved(context);
        return r == null || System.currentTimeMillis() - r.optLong("at") > STALE_MS;
    }

    // From /api/now's answer, as the page or fetch() has it. False if it had no PSI, or is older
    // than what's kept: the page may have had it from its offline copy.
    static boolean save(Context context, JSONObject now) {
        JSONObject psi = now.optJSONObject("psi");
        JSONObject psi24 = psi == null ? null : psi.optJSONObject("readings");
        psi24 = psi24 == null ? null : psi24.optJSONObject("psi_twenty_four_hourly");
        JSONObject pm25 = now.optJSONObject("pm25");
        if (psi24 == null) return false;
        // When the server answered (main-site/api/now.js), not when it arrived here.
        long at = Math.min(now.optLong("fetchedAt", System.currentTimeMillis()), System.currentTimeMillis());
        JSONObject kept = saved(context);
        if (kept != null && kept.optLong("at") > at) return false;
        try {
            JSONObject out = new JSONObject();
            out.put("at", at);
            out.put("psiTime", psi.optString("time", ""));
            out.put("psi", regions(psi24));
            if (pm25 != null && pm25.optJSONObject("regions") != null) {
                out.put("pm25Time", pm25.optString("time", ""));
                out.put("pm25", regions(pm25.optJSONObject("regions")));
            }
            JSONObject wind = wind(now.optJSONObject("wind"));
            if (wind != null) out.put("wind", wind);
            prefs(context).edit().putString(KEY, out.toString()).apply();
            return true;
        } catch (JSONException e) {
            return false;
        }
    }

    // The wind as the Wind page's tiles show it (main-site/script.js, renderWind): the average
    // speed in knots, the strongest station, and where most of the air is coming from, as the
    // average of every station's wind as a vector, so a few still stations pointing anywhere
    // don't drag it about. { time, mean, strongest, strongestAt, from }, from -1 when calm.
    private static JSONObject wind(JSONObject wind) throws JSONException {
        JSONArray stations = wind == null ? null : wind.optJSONArray("stations");
        if (stations == null || stations.length() == 0) return null;
        double sum = 0;
        double x = 0;
        double y = 0;
        double strongest = -1;
        String strongestAt = "";
        int n = 0;
        for (int i = 0; i < stations.length(); i++) {
            JSONObject s = stations.optJSONObject(i);
            if (s == null || !s.has("speed") || !s.has("direction")) continue;
            double speed = s.optDouble("speed");
            double rad = Math.toRadians(s.optDouble("direction"));
            sum += speed;
            x += speed * Math.sin(rad);
            y += speed * Math.cos(rad);
            if (speed > strongest) {
                strongest = speed;
                strongestAt = s.optString("name", "");
            }
            n++;
        }
        if (n == 0) return null;
        JSONObject out = new JSONObject();
        out.put("time", wind.optString("time", ""));
        out.put("mean", Math.round(sum / n * 10) / 10.0);
        out.put("strongest", strongest);
        out.put("strongestAt", strongestAt);
        out.put("from", Math.hypot(x, y) < 0.5 ? -1 : (Math.toDegrees(Math.atan2(x, y)) + 360) % 360);
        return out;
    }

    private static final String[] COMPASS = {"N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"};

    // A direction the wind comes from as a 16-point compass name, as main-site/js/bands.js has it.
    static String compass(double deg) {
        return COMPASS[(int) Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
    }

    static long knotsToKmh(double knots) {
        return Math.round(knots * 1.852);
    }

    // "6.2", or "6" for a whole number of knots.
    static String knots(double knots) {
        return knots == Math.rint(knots) ? String.valueOf((long) knots) : String.valueOf(knots);
    }

    private static JSONObject regions(JSONObject from) throws JSONException {
        JSONObject out = new JSONObject();
        for (String r : REGIONS) {
            if (from.has(r) && !from.isNull(r)) out.put(r, from.getDouble(r));
        }
        return out;
    }

    // Asks the site for the latest. Off the main thread only. False when offline or the site
    // didn't answer, leaving what was kept as it was.
    static boolean fetch(Context context) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(MainActivity.SITE + "/api/now").openConnection();
            conn.setConnectTimeout(15_000);
            conn.setReadTimeout(20_000);
            conn.setRequestProperty("User-Agent", "SG PSI for Android");
            if (conn.getResponseCode() != 200) return false;
            try (InputStream in = conn.getInputStream()) {
                return save(context, new JSONObject(read(in)));
            }
        } catch (IOException | JSONException e) {
            Log.w(TAG, "Couldn't fetch the readings: " + e);
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ---------- reading them ----------

    // A region's 24-hour PSI, or -1 without one. "islandwide" is the worst region's.
    static int psi(JSONObject r, String region) {
        JSONObject psi = r == null ? null : r.optJSONObject("psi");
        if (psi == null) return -1;
        if ("islandwide".equals(region)) {
            int worst = -1;
            for (String each : REGIONS) worst = Math.max(worst, psi.has(each) ? (int) Math.round(psi.optDouble(each)) : -1);
            return worst;
        }
        return psi.has(region) ? (int) Math.round(psi.optDouble(region)) : -1;
    }

    static int pm25(JSONObject r, String region) {
        JSONObject pm = r == null ? null : r.optJSONObject("pm25");
        if (pm == null) return -1;
        if ("islandwide".equals(region)) {
            int worst = -1;
            for (String each : REGIONS) worst = Math.max(worst, pm.has(each) ? (int) Math.round(pm.optDouble(each)) : -1);
            return worst;
        }
        return pm.has(region) ? (int) Math.round(pm.optDouble(region)) : -1;
    }

    // The region with the highest PSI, or null.
    static String worstRegion(JSONObject r) {
        String worst = null;
        int high = -1;
        for (String each : REGIONS) {
            int v = psi(r, each);
            if (v > high) {
                high = v;
                worst = each;
            }
        }
        return worst;
    }

    // "45–58", or "58" when every region agrees, or "--".
    static String psiRange(JSONObject r) {
        int low = Integer.MAX_VALUE;
        int high = -1;
        for (String each : REGIONS) {
            int v = psi(r, each);
            if (v < 0) continue;
            low = Math.min(low, v);
            high = Math.max(high, v);
        }
        if (high < 0) return "--";
        return low == high ? String.valueOf(high) : low + "–" + high;
    }

    static String pm25Range(JSONObject r) {
        int low = Integer.MAX_VALUE;
        int high = -1;
        for (String each : REGIONS) {
            int v = pm25(r, each);
            if (v < 0) continue;
            low = Math.min(low, v);
            high = Math.max(high, v);
        }
        if (high < 0) return "--";
        return low == high ? String.valueOf(high) : low + "–" + high;
    }

    // 0 for Good up to 4 for Hazardous, or -1 for no reading.
    static int psiLevel(int value) {
        if (value < 0) return -1;
        for (int i = 0; i < PSI_MAX.length; i++) if (value <= PSI_MAX[i]) return i;
        return PSI_MAX.length;
    }

    static String psiLabel(int value) {
        int level = psiLevel(value);
        return level < 0 ? "No reading" : PSI_LABELS[level];
    }

    // 0 for Normal up to 3 for Very high, or -1.
    static int pm25Level(int value) {
        if (value < 0) return -1;
        for (int i = 0; i < PM25_MAX.length; i++) if (value <= PM25_MAX[i]) return i;
        return PM25_MAX.length;
    }

    static String pm25Label(int value) {
        int level = pm25Level(value);
        return level < 0 ? "No reading" : PM25_LABELS[level];
    }

    // The band colours (main-site/style.css, --band-1 to --band-5), from a level: a PSI level, or
    // a PM2.5 one, as the site gives Normal to Very high the same first four colours.
    static int colour(Context context, int level) {
        switch (level) {
            case 0: return context.getColor(R.color.band_1);
            case 1: return context.getColor(R.color.band_2);
            case 2: return context.getColor(R.color.band_3);
            case 3: return context.getColor(R.color.band_4);
            case 4: return context.getColor(R.color.band_5);
            default: return context.getColor(R.color.widget_muted);
        }
    }

    static String label(String region) {
        if ("islandwide".equals(region)) return "Singapore";
        for (int i = 0; i < REGIONS.length; i++) if (REGIONS[i].equals(region)) return LABELS[i];
        return region;
    }

    // "3pm", in Singapore time, for when a reading is from.
    static String hour(String iso) {
        return format(iso, "ha");
    }

    // "3:05pm", for the wind, which is read every minute.
    static String minute(String iso) {
        return format(iso, "h:mma");
    }

    private static String format(String iso, String pattern) {
        if (iso == null || iso.length() < 19) return "";
        try {
            // data.gov.sg's stamps end +08:00, Supabase's +00:00, and either may say Z. The
            // offset is worked out by hand: SimpleDateFormat only reads "+08:00" from Android 7's
            // XXX, and not "Z" with it.
            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT);
            in.setTimeZone(TimeZone.getTimeZone("UTC"));
            long ms = in.parse(iso.substring(0, 19)).getTime();
            String zone = iso.substring(19).replaceFirst("^\\.\\d+", "");
            if (zone.matches("[+-]\\d{2}:\\d{2}")) {
                long minutes = Integer.parseInt(zone.substring(1, 3)) * 60L + Integer.parseInt(zone.substring(4, 6));
                ms -= (zone.charAt(0) == '-' ? -1 : 1) * minutes * 60_000L;
            }
            SimpleDateFormat out = new SimpleDateFormat(pattern, Locale.UK);
            out.setTimeZone(TimeZone.getTimeZone("Asia/Singapore"));
            return out.format(new Date(ms)).toLowerCase(Locale.ROOT);
        } catch (Exception e) {
            return "";
        }
    }

    // "15:04", for when they were fetched.
    static String clock(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("HH:mm", Locale.UK);
        f.setTimeZone(TimeZone.getTimeZone("Asia/Singapore"));
        return f.format(new Date(ms));
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String read(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8 * 1024];
        for (int n; (n = in.read(buf)) != -1; ) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }
}
