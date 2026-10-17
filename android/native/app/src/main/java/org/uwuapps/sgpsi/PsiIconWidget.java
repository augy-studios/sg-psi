/*
 * The SG PSI icon widget: one cell on the home screen, the app's icon in the worst region's
 * band (Good to Hazardous, main-site/icons/SGPSI-<state>.svg) with the PSI under it, opening
 * the app on the Overview. A live icon that every launcher keeps where it was put, unlike the
 * launcher icon's own switching (LiveIcon).
 *
 * Refreshed with the other widgets: every half hour while there's one (ReadingsWorker), and
 * whenever the app loads the readings itself.
 */
package org.uwuapps.sgpsi;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class PsiIconWidget extends AppWidgetProvider {
    private static final ExecutorService WORK = Executors.newSingleThreadExecutor();

    // The round launcher icons, in band order: Good to Hazardous.
    static final int[] ICONS = {
            R.mipmap.ic_launcher_round,
            R.mipmap.ic_launcher_moderate_round,
            R.mipmap.ic_launcher_unhealthy_round,
            R.mipmap.ic_launcher_very_unhealthy_round,
            R.mipmap.ic_launcher_hazardous_round,
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        drawAll(context);
        ReadingsWorker.schedule(context);
        if (Readings.stale(context)) {
            Context app = context.getApplicationContext();
            PendingResult async = goAsync();
            WORK.execute(() -> {
                try {
                    if (Readings.fetch(app)) Glance.redraw(app);
                } finally {
                    async.finish();
                }
            });
        }
    }

    @Override
    public void onDisabled(Context context) {
        ReadingsWorker.stopIfIdle(context);
    }

    static int[] allIds(Context context) {
        return AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context, PsiIconWidget.class));
    }

    static void drawAll(Context context) {
        int[] ids = allIds(context);
        if (ids.length == 0) return;
        JSONObject r = Readings.saved(context);
        int value = Readings.psi(r, "islandwide");
        int level = Readings.psiLevel(value);

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_icon);
        views.setImageViewResource(R.id.icon_image, ICONS[Math.max(level, 0)]);
        views.setTextViewText(R.id.icon_label, value < 0
                ? context.getString(R.string.app_name)
                : context.getString(R.string.tile_value, value));
        views.setContentDescription(android.R.id.background, value < 0
                ? context.getString(R.string.app_name)
                : context.getString(R.string.icon_widget_spoken, value, Readings.psiLabel(value)));

        views.setOnClickPendingIntent(android.R.id.background, MainActivity.page(context, "overview"));

        AppWidgetManager.getInstance(context).updateAppWidget(ids, views);
    }
}
