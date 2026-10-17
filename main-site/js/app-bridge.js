// The channel to the Android app (android/), when the site is open in it: what the app can do
// for the page that a web page can't do for itself. The app is Capacitor: the site runs in its
// own WebView, which injects window.Capacitor before the page's scripts, and calls go straight
// to its plugin (android/native/app/src/main/java/org/uwuapps/sgpsi/SgPsiPlugin.java).
//
// In a browser or the PWA there's no window.Capacitor, and the page carries on as a website
// with everything it already has.
//
//   AppBridge.native                    true in the app
//   AppBridge.has("follow")             whether the app says it can
//   AppBridge.ready(ms)                 resolves true once the app has answered, false after ms
//   AppBridge.call(plugin, method, {})  a plugin's answer
//   AppBridge.on(plugin, event, fn)     a plugin's events, as { remove() }
//   AppBridge.version()                 the app's version, such as "1.0.0"
//
// Also, in the app: the status bar's icons follow the page's light or dark mode, not the
// phone's, and there's no status bar to leave room for (data-statusbar="hidden", style.css).
// Following uwuHere's and sgbus-timings' js/app-bridge.js.
// Plain script, not a module: published on window.AppBridge.

(function () {
  const cap = window.Capacitor;
  const native = Boolean(cap && typeof cap.nativePromise === "function" && cap.getPlatform?.() === "android");

  let info = null;
  const waiting = [];

  function call(plugin, method, options = {}) {
    return native ? cap.nativePromise(plugin, method, options) : Promise.reject(new Error("Not in the app."));
  }

  // Capacitor's own bridge has addListener on window.Capacitor. Outside the app, nothing is
  // ever said.
  function on(plugin, event, fn) {
    if (!native || typeof cap.addListener !== "function") return { remove() {} };
    try {
      return cap.addListener(plugin, event, (data, err) => {
        if (!err) fn(data);
      });
    } catch {
      return { remove() {} };
    }
  }

  function heard(answer) {
    info = answer;
    waiting.splice(0).forEach((resolve) => resolve(true));
  }

  function ready(ms = 1500) {
    if (info) return Promise.resolve(true);
    if (!native) return Promise.resolve(false);
    return new Promise((resolve) => {
      waiting.push(resolve);
      setTimeout(() => resolve(false), ms);
    });
  }

  // The site picks light or dark itself (js/theme.js), whatever the phone is set to, so the
  // status bar's icons are told which: dark icons on the light page, light on the dark.
  function syncBars() {
    const style = document.documentElement.getAttribute("data-mode") === "dark" ? "DARK" : "LIGHT";
    call("SystemBars", "setStyle", { style }).catch(() => {});
  }

  if (native) {
    document.documentElement.setAttribute("data-app", "android");
    // Read from the user agent, not SgPsi.info, so the page is laid out right from the start.
    // Every version hides the status bar (MainActivity.java); the number is there for one that
    // doesn't.
    const build = Number(/SGPSIApp\/(\d+)/.exec(navigator.userAgent)?.[1] || 0);
    if (build >= 1) document.documentElement.setAttribute("data-statusbar", "hidden");
    call("SgPsi", "info")
      .then(heard)
      .catch(() => heard({ features: [] }));

    syncBars();
    new MutationObserver(syncBars).observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode"] });
  }

  window.AppBridge = {
    native,
    has: (feature) => Boolean(info?.features?.includes(feature)),
    ready,
    call,
    on,
    version: () => info?.version || null,
  };
})();
