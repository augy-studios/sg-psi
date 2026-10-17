/*
 * The launcher icon follows the PSI: the gauge's needle and the mascot's face show the worst
 * region's 24-hour band, Good to Hazardous (main-site/icons/SGPSI-<state>.svg). On by default,
 * and switched off from the theme window in the app (SgPsiPlugin.liveIcon), which puts the Good
 * icon back.
 *
 * Android can't change an app's icon, so the manifest has five launcher entries, activity
 * aliases of MainActivity, one per band, and only one is enabled at a time. Switching them has
 * costs, which is why it's a setting:
 *
 * - Some launchers (Pixel's, Samsung's) take the icon off the home screen when its entry is
 *   disabled, leaving it in the app drawer, so it has to be put back after a change. The SG PSI
 *   icon widget (PsiIconWidget) shows the same icon without that.
 * - Android may close the app's screen that was opened from the old entry, so the switch waits
 *   until the app isn't on screen (MainActivity.onStop), and the next launch starts afresh.
 *
 * Bands change at most hourly, so it switches at most that often. Kept up to date by
 * ReadingsWorker every half hour while it's on.
 */
package org.uwuapps.sgpsi;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;

final class LiveIcon {
    private static final String PREFS = "sgpsi.icon";
    // The manifest's activity aliases, in band order: Good to Hazardous.
    private static final String[] ALIASES = {"IconGood", "IconModerate", "IconUnhealthy", "IconVeryUnhealthy", "IconHazardous"};

    private LiveIcon() {}

    static boolean on(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("on", true);
    }

    // Applied once the app isn't on screen.
    static void set(Context context, boolean on) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("on", on).apply();
        if (on) ReadingsWorker.schedule(context);
        else ReadingsWorker.stopIfIdle(context);
    }

    // The band the icon should show: the worst region's, or Good with this off. -1 to leave it
    // as it is, before there are any readings.
    static int wanted(Context context) {
        if (!on(context)) return 0;
        return Readings.psiLevel(Readings.psi(Readings.saved(context), "islandwide"));
    }

    // Puts the icon in step with the readings kept, unless the app is on screen: then
    // MainActivity.onStop does it.
    static void update(Context context) {
        if (MainActivity.inFront) return;
        int level = wanted(context);
        if (level >= 0) show(context, level);
    }

    // The band the enabled entry shows. Good's is enabled in the manifest; the rest only once
    // switched to.
    static int current(Context context) {
        PackageManager pm = context.getPackageManager();
        for (int i = 0; i < ALIASES.length; i++) {
            int state = pm.getComponentEnabledSetting(component(context, i));
            if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                    || (state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && i == 0)) return i;
        }
        return 0;
    }

    private static void show(Context context, int level) {
        if (level == current(context)) return;
        PackageManager pm = context.getPackageManager();
        // The new one on first, so there's never a moment with no launcher entry at all.
        pm.setComponentEnabledSetting(component(context, level),
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
        for (int i = 0; i < ALIASES.length; i++) {
            if (i == level) continue;
            pm.setComponentEnabledSetting(component(context, i),
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
        }
    }

    private static ComponentName component(Context context, int level) {
        return new ComponentName(context.getPackageName(), "org.uwuapps.sgpsi." + ALIASES[level]);
    }
}
