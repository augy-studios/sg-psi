# SG PSI for Android

The Android app, `org.uwuapps.sgpsi`: the web app at sgpsi.uwuapps.org in
[Capacitor](https://capacitorjs.com)'s WebView (`capacitor.config.json`, `server.url`). The
site's own updates reach it at once, so the app only needs building again for its native parts.
Those are the things a web page can't do, which the page reaches through Capacitor's bridge
(`main-site/js/app-bridge.js`).

It's shared as an APK file through GitHub Releases (see `release/README.md`), and updates
itself from there.

## What it adds to the site

| Feature | Native side (`native/app/src/main/java/org/uwuapps/sgpsi/`) | Site side (`main-site/`) |
|---|---|---|
| **PSI alerts** as notifications. The WebView has no Web Push, so the app signs up with its Firebase Cloud Messaging token instead, and the server sends the same alerts through FCM | Capacitor's PushNotifications plugin, `Notifications` (channels) | `js/alerts.js`, `api/_push/fcm.js`, `api/_push/notify.js` |
| **Where I am**: an alerts area that follows the region you're in. Every half hour, with the app closed, the phone's rough position (cell towers and wifi) is matched to the nearest of NEA's five regions, and the server is told when it changes. Arriving in a region already at your alert level says so at once | `Follow`, `ReadingsWorker`, `SgPsiPlugin.follow` | `js/alerts.js`, `api/_push/validate.js` (`here`) |
| **Home screen widgets** (1.0.1: region choice, PM2.5 and wind). **SG PSI**: the 24-hour PSI and its band, the PM2.5 under it, and each region's PSI, band-coloured. **SG PM2.5**: the same for the 1-hour PM2.5. Each shows Singapore, one region or Where I am, picked as it's added and again from its title (or Android 12's reconfigure); the region shown big is outlined. **SG wind**: the average speed, where it's mostly from with an arrow, and the strongest station. Resizable; one row high, the region widgets drop the regions. Taps open the matching page: the reading's own, the other reading's from the line under it, the Map from a region, Wind from the wind widget | `RegionWidget` (`PsiWidget`, `Pm25Widget`), `WidgetConfigActivity`, `WindWidget`, `Readings`, `ReadingsWorker`, `res/layout/widget_psi.xml`, `widget_wind.xml` | `script.js` (`shareWithApp`) |
| **Quick Settings tile**: the PSI and band for your region (Where I am) or the worst one, its icon the gauge with the needle on that band, lit up from Unhealthy | `PsiTile`, `res/drawable/tile_*.xml` | none |
| **The launcher icon follows the PSI**: the gauge's needle and the mascot's face show the worst region's band, Good to Hazardous. On by default, switched off under **App icon** in the theme window. Android can't change an app's icon, so the manifest has five launcher entries (activity aliases), one per band, and only one is enabled; the switch waits until the app is off screen. **Some launchers (Pixel's, Samsung's) take the icon off the home screen at each change**, leaving it in the app drawer | `LiveIcon`, `ReadingsWorker`, the aliases in `AndroidManifest.xml` | `js/app-icon.js` |
| **SG PSI icon widget**: one cell, the same live icon with the PSI under it, which stays where it's put on every launcher | `PsiIconWidget`, `res/layout/widget_icon.xml` | none |
| **Morning summary** at 7am, opt-in | `SgPsiPlugin.setTopic` (FCM topic `sgpsi-morning`) | `js/alerts.js`, `api/cron/morning.js` |
| **Updating itself** from GitHub Releases: a bar at the top of the page when a new version is out, the Edge Tray's download button, "Check for updates", which also checks for a new site version, and an opt-in notification the moment a release is published. All use Android's own installer | `UpdateActivity`, `SgPsiPlugin.setTopic` (`sgpsi-releases`) | `js/app-update.js`, `js/update.js`, `api/app-release.js`, `api/push/release.js` |
| **App shortcuts** (1.0.1): long-press the app's icon for Map, Trends, Pollutants, Wind and Overview, each with its Edge Tray icon. Most launchers show the first four | `res/xml/shortcuts.xml` (on every icon alias), `res/drawable*/shortcut_*.xml` | none |
| **The site's own links** (`https://sgpsi.uwuapps.org/...`, verified by `.well-known/assetlinks.json`) and `uwu://sgpsi/` links: `uwu://sgpsi/map`, `/trends`, `/pollutants`, `/wind`, `/overview` open that view; `uwu://sgpsi/` opens the app as it is. The shortcuts, widgets and tile open their pages this way | `MainActivity` (`pageFor`, `page`) | `script.js` (`hashchange`) |
| **No status bar**, so the page has the whole screen; a swipe down from the top shows it for a moment, its icons following the page's light or dark mode | `MainActivity`, Capacitor's SystemBars | `js/app-bridge.js`, `style.css` (`data-statusbar`, `--safe-*`) |

The website and PWA lose nothing: everything a browser can do stays as it was, and these only
switch on when the page is running in the app. The Where I am button, the two switches under
"Also on this phone" and the update button are made visible by the page only in the app, so a
browser never sees them.

The widgets, the tile, the live launcher icon and Where I am share one background job,
`ReadingsWorker`, every half hour (NEA publishes hourly), only while one of them is in use. As
the live icon is on by default, that's from the first launch until it's switched off.
WorkManager keeps it going across restarts, so there's no boot receiver, exact alarm or
battery-optimisation exemption.

### The icons

All from the five state images in `main-site/icons/SGPSI-<band>.svg`, Good being the default:

- **Launcher**: `res/mipmap-*/ic_launcher[_<band>][_round|_foreground].png`, and
  `mipmap-anydpi-v26/` for the adaptive icons, whose foreground is the scene widened to fill the
  108dp layer, so a launcher's mask never shows an edge. Never rename the aliases or these: a
  phone with that entry enabled would be left with no launcher icon.
- **Splash screen**: `res/drawable-nodpi/splash_icon.png`, the Good scene at 1152px, the most
  the splash ever draws it at (288dp on the densest screens).
- **Notifications**: `res/drawable-*/ic_notification_icon.png`, the gauge and mascot in colour
  on nothing, as `main-site/SGPSI-badge.png`. Android's status bar draws only its shape; the
  app's own notifications also carry the band's icon in colour beside the text. Pushes from the server are shown by Android itself, with the app's
  icon where the phone's skin shows one (Samsung's, Xiaomi's).
- **Tile**: `res/drawable/tile_<band>.xml`, the gauge with its needle on each band.

Things the app deliberately doesn't do, from the ideas considered:

- **Precise or continuous location.** Where I am uses rough location every half hour. Regions
  are kilometres across, so GPS would only cost battery.
- **Reading the calendar, Bluetooth air purifiers, the wifi network's name, an overlay bubble,
  workout detection.** Each needs a sensitive permission for little an air quality app gains.
- **An ongoing notification with the PSI.** The tile and widget show it without a notification
  that never goes away.

### Permissions

| Permission | Asked | For |
|---|---|---|
| Notifications (`POST_NOTIFICATIONS`) | When you turn alerts or a switch on (Android 13 and later) | PSI alerts, the morning summary, new versions |
| Location, approximate (`ACCESS_COARSE_LOCATION`) | Only when you pick Where I am | Which region you're in |
| Location all the time (`ACCESS_BACKGROUND_LOCATION`) | Straight after, on Android 10 and later; from Android 11 it's a settings page where you choose **Allow all the time** | Finding the region with the app closed. Refused, Where I am isn't taken and the alerts stay as they were |
| Install unknown apps (`REQUEST_INSTALL_PACKAGES`) | The first update | `UpdateActivity` |
| Internet | Not asked: Android grants it | The site itself |

Only the region ever leaves the phone, never the position.

If the app ever goes on Google Play, that build has to drop `UpdateActivity` and
`REQUEST_INSTALL_PACKAGES` (Play updates apps itself), and needs Play's declaration for
background location, with a video of Where I am.

## The project

```text
android/
  package.json, package-lock.json   Capacitor and its push plugin
  capacitor.config.json             the site's address, and where the native project is
  www/offline.html                  shown when the site can't load at all (first launch offline)
  native/                           the Android Studio / Gradle project
  build-apk.ps1                     builds the signed APK into release/<version>/
  FIREBASE-SETUP.md                 setting up notifications
```

`npx cap sync android`, which the build script runs, copies `www/` and the config into
`native/` and links the plugins from `node_modules`. What it writes is kept out of git.

## Build the APK

From the project root, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File android\build-apk.ps1
```

That one command:

1. On the very first run, makes the signing key (`android.keystore` and `keystore.properties`)
   and writes its fingerprint into `main-site/.well-known/assetlinks.json`, replacing the
   template's placeholder.
2. Installs the npm packages if they're missing, and runs `npx cap sync android`.
3. Builds the release APK with Gradle, signed with that key.
4. Checks the signature against the fingerprint in `assetlinks.json`.
5. Copies the result to `release/<version>/sg-psi-<version>.apk`, with `<version>` taken from
   `versionName` in `native/app/build.gradle`.

(`npm run build` from inside `android/` runs the same script.)

It needs a JDK 21 or later (it finds the newest under Program Files, or `JAVA_HOME`) and the
Android SDK (`ANDROID_HOME`, the one Bubblewrap left in `~/.bubblewrap`, or Android Studio's in
`%LOCALAPPDATA%\Android\Sdk`). Gradle fetches any SDK platform it's missing.

**For a new version**, raise both of these in `native/app/build.gradle` first:

```groovy
versionCode 2          // a whole number, one higher each release: phones only update to a higher one
versionName "1.0.1"    // what people see, and the release folder's name
```

If `release/<version>/` already has an APK, the script warns and replaces it.

Without `native/app/google-services.json` the app builds and works, but has no notifications,
and no Where I am. See `FIREBASE-SETUP.md`.

To try changes on a phone over USB, open `native/` in Android Studio and run it, or use
`native\gradlew.bat installDebug` with the phone plugged in and USB debugging on. A debug build
is signed with Android Studio's debug key, so uninstall it before installing a release APK.

## The first build: back up the key

The first build prints the new key's fingerprint and asks for two things:

1. **Back up `android\android.keystore` and `android\keystore.properties`** somewhere safe and
   private, such as a password manager. Both are kept out of git. An APK signed with a
   different key can't update one already installed, so losing them means every user has to
   uninstall and reinstall.
2. **Commit and deploy `main-site/.well-known/assetlinks.json`**. It lists this key's
   fingerprint, which is what lets the site's links open in the app.

From then on, the script refuses to build if the keystore is missing (restore it from your
backup), and refuses an APK signed with any key other than the one `assetlinks.json` names.

## Google's developer verification

From 30 September 2026, Android in Singapore (with Brazil, Indonesia and Thailand) checks that
apps come from a verified developer, starting with installs through participating app stores,
with more to follow in 2027. To stay ahead of it and keep Play Protect from warning about the
APK:

1. Sign up on the [Android Developer Console](https://developer.android.com/developer-verification/guides/android-developer-console),
   or use the account you made for SG Bus Timings.
2. Register the package `org.uwuapps.sgpsi` with the SHA-256 fingerprint in
   `assetlinks.json`.

Check [Google's guide](https://developer.android.com/developer-verification/guides) for the
current steps; they were still settling in October 2026.

## Install it

Copy the APK to the phone and open it. Android asks to allow installing apps from wherever it
was opened (Files, Chrome, Telegram); allow it once. After that, the app updates itself.

## Checking it by hand

On a phone with the app installed (with Firebase set up for the first three):

- **Alerts**: the bell in the Edge Tray, then **Turn alerts on** and **Send test alert**. It
  arrives within seconds, with the app open or closed.
- **Where I am**: pick it, allow location and then **Allow all the time**. The note names the
  region you're in. Refuse it, and the note says to allow it in Android's settings, with a
  button there.
- **Switches**: **Morning summary** and **New versions of the app** under "Also on this phone"
  (`FIREBASE-SETUP.md`, step 7, sends one of each without waiting).
- **Widgets**: long-press the home screen, **Widgets**, **SG PSI**. It asks which region; pick
  West, and it shows the West's PSI big with West outlined. Its title asks again. The arrow
  refreshes it; shrink it to one row and the regions go. Tapping the PSI opens the Overview,
  the PM2.5 line Trends, a region the Map. **SG PM2.5** the same, opening Trends. **SG wind**
  shows an arrow the way the wind blows, and opens Wind.
- **Shortcuts**: long-press the app's icon: Map, Trends, Pollutants and Wind, each with its icon,
  each opening its view. Also with the launcher icon on another band (they're on every alias).
- **uwu links**: from another app (a note, a chat), open `uwu://sgpsi/wind`: the app opens on
  Wind.
- **Tile**: pull down Quick Settings twice, the pencil, and drag **SG PSI** in. It shows the
  PSI and band; tapping it opens the app.
- **Updates**: the Edge Tray's circled download button says you have the newest version.
- **Icon**: with the PSI above Good, leave the app (Home). The launcher icon changes within a
  few seconds; if it's gone from the home screen, it's in the app drawer. Switch it off under
  **App icon** in the theme window and leave the app again: Good comes back. The **SG PSI icon**
  widget shows the same icon.
- **Links**: open `https://sgpsi.uwuapps.org/#map` from another app. It opens the Map in the
  app, not the browser. If it opens the browser, `assetlinks.json` isn't deployed with this key
  yet.

## Changing it

- **The site's address, the user agent, the status bars**: `capacitor.config.json`, then
  `npx cap sync android`.
- **Permissions, activities, links, the widget, the tile**: `native/app/src/main/AndroidManifest.xml`.
- **Something new the page can ask the app for**: a `@PluginMethod` in `SgPsiPlugin`, called
  from the page with `AppBridge.call("SgPsi", "method", {...})`. Add a word to `info`'s
  `features` so the page can tell builds with it from builds without.
- **The bands**: `Readings.java` has NEA's thresholds and colours for the widget and tile, as
  `main-site/js/bands.js` and `api/_lib/bands.js` do. Keep all three in step.
- **A Capacitor plugin from npm**: `npm install` it here, then `npx cap sync android`; the page
  reaches it the same way.
- **Upgrading Capacitor**: raise the `@capacitor/*` versions in `package.json` together (the
  push plugin's numbers run on their own, so take its newest for that Capacitor), `npm install`,
  `npx cap sync android`, and compare `native/` with a fresh `npx cap add android` for template
  changes.

`npm audit` reports a moderate advisory in `uuid`, through `@capacitor/cli`'s iOS tooling
(`xcode`). It's a build-time tool that never reaches the app, and the suggested fix downgrades
Capacitor, so leave it until Capacitor updates it.
