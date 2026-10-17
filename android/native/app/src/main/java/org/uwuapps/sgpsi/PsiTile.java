/*
 * The SG PSI tile in Quick Settings: the 24-hour PSI and its band, for the region you're in
 * with "Where I am" on (Follow), or else the worst region, as the alerts' "Any region" is. Its
 * icon is the app icon's gauge with the needle on that band, and it's lit up while that's
 * Unhealthy or worse, so a glance at the shade says whether to read it. A tap opens the app on
 * the Overview.
 *
 * Drawn from the readings kept on the phone (Readings) each time the shade opens, fetching
 * them first if they're over half an hour old, and refreshed by ReadingsWorker while the tile
 * is added.
 */
package org.uwuapps.sgpsi;

import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class PsiTile extends TileService {
    private static final String PREFS = "sgpsi.tile";
    private static final ExecutorService WORK = Executors.newSingleThreadExecutor();
    // Unhealthy, in Readings.PSI_LABELS.
    private static final int LIT_FROM_LEVEL = 2;
    // The gauge with its needle on each band, Good to Hazardous, as the app icon has it.
    private static final int[] ICONS = {
            R.drawable.tile_good, R.drawable.tile_moderate, R.drawable.tile_unhealthy,
            R.drawable.tile_very_unhealthy, R.drawable.tile_hazardous,
    };

    private boolean listening;

    static boolean added(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("added", false);
    }

    private static void setAdded(Context context, boolean added) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("added", added).apply();
    }

    // Asks Android to show the tile again, with the readings just fetched.
    static void ask(Context context) {
        if (!added(context)) return;
        try {
            TileService.requestListeningState(context, new ComponentName(context, PsiTile.class));
        } catch (RuntimeException e) {
            // Not added after all, or the shade's busy: it's drawn when next opened anyway.
        }
    }

    @Override
    public void onTileAdded() {
        super.onTileAdded();
        setAdded(this, true);
        ReadingsWorker.schedule(this);
    }

    @Override
    public void onTileRemoved() {
        super.onTileRemoved();
        setAdded(this, false);
        ReadingsWorker.stopIfIdle(this);
    }

    @Override
    public void onStartListening() {
        super.onStartListening();
        listening = true;
        // Added before the app kept track of it, or after its data was cleared.
        if (!added(this)) {
            setAdded(this, true);
            ReadingsWorker.schedule(this);
        }
        draw();
        if (Readings.stale(this)) {
            Context app = getApplicationContext();
            Handler main = new Handler(Looper.getMainLooper());
            WORK.execute(() -> {
                if (Readings.fetch(app)) {
                    main.post(() -> {
                        if (listening) draw();
                    });
                    Glance.redraw(app);
                }
            });
        }
    }

    @Override
    public void onStopListening() {
        listening = false;
        super.onStopListening();
    }

    private void draw() {
        Tile tile = getQsTile();
        if (tile == null) return;
        JSONObject r = Readings.saved(this);
        String here = Follow.on(this) ? Follow.region(this) : null;
        String region = here != null ? here : Readings.worstRegion(r);
        int value = region == null ? -1 : Readings.psi(r, region);
        tile.setIcon(Icon.createWithResource(this, ICONS[Math.max(Readings.psiLevel(value), 0)]));

        if (value < 0) {
            tile.setLabel(getString(R.string.tile_name));
            tile.setState(Tile.STATE_INACTIVE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) tile.setSubtitle(getString(R.string.tile_loading));
        } else {
            String band = Readings.psiLabel(value);
            String where = here != null ? getString(R.string.widget_here, Readings.label(region)) : Readings.label(region);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                tile.setLabel(getString(R.string.tile_value, value));
                tile.setSubtitle(band + " · " + where);
            } else {
                // No subtitle before Android 10: the band goes in the label.
                tile.setLabel(getString(R.string.tile_value, value) + " · " + band);
            }
            tile.setState(Readings.psiLevel(value) >= LIT_FROM_LEVEL ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
            tile.setContentDescription(getString(R.string.tile_description, value, band, where));
        }
        tile.updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        if (isLocked()) unlockAndRun(this::open);
        else open();
    }

    // The Intent overload, before Android 14 only, where the PendingIntent one doesn't exist.
    @SuppressWarnings("deprecation")
    @SuppressLint("StartActivityAndCollapseDeprecated")
    private void open() {
        // The Overview, through its uwu://sgpsi/ link (MainActivity.pageFor).
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("uwu://sgpsi/overview"), this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 2, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        } else {
            startActivityAndCollapse(intent);
        }
    }
}
