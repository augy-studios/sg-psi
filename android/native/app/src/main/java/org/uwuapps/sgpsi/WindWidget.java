/*
 * The "SG wind" widget, the Wind page's tiles on the home screen: the average speed across
 * the stations, in knots and km/h, where most of the air is coming from, with an arrow the way
 * it's blowing, and the strongest station. A tap opens Wind.
 *
 * From the wind kept with the readings (Readings), refreshed with them: its refresh button,
 * every half hour while there's one (ReadingsWorker), and whenever the app loads the readings.
 */
package org.uwuapps.sgpsi;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class WindWidget extends AppWidgetProvider {
    static final String ACTION_REFRESH = "org.uwuapps.sgpsi.wind.REFRESH";
    private static final ExecutorService WORK = Executors.newSingleThreadExecutor();

    // The arrow the way the wind blows, to the nearest of eight: N, NE, E, … NW. A widget can't
    // turn an image, so there's one drawable each.
    private static final int[] ARROWS = {
            R.drawable.wind_arrow_0, R.drawable.wind_arrow_45, R.drawable.wind_arrow_90, R.drawable.wind_arrow_135,
            R.drawable.wind_arrow_180, R.drawable.wind_arrow_225, R.drawable.wind_arrow_270, R.drawable.wind_arrow_315,
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        drawAll(context, Readings.saved(context) == null);
        refresh(context, goAsync());
        ReadingsWorker.schedule(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) {
            drawAll(context, true);
            refresh(context, goAsync());
        }
    }

    @Override
    public void onDisabled(Context context) {
        ReadingsWorker.stopIfIdle(context);
    }

    static int[] allIds(Context context) {
        return AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context, WindWidget.class));
    }

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
        drawAll(context, false);
    }

    private static void drawAll(Context context, boolean refreshing) {
        int[] ids = allIds(context);
        if (ids.length == 0) return;
        JSONObject r = Readings.saved(context);
        JSONObject wind = r == null ? null : r.optJSONObject("wind");
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_wind);

        String when = Readings.minute(wind == null ? null : wind.optString("time"));
        views.setTextViewText(R.id.wind_title, when.isEmpty()
                ? context.getString(R.string.wind_title) : context.getString(R.string.wind_title_at, when));

        if (wind == null) {
            views.setTextViewText(R.id.wind_speed, "--");
            views.setTextViewText(R.id.wind_kmh, r == null ? context.getString(R.string.widget_loading) : "");
            views.setTextViewText(R.id.wind_from, "");
            views.setTextViewText(R.id.wind_strongest, "");
            views.setViewVisibility(R.id.wind_arrow, View.GONE);
        } else {
            double mean = wind.optDouble("mean");
            double from = wind.optDouble("from", -1);
            views.setTextViewText(R.id.wind_speed, Readings.knots(mean) + " kn");
            views.setTextViewText(R.id.wind_kmh, context.getString(R.string.wind_kmh, Readings.knotsToKmh(mean)));
            if (from < 0) {
                views.setTextViewText(R.id.wind_from, context.getString(R.string.wind_calm));
                views.setViewVisibility(R.id.wind_arrow, View.GONE);
            } else {
                views.setTextViewText(R.id.wind_from, context.getString(R.string.wind_from, Readings.compass(from)));
                // The way it's blowing: opposite to where it comes from, as on the Wind page.
                int to = (int) Math.round(((from + 180) % 360) / 45) % 8;
                views.setImageViewResource(R.id.wind_arrow, ARROWS[to]);
                views.setViewVisibility(R.id.wind_arrow, View.VISIBLE);
            }
            views.setTextViewText(R.id.wind_strongest, context.getString(R.string.wind_strongest,
                    Readings.knots(wind.optDouble("strongest")), wind.optString("strongestAt")));
        }

        String updated;
        if (refreshing) updated = context.getString(R.string.widget_refreshing);
        else if (r == null) updated = "";
        else updated = (Readings.stale(context) ? context.getString(R.string.widget_old) + " · " : "")
                + context.getString(R.string.widget_updated, Readings.clock(r.optLong("at")));
        views.setTextViewText(R.id.wind_updated, updated);

        views.setOnClickPendingIntent(android.R.id.background, MainActivity.page(context, "wind"));
        Intent refresh = new Intent(context, WindWidget.class).setAction(ACTION_REFRESH);
        views.setOnClickPendingIntent(R.id.wind_refresh, PendingIntent.getBroadcast(context, 2, refresh,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        AppWidgetManager.getInstance(context).updateAppWidget(ids, views);
    }
}
