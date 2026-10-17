/*
 * The "SG PSI" widget: the 24-hour PSI for the region picked, its band, the PM2.5 under it,
 * and every region's PSI (RegionWidget). Kept under this name, which 1.0.0 placed on home
 * screens: renaming it would take those widgets away.
 */
package org.uwuapps.sgpsi;

import android.content.Context;

public class PsiWidget extends RegionWidget {
    @Override
    boolean pm25() {
        return false;
    }

    static int[] allIds(Context context) {
        return allIds(context, PsiWidget.class);
    }

    static void drawAll(Context context) {
        drawAll(context, PsiWidget.class, false);
    }
}
