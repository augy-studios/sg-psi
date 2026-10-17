/*
 * Every half hour, while something needs it: fetches the latest readings (Readings), redraws
 * the home screen widgets, the Quick Settings tile and the launcher icon (Glance), and works
 * out which region you're in for "Where I am" (Follow). Only with a connection, and only while
 * there's a widget, the tile, the live launcher icon (LiveIcon, on by default) or "Where I am";
 * with none of them it cancels itself.
 *
 * NEA publishes hourly, so half an hour keeps everything within one reading of the latest
 * without waking the phone more than that. WorkManager keeps the schedule across restarts
 * and app updates by itself, so there's no boot receiver, and needs no exact alarms or
 * battery-optimisation exemption.
 */
package org.uwuapps.sgpsi;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

public class ReadingsWorker extends Worker {
    private static final String NAME = "readings";
    private static final String NOW = "readings-now";

    public ReadingsWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    private static Constraints online() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    }

    // Kept as it is if it's already scheduled, so the half hours don't keep starting over.
    static void schedule(Context context) {
        PeriodicWorkRequest work = new PeriodicWorkRequest.Builder(ReadingsWorker.class, 30, TimeUnit.MINUTES)
                .setConstraints(online())
                .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, work);
    }

    // Once, as soon as there's a connection: a widget just added, or "Where I am" just on.
    static void runSoon(Context context) {
        OneTimeWorkRequest work = new OneTimeWorkRequest.Builder(ReadingsWorker.class)
                .setConstraints(online())
                .build();
        WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, work);
    }

    static boolean needed(Context context) {
        return PsiWidget.allIds(context).length > 0 || Pm25Widget.allIds(context).length > 0
                || WindWidget.allIds(context).length > 0 || PsiIconWidget.allIds(context).length > 0
                || PsiTile.added(context) || Follow.on(context) || LiveIcon.on(context);
    }

    static void stopIfIdle(Context context) {
        if (!needed(context)) WorkManager.getInstance(context).cancelUniqueWork(NAME);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        if (!needed(c)) {
            WorkManager.getInstance(c).cancelUniqueWork(NAME);
            return Result.success();
        }
        Readings.fetch(c);
        Glance.redraw(c);
        // After the readings, so a warning on arriving somewhere is about the latest.
        Follow.check(c);
        return Result.success();
    }
}
