/*
 * The app itself, to the page (main-site/js/app-bridge.js):
 *
 *   info()                    { version, versionCode, features, android }: what this app can do
 *   update({ check, version })  the update window (UpdateActivity): check, the Edge Tray's
 *                             "Check for updates", looks first and asks before downloading
 *   readings({ now })         /api/now's answer, as the page just loaded it, kept for the
 *                             widgets, the tile and the launcher icon (Readings, Glance)
 *   liveIcon({ on })          the launcher icon following the PSI (LiveIcon), on or off;
 *                             { on }, as liveIconState() says it
 *   topics()                  { morning, releases }: which of the app's own notifications are on
 *   setTopic({ topic, on })   turns "morning" (the 7am summary) or "releases" (new versions) on
 *                             or off, as FCM topic subscriptions, so the server needs no list
 *   follow({ on, deviceId, token, level })  "Where I am" for PSI alerts (Follow): asks for
 *                             rough location, then location all the time, and finds the region.
 *                             { state, region }, state "on", "off", "denied" (no location),
 *                             "needs-background" (not all the time) or "unsupported" (no Play
 *                             services)
 *   followState()             { on, region, allowed }
 *   openSettings({ what })    the app's notification settings ("notifications"), or its page in
 *                             Android's settings ("app"), for a permission refused
 *
 * PSI alerts themselves come through Capacitor's PushNotifications plugin: the page signs up
 * with the FCM token it gets there (main-site/js/alerts.js).
 */
package org.uwuapps.sgpsi;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

// "Where I am" needs rough location, and location all the time to find it every half hour
// with the app closed (Android 10 and later; before 10, the first covers both).
@CapacitorPlugin(
        name = "SgPsi",
        permissions = {
                @Permission(alias = "location", strings = {Manifest.permission.ACCESS_COARSE_LOCATION}),
                @Permission(alias = "background", strings = {Manifest.permission.ACCESS_BACKGROUND_LOCATION}),
        }
)
public class SgPsiPlugin extends Plugin {
    // FCM topics are shared by every app in the UwU Apps Firebase project, hence the prefix. The
    // server sends the 7am summary to sgpsi-morning (main-site/api/cron/morning.js) and new
    // versions to sgpsi-releases (main-site/api/push/release.js).
    private static final String TOPIC_PREFIX = "sgpsi-";
    private static final String PREFS = "sgpsi";
    private static final Pattern DEVICE_ID = Pattern.compile("[A-Za-z0-9-]{8,64}");
    private static final Pattern LEVEL = Pattern.compile("moderate|unhealthy|very-unhealthy|hazardous");

