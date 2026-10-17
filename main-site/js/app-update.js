// The Android app (android/) keeping itself up to date. The app says its version
// (js/app-bridge.js), and /api/app-release the newest one on GitHub; a newer one shows in the
// update bar (js/update.js), whose Update opens the app's update window (UpdateActivity.java).
// That downloads the APK, checks it, and hands it to Android's own installer.
//
// Looked up as the page opens, and again on coming back to it after UPDATE_CHECK_MS, as the
// app can stay open for days. "Not now" lasts this page view only, as for the site's own
// update.
//
// The Edge Tray's download button, "Check for updates", looks whenever you like: it asks for
// a new site version too, and opens the update window, which says if you have the newest app
// and asks before downloading one.
//
// Nothing here runs in a browser or the PWA. Following uwuHere's js/app-update.js.
// Plain script, not a module; publishes nothing.

(function () {
  const AppBridge = window.AppBridge;
  if (!AppBridge?.native) return;

  const UPDATE_CHECK_MS = 60 * 60 * 1000;
  let checkedAt = 0;

  // Whether version a comes after version b, number by number: 1.10.0 after 1.9.0. The same
  // as newer() in api/_lib/release.js and UpdateActivity.java.
  function newer(a, b) {
    const x = String(a).split(".").map((n) => parseInt(n, 10) || 0);
    const y = String(b).split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0;
    }
    return false;
  }

  async function check() {
    checkedAt = Date.now();
    let latest;
    try {
      const response = await fetch("/api/app-release", { cache: "no-store" });
      if (!response.ok) return;
      latest = await response.json();
    } catch {
      return; // Offline: next time.
    }
    const running = AppBridge.version();
    if (latest?.version && running && newer(latest.version, running)) window.SgUpdate?.offerAppUpdate(latest);
  }

  // Between alerts and theme: the tray's global actions (edge-tray-spec.md).
  function addTrayButton() {
    const theme = document.getElementById("themeBtn");
    if (!theme || document.getElementById("appUpdateBtn")) return;
    const button = document.createElement("button");
    button.id = "appUpdateBtn";
    button.className = "glass-btn";
    button.type = "button";
    button.setAttribute("aria-label", "Check for updates");
    button.title = "Check for updates";
    button.innerHTML = `<span data-icon="download"></span>`;
    button.addEventListener("click", () => {
      window.SgUpdate?.checkSiteUpdate();
      AppBridge.call("SgPsi", "update", { check: true }).catch(() => {});
    });
    theme.before(button);
    window.UwuUI.hydrateIcons(button);
  }

  AppBridge.ready(5000).then((inApp) => {
    if (!inApp || !AppBridge.has("update")) return;
    if (AppBridge.has("checkupdate")) addTrayButton();

    check();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && Date.now() - checkedAt > UPDATE_CHECK_MS) check();
    });
  });
})();
