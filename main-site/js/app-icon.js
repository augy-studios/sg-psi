// The Android app's launcher icon following the PSI (android/.../LiveIcon.java): the switch
// under "App icon" in the theme window, shown only in the app. On by default. The app switches
// the icon itself, once it's off screen; turned off, the Good icon comes back the same way.
//
// Nothing here runs in a browser or the PWA, whose icons are fixed once installed: there, the
// tab's favicon and the brand logo follow the PSI instead (script.js, showState).
// Plain script, not a module; publishes nothing.

(function () {
  const AppBridge = window.AppBridge;
  if (!AppBridge?.native) return;

  AppBridge.ready(5000).then((ready) => {
    if (!ready || !AppBridge.has("liveicon")) return;
    const section = document.getElementById("appIcon");
    const input = document.getElementById("appIconSwitch");
    section.hidden = false;

    AppBridge.call("SgPsi", "liveIconState").then((state) => {
      input.checked = Boolean(state.on);
    }).catch(() => {});

    input.addEventListener("change", async () => {
      const on = input.checked;
      input.disabled = true;
      try {
        input.checked = Boolean((await AppBridge.call("SgPsi", "liveIcon", { on })).on);
      } catch {
        input.checked = !on;
      } finally {
        input.disabled = false;
      }
    });
  });
})();
