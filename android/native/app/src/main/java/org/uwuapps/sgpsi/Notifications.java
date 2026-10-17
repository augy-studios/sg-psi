/*
 * The app's notification channels, each its own switch in Android's settings for the app:
 *
 *   alerts    PSI alerts: the 24-hour PSI reaching the level you picked, from the server
 *             (main-site/api/_push/notify.js), and "Where I am" arriving in a region already at
 *             it (Follow.java)
 *   morning   the 7am summary, from the server (main-site/api/cron/morning.js)
 *   releases  a new version of the app is out (main-site/api/push/release.js)
 *
 * The server's pushes name these channels (main-site/api/_push/fcm.js). Android only takes a
 * channel's sound and importance from when it's made, so changing one means a new id.
 */
package org.uwuapps.sgpsi;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

final class Notifications {
    static final String ALERTS = "alerts";
    static final String MORNING = "morning";
    static final String RELEASES = "releases";

    private Notifications() {}

    static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);

        NotificationChannel alerts = new NotificationChannel(ALERTS, "PSI alerts",
                NotificationManager.IMPORTANCE_HIGH);
        alerts.setDescription("When the 24-hour PSI where you picked reaches your level, changes band above it, or eases back");

        // Default, not high: a summary, not a warning, so it doesn't pop up over what you're doing.
        NotificationChannel morning = new NotificationChannel(MORNING, "Morning summary",
                NotificationManager.IMPORTANCE_DEFAULT);
        morning.setDescription("The PSI and PM2.5 at 7am, before you head out");

        NotificationChannel releases = new NotificationChannel(RELEASES, "New versions",
                NotificationManager.IMPORTANCE_DEFAULT);
        releases.setDescription("When a new version of the app is out");

        manager.createNotificationChannel(alerts);
        manager.createNotificationChannel(morning);
        manager.createNotificationChannel(releases);
    }

    static boolean allowed(Context context) {
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    // One of the app's own, opening the app, and replacing any other with the same tag. `level`,
    // a PSI band from 0 (Good) to 4, gives it that band's icon in colour beside the text: the
    // small icon in the status bar is only ever its shape.
    @SuppressWarnings("MissingPermission") // allowed() is checked first
    static boolean post(Context context, String channel, String tag, String title, String body, int level) {
        if (!allowed(context)) return false;
        Intent open = new Intent(context, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        NotificationCompat.Builder n = new NotificationCompat.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_notification_icon)
                .setColor(context.getColor(R.color.brand_ink))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(ALERTS.equals(channel) ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(PendingIntent.getActivity(context, tag.hashCode(), open,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        if (level >= 0 && level < PsiIconWidget.ICONS.length) {
            n.setLargeIcon(BitmapFactory.decodeResource(context.getResources(), PsiIconWidget.ICONS[level]));
        }
        NotificationManagerCompat.from(context).notify(tag, 0, n.build());
        return true;
    }
}
