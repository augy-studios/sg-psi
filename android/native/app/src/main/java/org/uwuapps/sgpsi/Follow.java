/*
 * "Where I am" for PSI alerts: the region the phone is in, so alerts follow you around the
 * island rather than staying with one region. Android only.
 *
 * Picked as an area in the alerts window (main-site/js/alerts.js), which asks for rough
 * location and then location all the time (SgPsiPlugin.follow). From then, every half hour
 * (ReadingsWorker) the phone's rough position, from cell towers and wifi rather than GPS, is
 * matched to the nearest of NEA's five regions. When that changes:
 *
 * - The server is told (PUT /api/push/devices/<id>, main-site/api/push/devices/[id].js), so its
 *   alerts (main-site/api/_push/notify.js) are for the region you're in now.
 * - If the region you've come into is already at or above your alert level, a notification
 *   says so at once, as the server only speaks up when a region's band changes.
 *
 * Only the region leaves the phone, never the position. Outside Singapore, the last region
 * stays.
 */
package org.uwuapps.sgpsi;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.Tasks;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

final class Follow {
    private static final String TAG = "SgPsiFollow";
    private static final String PREFS = "sgpsi.follow";

    // Where NEA labels its regions, as main-site/api/_lib/datagov.js has them. The nearest one
    // is the region you're in: rough, as the regions are, but it's how NEA draws them.
    private static final double[][] CENTRES = {
            {1.41803, 103.82}, // north
            {1.29587, 103.82}, // south
            {1.35735, 103.94}, // east
            {1.35735, 103.70}, // west
            {1.35735, 103.82}, // central
    };

    // The alert levels the page names, in PSI band order (Readings.PSI_LABELS).
    private static final String[] LEVELS = {"good", "moderate", "unhealthy", "very-unhealthy", "hazardous"};

    // NEA's advice for healthy people at each band, as main-site/api/_lib/bands.js has it.
    private static final String[] ADVICE = {
            "Normal activities.",
            "Normal activities.",
            "Reduce prolonged or strenuous outdoor physical exertion.",
            "Avoid prolonged or strenuous outdoor physical exertion.",
            "Minimise outdoor activity.",
    };

    private Follow() {}

    // ---------- the choice ----------

    // Turned on from the page with what the server needs to hear from the phone itself: the
    // page's device id, the FCM token it signed up with, and the level picked.
    static void start(Context context, String deviceId, String token, String level) {
        prefs(context).edit()
                .putBoolean("on", true)
                .putString("deviceId", deviceId)
                .putString("token", token)
                .putString("level", level)
                .apply();
        ReadingsWorker.schedule(context);
    }

    static void stop(Context context) {
        prefs(context).edit().putBoolean("on", false).remove("region").apply();
        ReadingsWorker.stopIfIdle(context);
    }

    static boolean on(Context context) {
        return prefs(context).getBoolean("on", false);
    }

    // The region last worked out, or null.
    static String region(Context context) {
        return prefs(context).getString("region", null);
    }

    static boolean allowed(Context context) {
        if (!granted(context, Manifest.permission.ACCESS_COARSE_LOCATION)) return false;
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                || granted(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION);
    }

    private static boolean granted(Context context, String permission) {
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED;
    }

    // ---------- where you are ----------

    // The region you're in now, or null if there's no telling: no fix, or outside Singapore.
    // Blocks for up to half a minute: never on the main thread.
    static String locate(Context context) {
        if (!granted(context, Manifest.permission.ACCESS_COARSE_LOCATION)) return null;
        Location here = null;
        try {
            FusedLocationProviderClient client = LocationServices.getFusedLocationProviderClient(context);
            CurrentLocationRequest request = new CurrentLocationRequest.Builder()
                    .setPriority(Priority.PRIORITY_BALANCED_POWER_ACCURACY)
                    // A fix from the last ten minutes will do, rather than waking anything.
                    .setMaxUpdateAgeMillis(10 * 60 * 1000L)
                    .build();
            here = Tasks.await(client.getCurrentLocation(request, null), 30, TimeUnit.SECONDS);
            if (here == null) here = Tasks.await(client.getLastLocation(), 10, TimeUnit.SECONDS);
        } catch (SecurityException e) {
            return null;
        } catch (Exception e) {
            // No Play services, location switched off, or no fix in time.
            Log.w(TAG, "No location: " + e);
        }
        return here == null ? null : regionAt(here.getLatitude(), here.getLongitude());
    }