    private static final ExecutorService WORK = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void info(PluginCall call) {
        JSObject out = new JSObject();
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            out.put("version", info.versionName);
            out.put("versionCode", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode);
        } catch (PackageManager.NameNotFoundException e) {
            out.put("version", null);
        }
        JSArray features = new JSArray();
        features.put("settings");
        features.put("update"); // UpdateActivity, for the update bar
        features.put("checkupdate"); // UpdateActivity's check, for the Edge Tray
        features.put("readings"); // readings(), for the widgets and the tile
        features.put("liveicon"); // liveIcon(), the launcher icon following the PSI
        // Firebase is set up for this build (google-services.json): PSI alerts and the app's
        // own notifications can come.
        if (firebaseReady()) {
            features.put("push");
            features.put("topics");
            // "Where I am" needs Play services' location, and alerts to follow you with.
            if (playServices()) features.put("follow");
        }
        out.put("features", features);
        out.put("android", Build.VERSION.SDK_INT);
        call.resolve(out);
    }

    @PluginMethod
    public void update(PluginCall call) {
        UpdateActivity.start(getActivity(), Boolean.TRUE.equals(call.getBoolean("check", false)), call.getString("version"));
        call.resolve();
    }

    @PluginMethod
    public void readings(PluginCall call) {
        JSObject now = call.getObject("now");
        if (now == null) {
            call.reject("No readings in that");
            return;
        }
        // Older than what's kept, from the page's offline copy: kept as it is.
        if (!Readings.save(getContext(), now)) {
            call.resolve();
            return;
        }
        Context app = getContext().getApplicationContext();
        // The launcher icon waits for the app to leave the screen (LiveIcon).
        WORK.execute(() -> Glance.redraw(app));
        call.resolve();
    }

    // ---------- the launcher icon following the PSI (LiveIcon) ----------

    @PluginMethod
    public void liveIcon(PluginCall call) {
        LiveIcon.set(getContext(), Boolean.TRUE.equals(call.getBoolean("on", true)));
        liveIconState(call);
    }

    @PluginMethod
    public void liveIconState(PluginCall call) {
        JSObject out = new JSObject();
        out.put("on", LiveIcon.on(getContext()));
        call.resolve(out);
    }

    // ---------- the app's own notifications: FCM topics ----------

    @PluginMethod
    public void topics(PluginCall call) {
        SharedPreferences prefs = prefs();
        JSObject out = new JSObject();
        out.put("morning", prefs.getBoolean("topic.morning", false));
        out.put("releases", prefs.getBoolean("topic.releases", false));
        call.resolve(out);
    }

    @PluginMethod
    public void setTopic(PluginCall call) {
        String topic = call.getString("topic", "");
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        if (!"morning".equals(topic) && !"releases".equals(topic)) {
            call.reject("Unknown topic");
            return;
        }
        if (!firebaseReady()) {
            call.reject("This copy of the app can't get notifications yet.");
            return;
        }
        FirebaseMessaging messaging = FirebaseMessaging.getInstance();
        messaging.setAutoInitEnabled(true);
        String name = TOPIC_PREFIX + topic;
        (on ? messaging.subscribeToTopic(name) : messaging.unsubscribeFromTopic(name)).addOnCompleteListener(task -> {
            if (!task.isSuccessful()) {
                call.reject("Couldn't reach Firebase. Check you're online, then try again.");
                return;
            }
            prefs().edit().putBoolean("topic." + topic, on).apply();
            JSObject out = new JSObject();
            out.put("topic", topic);
            out.put("on", on);
            call.resolve(out);
        });
    }

    // ---------- "Where I am" (Follow) ----------

    @PluginMethod
    public void follow(PluginCall call) {
        if (!Boolean.TRUE.equals(call.getBoolean("on", false))) {
            Follow.stop(getContext());
            PsiWidget.drawAll(getContext());
            followAnswer(call, "off");
            return;
        }
        if (!firebaseReady() || !playServices()) {
            followAnswer(call, "unsupported");
            return;
        }
        if (!DEVICE_ID.matcher(call.getString("deviceId", "")).matches()
                || call.getString("token", "").isEmpty()
                || !LEVEL.matcher(call.getString("level", "")).matches()) {
            call.reject("That isn't a device signed up for alerts");
            return;
        }
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "followLocation");
            return;
        }
        followBackground(call);
    }

    @PermissionCallback
    private void followLocation(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            followAnswer(call, "denied");
            return;
        }
        followBackground(call);
    }

    // Asked on its own, after rough location: Android won't offer "all the time" until that's
    // allowed, and from Android 11 it's a settings page of its own, which this opens.
    private void followBackground(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && getPermissionState("background") != PermissionState.GRANTED) {
            requestPermissionForAlias("background", call, "followBackgroundResult");
            return;
        }
        followStart(call);
    }

    @PermissionCallback
    private void followBackgroundResult(PluginCall call) {
        if (getPermissionState("background") != PermissionState.GRANTED) {
            followAnswer(call, "needs-background");
            return;
        }
        followStart(call);
    }

    private void followStart(PluginCall call) {
        Context app = getContext().getApplicationContext();
        Follow.start(app, call.getString("deviceId"), call.getString("token"), call.getString("level"));
        // The region now, so the page can sign up with it; up to half a minute for a fix.
        WORK.execute(() -> {
            Follow.moved(app, Follow.locate(app));
            PsiWidget.drawAll(app);
            PsiTile.ask(app);
            followAnswer(call, "on");
        });
    }

    private void followAnswer(PluginCall call, String state) {
        JSObject out = new JSObject();
        out.put("state", state);
        String region = Follow.on(getContext()) ? Follow.region(getContext()) : null;
        out.put("region", region == null ? JSObject.NULL : region);
        call.resolve(out);
    }

    @PluginMethod
    public void followState(PluginCall call) {
        Context c = getContext();
        JSObject out = new JSObject();
        out.put("on", Follow.on(c));
        String region = Follow.region(c);
        out.put("region", region == null ? JSObject.NULL : region);
        out.put("allowed", Follow.allowed(c));
        call.resolve(out);
    }

    // ---------- settings ----------

    @PluginMethod
    public void openSettings(PluginCall call) {
        String pkg = getContext().getPackageName();
        String what = call.getString("what");
        Intent intent;
        if ("notifications".equals(what) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
        } else {
            // Location and the rest are on the app's own page, under Permissions.
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", pkg, null));
        }
        try {
            getActivity().startActivity(intent);
        } catch (ActivityNotFoundException e) {
            getActivity().startActivity(new Intent(Settings.ACTION_SETTINGS));
        }
        call.resolve();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // Built with google-services.json, which starts Firebase as the app starts. Without it there
    // is no Firebase, and FirebaseMessaging would throw.
    private boolean firebaseReady() {
        return !FirebaseApp.getApps(getContext()).isEmpty();
    }

    private boolean playServices() {
        return GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext()) == ConnectionResult.SUCCESS;
    }
}
