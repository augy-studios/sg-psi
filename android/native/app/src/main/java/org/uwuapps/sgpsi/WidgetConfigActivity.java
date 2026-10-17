/*
 * Picks the region a region widget (RegionWidget: SG PSI, SG PM2.5) shows big: Singapore, "Where
 * I am" (when it's on in the alerts, Follow), or one of the five. A small window over the home
 * screen, shown as the widget is added, again from Android 12's "reconfigure" on a long press,
 * and from the widget's title on any version.
 *
 * Backing out while adding leaves the widget off the home screen, as Android does for any
 * widget's setup; backing out later changes nothing. Exported for the launcher, which starts
 * it with APPWIDGET_CONFIGURE.
 */
package org.uwuapps.sgpsi;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

public class WidgetConfigActivity extends Activity {
    private static final String PREFS = "sgpsi.widgets";

    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    // The region a widget shows: "islandwide" (Singapore, the default, and what 1.0.0's widgets
    // keep), "here", or a region.
    static String region(Context context, int id) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("region." + id, "islandwide");
    }

    static void forget(Context context, int id) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("region." + id).apply();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Bundle extras = getIntent().getExtras();
        if (extras != null) widgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        // Until a region is picked, the answer is "cancelled", so backing out of adding one
        // leaves no empty widget behind.
        setResult(RESULT_CANCELED, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }
        buildWindow();
    }

    private void buildWindow() {
        int pad = dp(24);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, pad, pad, dp(12));
        box.setMinimumWidth(dp(280));

        TextView title = new TextView(this);
        title.setText(R.string.widget_setup_title);
        title.setTextAppearance(android.R.style.TextAppearance_DeviceDefault_Large);
        title.setPadding(0, 0, 0, dp(8));
        box.addView(title);

        // Value, label: Singapore first, then Where I am if it's on, then the five.
        List<String[]> choices = new ArrayList<>();
        choices.add(new String[] {"islandwide", getString(R.string.widget_setup_singapore)});
        if (Follow.on(this)) choices.add(new String[] {"here", getString(R.string.widget_setup_here)});
        for (String r : Readings.REGIONS) choices.add(new String[] {r, Readings.label(r)});

        String current = region(this, widgetId);
        for (String[] choice : choices) {
            Button button = new Button(this, null, android.R.attr.borderlessButtonStyle);
            button.setAllCaps(false);
            button.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
            button.setText(choice[0].equals(current) ? "✓  " + choice[1] : choice[1]);
            button.setOnClickListener(v -> pick(choice[0]));
            box.addView(button, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        }

        ScrollView scroll = new ScrollView(this);
        scroll.addView(box);
        setContentView(scroll);
    }

    private void pick(String region) {
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("region." + widgetId, region).apply();
        PsiWidget.drawAll(this);
        Pm25Widget.drawAll(this);
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        finish();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