    static String regionAt(double lat, double lng) {
        // Singapore and its waters, generously. Anywhere else has no region.
        if (lat < 1.13 || lat > 1.48 || lng < 103.56 || lng > 104.10) return null;
        int best = -1;
        double bestDistance = Double.MAX_VALUE;
        for (int i = 0; i < CENTRES.length; i++) {
            double dLat = lat - CENTRES[i][0];
            // Near the equator a degree of longitude is about a degree of latitude.
            double dLng = lng - CENTRES[i][1];
            double d = dLat * dLat + dLng * dLng;
            if (d < bestDistance) {
                bestDistance = d;
                best = i;
            }
        }
        return Readings.REGIONS[best];
    }

    // Saves a region the page or the worker found. True if it's a change.
    static boolean moved(Context context, String region) {
        if (region == null || region.equals(region(context))) return false;
        prefs(context).edit().putString("region", region).apply();
        return true;
    }

    // ---------- every half hour (ReadingsWorker), with the readings just fetched ----------

    static void check(Context context) {
        if (!on(context) || !allowed(context)) return;
        String before = region(context);
        String now = locate(context);
        if (!moved(context, now)) return;
        register(context, now);
        // The first region found was already sent by the page; only arriving somewhere new
        // is news.
        if (before != null) warnIfBad(context, now);
    }

    // The server's record of this phone, with the new region. The same body the page sends
    // (main-site/js/alerts.js, subscribe), which it checks the same way.
    private static void register(Context context, String region) {
        SharedPreferences p = prefs(context);
        String id = p.getString("deviceId", null);
        String token = p.getString("token", null);
        String level = p.getString("level", null);
        if (id == null || token == null || level == null || !id.matches("[A-Za-z0-9-]{8,64}")) return;
        HttpURLConnection conn = null;
        try {
            JSONObject body = new JSONObject()
                    .put("subscription", new JSONObject().put("fcm", token))
                    .put("area", "here")
                    .put("region", region)
                    .put("level", level);
            conn = (HttpURLConnection) new URL(MainActivity.SITE + "/api/push/devices/" + id).openConnection();
            conn.setRequestMethod("PUT");
            conn.setDoOutput(true);
            conn.setConnectTimeout(15_000);
            conn.setReadTimeout(20_000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("User-Agent", "SG PSI for Android");
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int status = conn.getResponseCode();
            if (status != 200) Log.w(TAG, "The server said " + status + " to the new region");
        } catch (IOException | JSONException e) {
            // Sent again the next time the region changes, or the page opens (it signs up again
            // on every load).
            Log.w(TAG, "Couldn't tell the server the new region: " + e);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static void warnIfBad(Context context, String region) {
        JSONObject r = Readings.saved(context);
        int value = Readings.psi(r, region);
        int level = Readings.psiLevel(value);
        int threshold = levelIndex(prefs(context).getString("level", "unhealthy"));
        if (level < 0 || threshold < 1 || level < threshold) return;
        String band = Readings.PSI_LABELS[level].toLowerCase(java.util.Locale.ROOT);
        String when = Readings.hour(r == null ? null : r.optString("psiTime"));
        Notifications.post(context, Notifications.ALERTS, "psi-here",
                "You're in the " + Readings.label(region) + ", where the PSI is " + band,
                "24-hour PSI " + value + (when.isEmpty() ? "" : " at " + when) + ". " + ADVICE[level], level);
    }

    static int levelIndex(String level) {
        for (int i = 0; i < LEVELS.length; i++) if (LEVELS[i].equals(level)) return i;
        return -1;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
