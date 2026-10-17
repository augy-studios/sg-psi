/*
 * The app: the site at sgpsi.uwuapps.org in Capacitor's WebView (capacitor.config.json's
 * server.url), so the site's own updates reach it at once, with this app's plugin injected into
 * its pages for what a web page can't do (main-site/js/app-bridge.js):
 *
 *   SgPsiPlugin        what the app can do: updating itself, keeping the readings for the
 *                      widget and the tile, "Where I am", and the app's own notifications
 *   PushNotifications  Capacitor's, for Android's notification permission and PSI alerts
 *
 * Here: what the app was opened with (one of the site's own links, a uwu://sgpsi/ link, or a
 * tapped notification) opened in the page, the back button going back through the page's
 * history, the notification channels, and no status bar.
 *
 * The widgets (PsiWidget, PsiIconWidget), the Quick Settings tile (PsiTile), the launcher icon
 * (LiveIcon) and ReadingsWorker run without this, from the readings kept on the phone
 * (Readings). The launcher reaches this through one of five activity aliases, one per band
 * (AndroidManifest.xml, LiveIcon).
 */
package org.uwuapps.sgpsi;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    static final String SITE = "https://sgpsi.uwuapps.org";
    static final String HOST = "sgpsi.uwuapps.org";
    // The site's views, which a link may name: the manifest's shortcuts use /#map and /#trends.
    private static final String VIEWS = "overview|map|trends|pollutants|wind";

    // Whether the app is on screen: the launcher icon only switches while it isn't (LiveIcon).
    static volatile boolean inFront;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(SgPsiPlugin.class);
        Notifications.createChannels(this);
        super.onCreate(savedInstanceState);
        // The launcher icon follows the PSI from the first launch, which needs the half-hourly
        // readings (LiveIcon, ReadingsWorker).
        if (LiveIcon.on(this)) ReadingsWorker.schedule(this);

        // The page runs up into the camera's cutout, where the status bar was, rather than
        // leaving a black strip there on phones older than Android 15.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attrs = getWindow().getAttributes();
            attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attrs);
        }

        // Back goes back through the page's history, as in a browser. Off the first page, the
        // app goes to the background rather than closing.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = bridge == null ? null : bridge.getWebView();
                if (web != null && web.canGoBack()) web.goBack();
                else moveTaskToBack(true);
            }
        });
    }

    @Override
    public void onStart() {
        super.onStart();
        inFront = true;
    }

    // Off screen: the launcher icon catches up with the readings the page loaded meanwhile, or
    // goes back to Good if it was just switched off.
    @Override
    public void onStop() {
        inFront = false;
        LiveIcon.update(this);
        super.onStop();
    }

    // No status bar: the page has the whole screen, and a swipe down from the top shows the bar
    // for a moment. Done here rather than in onCreate because Capacitor's SystemBars shows every
    // bar as it starts, and again whenever the window comes back. The page leaves no room for
    // the bar (capacitor.config.json's user agent, SGPSIApp/1, tells it so: js/app-bridge.js).
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus) return;
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsetsCompat.Type.statusBars());
    }

    // BridgeActivity calls this with the intent the app was opened with too, once the page has
    // started loading the site's home page.
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);

        // "Version 1.1.0 of SG PSI is out", tapped (main-site/api/push/release.js): straight to
        // the update window, which asks before downloading it. Taken off the intent so it isn't
        // asked again if Android recreates the activity with it.
        if ("release".equals(intent.getStringExtra("type"))) {
            UpdateActivity.start(this, true, intent.getStringExtra("version"));
            intent.removeExtra("type");
            return;
        }

        String url = pageFor(intent);
        if (url != null && bridge != null) bridge.getWebView().loadUrl(url);
    }

    // Opens the app on one of the site's views ("map", "trends", …) through its uwu://sgpsi/
    // link, for the widgets and the tile. The launcher shortcuts use the same links
    // (res/xml/shortcuts.xml).
    static PendingIntent page(Context context, String view) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("uwu://sgpsi/" + view), context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, view.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // The site's page an intent asks for, or null for the page as it is. A tapped PSI alert or
    // morning summary is null: the app opens on the Overview, with the latest readings.
    static String pageFor(Intent intent) {
        if (intent == null) return null;
        Uri data = intent.getData();
        if (data == null) return null;
        // The site's own links, such as https://sgpsi.uwuapps.org/#map
        if ("https".equals(data.getScheme()) && HOST.equalsIgnoreCase(data.getHost())) {
            return data.toString();
        }
        // uwu://sgpsi/map to the site's Map view, and so on for each view (the launcher
        // shortcuts, the widgets and the tile use these). uwu://sgpsi/ on its own, or with a
        // path that isn't a view, opens the app as it is, rather than reloading the page.
        // uwu:// is shared by UwU Apps' apps, each answering its own host.
        if ("uwu".equals(data.getScheme()) && "sgpsi".equalsIgnoreCase(data.getHost())) {
            String view = data.getPath() == null ? "" : data.getPath().replaceAll("^/+|/+$", "").toLowerCase(java.util.Locale.ROOT);
            return view.matches(VIEWS) ? SITE + "/#" + view : null;
        }
        return null;
    }
}
