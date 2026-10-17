/*
 * The "SG PM2.5" widget: the 1-hour PM2.5 for the region picked, its band, the PSI under it,
 * and every region's PM2.5 (RegionWidget). The hourly figure moves faster than the 24-hour
 * PSI, so haze shows here first. A tap opens Trends.
 */
package org.uwuapps.sgpsi;

import android.content.Context;

public class Pm25Widget extends RegionWidget {
    @Override
    boolean pm25() {
        return true;
    }

    static int[] allIds(Context context) {
        return allIds(context, Pm25Widget.class);
    }

    static void drawAll(Context context) {
        drawAll(context, Pm25Widget.class, true);
    }
}
