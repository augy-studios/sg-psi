/*
 * The two region widgets for the home screen, drawn the same way from one layout
 * (res/layout/widget_psi.xml), each showing one reading big and every region's underneath:
 *
 *   PsiWidget    "SG PSI": the 24-hour PSI and its band, with the PM2.5 under it
 *   Pm25Widget   "SG PM2.5": the 1-hour PM2.5 and its band, with the PSI under it
 *
 * Each shows the region picked when it was added (WidgetConfigActivity): Singapore (the range
 * across the five, banded by the worst), one region, or "Where I am" (Follow). Its title
 * picks again. The region shown big is outlined in the row; for Singapore, the region you're
 * in, with Where I am on.
 *
 * A tap opens the page for what was tapped (MainActivity.page): the reading the widget is
 * about, the other one's page from the line under it, the Map from a region. Refreshed by its
 * refresh button, when it's added, every half hour while there's one (ReadingsWorker), and
 * whenever the app loads the readings itself (SgPsiPlugin.readings, Glance). Too short for the
 * regions (one row of cells), it shows the reading alone.
 */
package org.uwuapps.sgpsi;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.RelativeSizeSpan;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public abstract class RegionWidget extends AppWidgetProvider {
    static final String ACTION_REFRESH = "org.uwuapps.sgpsi.widget.REFRESH";
    private static final ExecutorService WORK = Executors.newSingleThreadExecutor();

    // Below this height the regions' row doesn't fit.
    private static final int REGIONS_MIN_HEIGHT_DP = 100;

    private static final int[] CELLS = {R.id.cell_north, R.id.cell_south, R.id.cell_east, R.id.cell_west, R.id.cell_central};
    private static final int[] NAMES = {R.id.name_north, R.id.name_south, R.id.name_east, R.id.name_west, R.id.name_central};
    private static final int[] VALUES = {R.id.value_north, R.id.value_south, R.id.value_east, R.id.value_west, R.id.value_central};
    private static final int[] DOTS = {R.id.dot_north, R.id.dot_south, R.id.dot_east, R.id.dot_west, R.id.dot_central};

    // True for the PM2.5 widget, false for the PSI's.
    abstract boolean pm25();

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) draw(context, manager, id, getClass(), pm25(), Readings.saved(context) == null);
        refresh(context, goAsync());
        ReadingsWorker.schedule(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) {
            // Shown as refreshing at once, so the tap's seen to do something.
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            for (int id : allIds(context, getClass())) draw(context, manager, id, getClass(), pm25(), true);
            refresh(context, goAsync());
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        draw(context, manager, id, getClass(), pm25(), false);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        for (int id : ids) WidgetConfigActivity.forget(context, id);
    }

    @Override
    public void onDisabled(Context context) {
        ReadingsWorker.stopIfIdle(context);
    }

    static int[] allIds(Context context, Class<?> provider) {
        return AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context, provider));
    }

    // Fetches the readings off the main thread, then draws everything that shows them.
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

    static void drawAll(Context context, Class<?> provider, boolean pm25) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (int id : allIds(context, provider)) draw(context, manager, id, provider, pm25, false);
    }

    static void draw(Context context, AppWidgetManager manager, int id, Class<?> provider, boolean pm25, boolean refreshing) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_psi);
        JSONObject r = Readings.saved(context);

        // The region shown big: the one picked, with Where I am resolved to where you are,
        // or Singapore while that isn't known.
        String picked = WidgetConfigActivity.region(context, id);
        String here = Follow.on(context) ? Follow.region(context) : null;
        String region = "here".equals(picked) ? (here != null ? here : "islandwide") : picked;
        boolean singapore = "islandwide".equals(region);

        int value = pm25 ? Readings.pm25(r, region) : Readings.psi(r, region);
        int level = pm25 ? Readings.pm25Level(value) : Readings.psiLevel(value);
        String big = singapore ? (pm25 ? Readings.pm25Range(r) : Readings.psiRange(r)) : value < 0 ? "--" : String.valueOf(value);
        String band = r == null ? context.getString(R.string.widget_loading)
                : pm25 ? Readings.pm25Label(value) : Readings.psiLabel(value);

        // Title: what it is, where, and when the reading is for.
        String when = Readings.hour(r == null ? null : r.optString(pm25 ? "pm25Time" : "psiTime"));
        StringBuilder title = new StringBuilder(context.getString(pm25 ? R.string.widget_title_pm25 : R.string.widget_title));
        if (!singapore) {
            title.append(" · ").append("here".equals(picked)
                    ? context.getString(R.string.widget_here, Readings.label(region)) : Readings.label(region));
        }
        if (!when.isEmpty()) title.append(" · ").append(when);
        views.setTextViewText(R.id.widget_title, title);

        views.setTextViewText(R.id.widget_value, pm25 ? withUnit(big) : big);
        views.setTextViewText(R.id.widget_band, band);
        views.setInt(R.id.widget_band_dot, "setColorFilter", Readings.colour(context, level));

        // The other reading, for the same region.
        int other = pm25 ? Readings.psi(r, region) : Readings.pm25(r, region);
        String otherText = singapore ? (pm25 ? Readings.psiRange(r) : Readings.pm25Range(r)) : String.valueOf(other);
        views.setTextViewText(R.id.widget_sub, other < 0 ? ""
                : pm25 ? context.getString(R.string.widget_psi, otherText, Readings.psiLabel(other))
                : context.getString(R.string.widget_pm25, otherText, Readings.pm25Label(other)));

        String outlined = singapore ? here : region;
        for (int i = 0; i < Readings.REGIONS.length; i++) {
            String each = Readings.REGIONS[i];
            int v = pm25 ? Readings.pm25(r, each) : Readings.psi(r, each);
            boolean mine = each.equals(outlined);
            // Picked out by its outline and the brand's ink: the cells are too narrow for words.
            views.setTextViewText(NAMES[i], Readings.label(each));
            views.setContentDescription(CELLS[i], mine && each.equals(here)
                    ? context.getString(R.string.widget_here, Readings.label(each)) : Readings.label(each));
            views.setTextColor(NAMES[i], context.getColor(mine ? R.color.brand_ink : R.color.widget_muted));
            views.setTextViewText(VALUES[i], v < 0 ? "--" : String.valueOf(v));
            views.setInt(DOTS[i], "setColorFilter", Readings.colour(context, pm25 ? Readings.pm25Level(v) : Readings.psiLevel(v)));
            views.setInt(CELLS[i], "setBackgroundResource", mine ? R.drawable.widget_cell_here : R.drawable.widget_cell);
            views.setOnClickPendingIntent(CELLS[i], MainActivity.page(context, "map"));
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

        // Where each part goes: this reading's page, the other's, the region picker, refresh.
        PendingIntent mine = MainActivity.page(context, pm25 ? "trends" : "overview");
        views.setOnClickPendingIntent(android.R.id.background, mine);
        views.setOnClickPendingIntent(R.id.widget_hero, mine);
        views.setOnClickPendingIntent(R.id.widget_sub, MainActivity.page(context, pm25 ? "overview" : "trends"));
        Intent setup = new Intent(context, WidgetConfigActivity.class)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                .setData(Uri.parse("sgpsi-widget://setup/" + id));
        views.setOnClickPendingIntent(R.id.widget_title, PendingIntent.getActivity(context, id, setup,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        Intent refresh = new Intent(context, provider).setAction(ACTION_REFRESH);
        views.setOnClickPendingIntent(R.id.widget_refresh, PendingIntent.getBroadcast(context, pm25 ? 1 : 0, refresh,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        manager.updateAppWidget(id, views);
    }

    // "12–20 µg/m³", the unit smaller than the number.
    private static CharSequence withUnit(String value) {
        String unit = " µg/m³";
        SpannableString text = new SpannableString(value + unit);
        text.setSpan(new RelativeSizeSpan(0.45f), value.length(), text.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return text;
    }
}
