/*
 * Everything that shows the readings with the app closed, redrawn from those kept on the phone
 * (Readings): both home screen widgets, the Quick Settings tile, and the launcher icon. Called
 * whenever the readings change: ReadingsWorker, a widget's refresh, the tile's own fetch, and
 * the page handing over what it loaded (SgPsiPlugin.readings).
 */
package org.uwuapps.sgpsi;

import android.content.Context;

final class Glance {
    private Glance() {}

    static void redraw(Context context) {
        PsiWidget.drawAll(context);
        PsiIconWidget.drawAll(context);
        PsiTile.ask(context);
        LiveIcon.update(context);
    }
}
