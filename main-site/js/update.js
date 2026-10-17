// Service worker registration and the bar along the top. The one place the site
// registers its worker, so the prompt has the registration to watch.
//
// One bar, one state, one precedence order (update-bar-spec.md): being offline
// outranks a new version being ready, and only the more urgent of the two draws.
// A new version never activates on its own: it waits until somebody presses Reload.
//
// In the Android app the same bar also says when a new version of the app itself is out
// (js/app-update.js), and its Update hands over to the app's own updater. The site's new
// version comes first, as it's one tap and the app's turn comes straight after the reload.
// Plain script, not a module: published on window.SgUpdate, for js/app-update.js.

(function () {
  const SW_URL = "/sw.js";

  const STRINGS = {
    label: "Update",
    ready: "A new version of SG PSI is ready.",
    reload: "Reload",
    later: "Not now",
    offlineLabel: "Offline",
    offline: "You're offline. Showing the last readings saved on this device.",
    appLabel: "App update",
    appReady: (version) => `Version ${version} of the SG PSI app is out.`,
    appUpdate: "Update",
  };

  let registration = null;
  let waitingWorker = null;
  let reloading = false;
  // For this page view only. Never stored: "Not now" means not now.
  let dismissed = false;
  let offline = !navigator.onLine;
  // A newer Android app than the one running, { version, ... } from /api/app-release, and
  // whether "Not now" was pressed on it.
  let appUpdate = null;
  let appDismissed = false;

  function watchForUpdate() {
    if (!registration) return;

    // A worker already waiting when the page opened. The ordinary case on the
    // second page view after a deploy.
    if (registration.waiting && navigator.serviceWorker.controller) {
      waitingWorker = registration.waiting;
      render();
    }

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;

      installing.addEventListener("statechange", () => {
        // `installed` with no controller is a first install, which has no
        // previous version on screen and nothing to prompt about.
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          waitingWorker = registration.waiting ?? installing;
          render();
        }
      });
    });

    // The browser only checks for a new worker on navigation, and this page
    // rarely navigates. Coming back to a tab left open since yesterday is the
    // moment to look. sw.js is served no-store, so this is one small request.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        registration.update().catch(() => {});
      }
    });
  }

  function registerWorker() {
    if (!("serviceWorker" in navigator)) return;

    // Only a page that was already running a version gets swapped. On a first
    // visit the worker claims the page so it can start caching, and that
    // controllerchange, from no controller to one, must not reload anything.
    let controller = navigator.serviceWorker.controller;

    navigator.serviceWorker
      .register(SW_URL)
      .then((reg) => {
        registration = reg;
        watchForUpdate();
      })
      .catch((cause) => {
        // A refused registration is not a reason to break the page. Private
        // browsing in some browsers, and any http origin that is not
        // localhost, land here.
        console.warn("service worker registration failed:", cause);
      });

    // The swap, once somebody has accepted it. Reloading here rather than in
    // the click handler means the reload is served by the new worker, not the
    // one being replaced. The flag stops a second controllerchange from
    // reloading mid-navigation.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      const previous = controller;
      controller = navigator.serviceWorker.controller;
      if (reloading || !previous) return;
      reloading = true;
      window.location.reload();
    });
  }

  function state() {
    if (offline) return "offline";
    if (waitingWorker && !dismissed) return "update";
    if (appUpdate && !appDismissed) return `app:${appUpdate.version}`;
    return null;
  }

  // The bar's height, as --notice-h, so the floating tray and the full screen map
  // start below it rather than under it.
  const sizer = new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty("--notice-h", `${entry.target.offsetHeight}px`);
  });

  function render() {
    const existing = document.querySelector(".update-notice:not(.is-leaving)");
    const now = state();

    if (!now) {
      if (existing) {
        sizer.disconnect();
        document.documentElement.style.setProperty("--notice-h", "0px");
        existing.classList.add("is-leaving");
        existing.addEventListener("animationend", () => existing.remove(), { once: true });
      }
      return;
    }
    if (existing?.dataset.state === now) return;

    const bar = existing ?? document.createElement("div");
    bar.className = "update-notice";
    bar.dataset.state = now;
    bar.setAttribute("role", "status");

    if (now === "offline") {
      bar.setAttribute("aria-label", STRINGS.offlineLabel);
      bar.innerHTML = `<div class="update-notice-inner"><p>${STRINGS.offline}</p></div>`;
    } else if (now.startsWith("app:")) {
      const version = appUpdate.version;
      bar.setAttribute("aria-label", STRINGS.appLabel);
      bar.innerHTML = `
        <div class="update-notice-inner">
          <p>${window.UwuUI.esc(STRINGS.appReady(version))}</p>
          <button type="button" class="btn" data-sw-update>${STRINGS.appUpdate}</button>
          <button type="button" class="btn secondary" data-sw-later>${STRINGS.later}</button>
        </div>
      `;

      bar.querySelector("[data-sw-update]").addEventListener("click", () => {
        // The app's update window downloads it, checks it, and opens Android's own
        // installer (android/.../UpdateActivity.java).
        window.AppBridge.call("SgPsi", "update", { check: false, version }).catch(() => {});
      });

      bar.querySelector("[data-sw-later]").addEventListener("click", () => {
        appDismissed = true;
        render();
      });
    } else {
      bar.setAttribute("aria-label", STRINGS.label);
      bar.innerHTML = `
        <div class="update-notice-inner">
          <p>${STRINGS.ready}</p>
          <button type="button" class="btn" data-sw-update>${STRINGS.reload}</button>
          <button type="button" class="btn secondary" data-sw-later>${STRINGS.later}</button>
        </div>
      `;

      bar.querySelector("[data-sw-update]").addEventListener("click", () => {
        // The only place anything asks for skipWaiting. The reload happens on
        // controllerchange, not here.
        waitingWorker?.postMessage("skip-waiting");
      });

      bar.querySelector("[data-sw-later]").addEventListener("click", () => {
        dismissed = true;
        render();
      });
    }

    if (!existing) {
      document.body.prepend(bar);
      sizer.observe(bar);
    }
  }

  window.SgUpdate = {
    // A newer Android app is out (js/app-update.js).
    offerAppUpdate(latest) {
      if (appUpdate?.version === latest.version) return;
      appUpdate = latest;
      appDismissed = false;
      render();
    },
    // Asks the server for a new worker now, rather than on the browser's own schedule: the
    // Edge Tray's "Check for updates". A new one found shows the bar as usual, once it has
    // installed.
    checkSiteUpdate() {
      return registration && navigator.onLine ? registration.update().catch(() => {}) : Promise.resolve();
    },
  };

  window.addEventListener("offline", () => {
    offline = true;
    render();
  });
  window.addEventListener("online", () => {
    offline = false;
    render();
  });
  render();

  // Registration on load, not immediately: installing fetches everything the
  // worker precaches, and competing with the page's own first load makes a
  // first visit slower for no gain.
  if (document.readyState === "complete") registerWorker();
  else window.addEventListener("load", registerWorker, { once: true });
})();
