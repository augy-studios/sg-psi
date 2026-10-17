/*
 * The SG PSI widget for the home screen: the 24-hour PSI across Singapore and its band, the
 * 1-hour PM2.5, and each of the five regions' PSI, band-coloured as on the site's Overview.
 * With "Where I am" on (Follow), the region you're in is picked out.
 *
 * Refreshed by its refresh button, when it's added, and every half hour while there's one
 * (ReadingsWorker), and whenever the app loads the readings itself (SgPsiPlugin.readings).
 * Too short for the regions (one row of cells), it shows the PSI and PM2.5 alone. A tap
 * anywhere else opens the app.
 */
package org.uwuapps.sgpsi;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class PsiWidget extends AppWidgetProvider {
    static final String ACTION_REFRESH = "org.uwuapps.sgpsi.widget.REFRESH";
    private static final ExecutorService WORK = Executors.newSingleThreadExecutor();

    // Below this height the regions' row doesn't fit.
    private static final int REGIONS_MIN_HEIGHT_DP = 100;

    private static final int[] CELLS = {R.id.cell_north, R.id.cell_south, R.id.cell_east, R.id.cell_west, R.id.cell_central};
    private static final int[] NAMES = {R.id.name_north, R.id.name_south, R.id.name_east, R.id.name_west, R.id.name_central};
    private static final int[] VALUES = {R.id.value_north, R.id.value_south, R.id.value_east, R.id.value_west, R.id.value_central};
    private static final int[] DOTS = {R.id.dot_north, R.id.dot_south, R.id.dot_east, R.id.dot_west, R.id.dot_central};

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) draw(context, manager, id, Readings.saved(context) == null);
        refresh(context, goAsync());
        ReadingsWorker.schedule(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) {
            // Shown as refreshing at once, so the tap's seen to do something.
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            for (int id : allIds(context)) draw(context, manager, id, true);
            refresh(context, goAsync());
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        draw(context, manager, id, false);
    }

    @Override
    public void onDisabled(Context context) {
        ReadingsWorker.stopIfIdle(context);
    }

    static int[] allIds(Context context) {
        return AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context, PsiWidget.class));
    }

    // Fetches the readings off the main thread, then draws every widget.
    private static void refresh(Context context, PendingResult async) {
        Context app = context.getApplicationContext();
        WORK.execute(() -> {
            try {
                Readings.fetch(app);
                Glance.redraw(app);
            } finally {
                if (async != null) async.finish();
            }
        });
    }

    static void drawAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (int id : allIds(context)) draw(context, manager, id, false);
    }

    static void draw(Context context, AppWidgetManager manager, int id, boolean refreshing) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_psi);
        JSONObject r = Readings.saved(context);

        Intent open = new Intent(context, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setOnClickPendingIntent(android.R.id.background, PendingIntent.getActivity(context, 1, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        Intent refresh = new Intent(context, PsiWidget.class).setAction(ACTION_REFRESH);
        views.setOnClickPendingIntent(R.id.widget_refresh, PendingIntent.getBroadcast(context, 0, refresh,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        int worst = Readings.psi(r, "islandwide");
        int pm25 = Readings.pm25(r, "islandwide");
        String when = Readings.hour(r == null ? null : r.optString("psiTime"));
        views.setTextViewText(R.id.widget_title, when.isEmpty()
                ? context.getString(R.string.widget_title)
                : context.getString(R.string.widget_title_at, when));
        views.setTextViewText(R.id.widget_value, Readings.psiRange(r));
        views.setTextViewText(R.id.widget_band, r == null ? context.getString(R.string.widget_loading) : Readings.psiLabel(worst));
        views.setInt(R.id.widget_band_dot, "setColorFilter", Readings.colour(context, Readings.psiLevel(worst)));
        views.setTextViewText(R.id.widget_pm25, pm25 < 0 ? ""
                : context.getString(R.string.widget_pm25, Readings.pm25Range(r), Readings.pm25Label(pm25)));

        String here = Follow.on(context) ? Follow.region(context) : null;
        for (int i = 0; i < Readings.REGIONS.length; i++) {
            String region = Readings.REGIONS[i];
            int v = Readings.psi(r, region);
            boolean mine = region.equals(here);
            // Picked out by its outline and the brand's ink: the cells are too narrow for words.
            views.setTextViewText(NAMES[i], Readings.label(region));
            views.setContentDescription(CELLS[i], mine ? context.getString(R.string.widget_here, Readings.label(region)) : Readings.label(region));
            views.setTextColor(NAMES[i], context.getColor(mine ? R.color.brand_ink : R.color.widget_muted));
            views.setTextViewText(VALUES[i], v < 0 ? "--" : String.valueOf(v));
            views.setInt(DOTS[i], "setColorFilter", Readings.colour(context, Readings.psiLevel(v)));
            views.setInt(CELLS[i], "setBackgroundResource", mine ? R.drawable.widget_cell_here : R.drawable.widget_cell);
        }

        Bundle options = manager.getAppWidgetOptions(id);
        int height = options == null ? REGIONS_MIN_HEIGHT_DP : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, REGIONS_MIN_HEIGHT_DP);
        views.setViewVisibility(R.id.widget_regions, height >= REGIONS_MIN_HEIGHT_DP ? View.VISIBLE : View.GONE);

        String updated;
        if (refreshing) updated = context.getString(R.string.widget_refreshing);
        else if (r == null) updated = "";
        else updated = (Readings.stale(context) ? context.getString(R.string.widget_old) + " · " : "")
                + context.getString(R.string.widget_updated, Readings.clock(r.optLong("at")));
        views.setTextViewText(R.id.widget_updated, updated);

        manager.updateAppWidget(id, views);
    }
}
