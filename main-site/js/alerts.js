// PSI alerts: a notification when the 24-hour PSI in a chosen area reaches a chosen
// band, while the site is closed. The page subscribes to Web Push and tells
// /api/push/devices which area and level it wants; the collect cron
// (api/cron/collect.js) compares each new reading with the last and pushes.
// The subscribing follows sgbus-timings' js/alerts.js.
//
// In the Android app (android/), whose WebView has no Web Push, the app registers with
// Firebase Cloud Messaging instead (Capacitor's PushNotifications plugin, js/app-bridge.js),
// and the "subscription" sent to the server is { fcm: token }, which it pushes to through FCM
// (api/_push/fcm.js). The app adds three things the website can't do, shown only there:
//
//   "Where I am"     an area that follows the region the phone is in, from rough location
//                    in the background (SgPsiPlugin.follow, Follow.java)
//   Morning summary  the PSI at 7am (api/cron/morning.js), an FCM topic the app joins
//   New versions     a new version of the app is out (api/push/release.js), the same
//
// Plain script, not a module: published on window.SgAlerts.

(function () {
  const { REGION_LABELS, PSI_BANDS } = window.SgPsi;
  const AppBridge = window.AppBridge;

  const API_BASE = "/api/push";
  const PREFS_KEY = "sgpsi.alerts";
  const DEVICE_KEY = "sgpsi.pushDeviceId";
  const AREAS = ["here", "islandwide", "north", "south", "east", "west", "central"];
  const LEVELS = ["moderate", "unhealthy", "very-unhealthy", "hazardous"];
  const DEFAULTS = { on: false, area: "islandwide", level: "unhealthy" };

  const $ = (sel) => document.querySelector(sel);
  const inApp = () => Boolean(AppBridge?.native);

  const PROBLEMS = {
    unsupported: "This browser can't receive notifications. On iPhone or iPad, add SG PSI to your Home Screen, open it from there, and try again.",
    denied: "Notifications are blocked for this site. Allow them in your browser's site settings, then try again.",
    failed: "Couldn't reach the alerts server. Try again in a minute.",
    "app-unsupported": "This copy of the app can't get alerts. Check for a newer one with the download button in the menu.",
    "app-denied": "Notifications are off for SG PSI in Android's settings. Turn them on there, then try again.",
    "here-denied": "To follow where you are, SG PSI needs your location. Allow it in Android's settings, or pick a region.",
    "here-background": "To follow where you are with the app closed, SG PSI needs location set to \"Allow all the time\". Choose it in Android's settings, or pick a region.",
    "here-unsupported": "This phone has no Google Play services, which \"Where I am\" needs. Pick a region instead.",
  };
  // The problems Android's settings put right, and which of its pages opens for each.
  const SETTINGS = { "app-denied": "notifications", "here-denied": "app", "here-background": "app" };
  // What SgPsiPlugin.follow answers, as a problem.
  const FOLLOW_PROBLEMS = { denied: "here-denied", "needs-background": "here-background", unsupported: "here-unsupported" };

  // "Where I am", as the app last said: the region it found, and whether it may still look.
  let follow = { region: null, allowed: true };

  function prefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (saved && AREAS.includes(saved.area) && LEVELS.includes(saved.level)) {
        // "Where I am" is the app's alone.
        const area = saved.area === "here" && !inApp() ? DEFAULTS.area : saved.area;
        return { ...DEFAULTS, ...saved, area, on: saved.on === true };
      }
    } catch {}
    return { ...DEFAULTS };
  }

  function save(p) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {}
  }

  function deviceId() {
    let id = null;
    try {
      id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(DEVICE_KEY, id);
      }
    } catch {}
    return id || crypto.randomUUID();
  }

  function pushSupported() {
    if (inApp()) return AppBridge.has("push");
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  // "granted", "denied" or "default", as Notification.permission says it. In the app, Android's
  // own, through Capacitor's PushNotifications (Android 13 and later ask; before, it's granted).
  async function permission({ ask = false } = {}) {
    if (!inApp()) {
      if (Notification.permission !== "default" || !ask) return Notification.permission;
      return Notification.requestPermission();
    }
    const now = (await AppBridge.call("PushNotifications", "checkPermissions")).receive;
    const state = now === "granted" || !ask ? now : (await AppBridge.call("PushNotifications", "requestPermissions")).receive;
    return state === "granted" ? "granted" : state === "denied" ? "denied" : "default";
  }

  const floorOf = (level) => PSI_BANDS[PSI_BANDS.findIndex((b) => b.id === level) - 1].max + 1;
  const labelOf = (level) => PSI_BANDS.find((b) => b.id === level).label;

  function areaText(area) {
    if (area === "here") return follow.region ? `where you are (the ${REGION_LABELS[follow.region]} just now)` : "where you are";
    return area === "islandwide" ? "any region" : `the ${REGION_LABELS[area]}`;
  }

  function noteFor(p) {
    if (!p.on) return "Alerts are off. Pick where and when, then turn them on.";
    const text = `You'll be notified when the 24-hour PSI in ${areaText(p.area)} reaches ${labelOf(p.level).toLowerCase()} (${floorOf(p.level)} or more), when it changes band above that, and when it eases back.`;
    if (p.area === "here" && !follow.allowed) {
      return `${text} Location isn't allowed all the time just now, so they stay with the last region found.`;
    }
    return text;
  }

  // Draws the modal's state, and the header button's icon.
  function show(p, problem) {
    document.querySelectorAll("[data-alert-area]").forEach((btn) => {
      const on = btn.dataset.alertArea === p.area;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    document.querySelectorAll("[data-alert-level]").forEach((btn) => {
      const on = btn.dataset.alertLevel === p.level;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    const toggle = $("#alertsToggle");
    toggle.textContent = p.on ? "Turn alerts off" : "Turn alerts on";
    toggle.classList.toggle("secondary", p.on);
    $("#alertsTest").hidden = !p.on;
    note(problem ? PROBLEMS[problem] : noteFor(p), problem ? "bad" : "", SETTINGS[problem]);

    const icon = $("#alertsBtn [data-icon]");
    icon.setAttribute("data-icon", p.on ? "bell-on" : "bell");
    $("#alertsBtn").setAttribute("aria-label", p.on ? "PSI alerts, on" : "PSI alerts");
    window.UwuUI.hydrateIcons($("#alertsBtn"));
  }

  // `settings`, in the app: which of Android's settings pages a button under the note opens.
  function note(text, tone, settings) {
    $("#alertsNote").textContent = text;
    $("#alertsNote").dataset.tone = tone;
    const button = $("#alertsSettings");
    button.hidden = !(inApp() && settings);
    button.dataset.what = settings || "";
  }

  // navigator.serviceWorker.ready never settles if registration failed, so it gets a
  // time limit.
  function readyRegistration() {
    return Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error("service worker not ready")), 10_000)),
    ]);
  }

  async function fetchPublicKey() {
    const res = await fetch(`${API_BASE}/vapid-key`);
    if (!res.ok) throw new Error(`alerts server replied ${res.status}`);
    const { publicKey } = await res.json();
    const b64 = (publicKey + "=".repeat((4 - (publicKey.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }

  // The app's FCM token, from PushNotifications.register(): its answer comes as an event.
  let fcmToken = null;
  function appToken() {
    if (fcmToken) return Promise.resolve(fcmToken);
    return new Promise((resolve, reject) => {
      const ok = AppBridge.on("PushNotifications", "registration", (t) => {
        ok.remove();
        bad.remove();
        fcmToken = t.value;
        resolve(fcmToken);
      });
      const bad = AppBridge.on("PushNotifications", "registrationError", (e) => {
        ok.remove();
        bad.remove();
        reject(new Error(e?.error || "FCM registration failed"));
      });
      AppBridge.call("PushNotifications", "register").catch(reject);
      setTimeout(() => reject(new Error("FCM registration timed out")), 20_000);
    });
  }

  // What the server pushes to: a Web Push subscription, or in the app { fcm: token }. Either
  // way it has toJSON(), as a PushSubscription does.
  async function subscription() {
    if (inApp()) {
      const fcm = await appToken();
      return { toJSON: () => ({ fcm }) };
    }
    const reg = await readyRegistration();
    return (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: await fetchPublicKey(),
    });
  }

  async function subscribe(p) {
    const sub = await subscription();
    const body = { subscription: sub.toJSON(), area: p.area, level: p.level };
    // Until the app has found it, "Any region" stands in.
    if (p.area === "here") body.region = follow.region || "islandwide";
    const res = await fetch(`${API_BASE}/devices/${deviceId()}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`alerts server replied ${res.status}`);
  }

  // Unsubscribe and have the server forget this device. Browsers don't let a page
  // revoke notification permission itself; this is the closest it gets. In the app the FCM
  // token stays: it's the app's, and the morning summary and new versions use it too.
  async function unsubscribe() {
    if (!inApp()) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        await (await reg?.pushManager.getSubscription())?.unsubscribe();
      } catch (err) {
        console.warn("unsubscribe failed:", err);
      }
    }
    try {
      await fetch(`${API_BASE}/devices/${deviceId()}`, { method: "DELETE" });
    } catch (err) {
      // The subscription is already gone, so the server drops the device the first
      // time a push to it fails.
      console.warn("device delete failed:", err);
    }
  }

  /* -- "Where I am", in the app -- */

  // Hands the app what it needs to tell the server itself when the region changes, asking for
  // location first if it hasn't got it. A problem's key, or null once it's following.
  async function startFollow(p) {
    note("Finding where you are…", "");
    const answer = await AppBridge.call("SgPsi", "follow", { on: true, deviceId: deviceId(), token: await appToken(), level: p.level });
    if (answer.state !== "on") return FOLLOW_PROBLEMS[answer.state] || "failed";
    follow = { region: answer.region || null, allowed: true };
    return null;
  }

  function stopFollow() {
    follow = { region: null, allowed: true };
    return AppBridge.call("SgPsi", "follow", { on: false }).catch(() => {});
  }

  let busy = false;

  // `change` is what was just picked; turning on asks for permission first.
  async function apply(change) {
    if (busy) return;
    const previous = prefs();
    const next = { ...previous, ...change };
    const leavingHere = inApp() && previous.on && previous.area === "here" && (!next.on || next.area !== "here");

    if (!next.on) {
      save(next);
      show(next);
      if (leavingHere) await stopFollow();
      if (previous.on && pushSupported()) await unsubscribe();
      return;
    }
    if (!pushSupported()) return show({ ...next, on: false }, inApp() ? "app-unsupported" : "unsupported");

    busy = true;
    try {
      const perm = await permission({ ask: true });
      if (perm !== "granted") return show({ ...next, on: false }, inApp() ? "app-denied" : "denied");
      if (inApp() && next.area === "here") {
        const problem = await startFollow(next);
        if (problem) {
          // As it was, on or off, with "Where I am" not taken.
          return show(previous.on ? previous : { ...next, on: false }, problem);
        }
      } else if (leavingHere) {
        await stopFollow();
      }
      show(next);
      await subscribe(next);
      save(next);
    } catch (err) {
      console.warn("PSI alerts unavailable:", err);
      show(previous, "failed");
    } finally {
      busy = false;
    }
  }

  const postTest = () => fetch(`${API_BASE}/devices/${deviceId()}`, { method: "POST" });

  // Has the server push to this device the way a real alert comes, so a missing key, a
  // dead subscription or muted notifications show up now, not at the next band change.
  async function test() {
    if (busy) return;
    busy = true;
    $("#alertsTest").disabled = true;
    try {
      let res = await postTest();
      // The server doesn't know this device, or its subscription has died: sign up
      // again, with a fresh subscription if it died, and try once more.
      if (res.status === 404 || res.status === 410) {
        if (res.status === 410) {
          if (inApp()) fcmToken = null;
          else await (await (await readyRegistration()).pushManager.getSubscription())?.unsubscribe();
        }
        await subscribe(prefs());
        res = await postTest();
      }
      if (res.ok) {
        note(inApp()
          ? "Test alert sent. Nothing within a minute? Check that SG PSI's notifications aren't turned off in Android's settings, or held back by Do Not Disturb."
          : "Test alert sent. Nothing within a minute? Check that notifications from this browser aren't muted or held back by Do Not Disturb.", "");
      } else if (res.status === 429) {
        note("A test alert was just sent. Try again in a few seconds.", "");
      } else {
        const { error } = await res.json().catch(() => ({}));
        note(`Couldn't send a test alert: ${error || `the server replied ${res.status}`}.`, "bad");
      }
    } catch (err) {
      console.warn("test alert failed:", err);
      note(PROBLEMS.failed, "bad");
    } finally {
      busy = false;
      $("#alertsTest").disabled = false;
    }
  }

  // Re-sends the choice on every load, which also refreshes the subscription. A
  // permission revoked in the browser's settings turns alerts off here too. In the app with
  // "Where I am", the app is handed the token and level again and looks where you are.
  async function resync() {
    const p = prefs();
    if (!p.on) return;
    if (!pushSupported() || (await permission().catch(() => "denied")) !== "granted") {
      const off = { ...p, on: false };
      save(off);
      show(off);
      if (inApp() && p.area === "here") stopFollow();
      return;
    }
    try {
      if (inApp() && p.area === "here") {
        const state = await AppBridge.call("SgPsi", "followState");
        follow = { region: state.region || null, allowed: Boolean(state.allowed) };
        // Asked again only while it's allowed: a page load never brings up a prompt.
        if (state.allowed) await startFollow(p);
        show(p);
      }
      await subscribe(p);
    } catch (err) {
      console.warn("PSI alerts resync failed:", err);
    }
  }

  /* -- The app's own notifications: the morning summary and new versions -- */

  const topicSwitches = () => [...document.querySelectorAll("[data-app-topic]")];

  async function refreshTopics() {
    try {
      const topics = await AppBridge.call("SgPsi", "topics");
      topicSwitches().forEach((input) => {
        input.checked = Boolean(topics[input.dataset.appTopic]);
      });
    } catch {
      // The switches stay as drawn.
    }
  }

  async function toggleTopic(input) {
    const on = input.checked;
    input.disabled = true;
    try {
      if (on && (await permission({ ask: true })) !== "granted") {
        input.checked = false;
        note(PROBLEMS["app-denied"], "bad", SETTINGS["app-denied"]);
        return;
      }
      await AppBridge.call("SgPsi", "setTopic", { topic: input.dataset.appTopic, on });
    } catch (err) {
      input.checked = !on;
      note(err?.message || PROBLEMS.failed, "bad");
    } finally {
      input.disabled = false;
    }
  }

  function initApp() {
    AppBridge.ready(5000).then((ready) => {
      if (!ready) return;
      if (AppBridge.has("follow")) $("#alertAreaHere").hidden = false;
      if (AppBridge.has("topics")) {
        $("#appNotify").hidden = false;
        topicSwitches().forEach((input) => input.addEventListener("change", () => toggleTopic(input)));
        refreshTopics();
      }
      show(prefs());
      resync();
    });

    $("#alertsSettings").addEventListener("click", (e) => {
      AppBridge.call("SgPsi", "openSettings", { what: e.currentTarget.dataset.what || "app" }).catch(() => {});
    });
    // Back from Android's settings with the window open: what changed there shows here.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || $("#alertsModal").classList.contains("hidden")) return;
      if (AppBridge.has("topics")) refreshTopics();
      AppBridge.call("SgPsi", "followState").then((state) => {
        follow = { region: state.region || null, allowed: Boolean(state.allowed) };
        if (!busy) show(prefs());
      }).catch(() => {});
    });
    $("#alertsBtn").addEventListener("click", () => {
      if (AppBridge.has("topics")) refreshTopics();
    });
  }

  function init() {
    $("#alertAreas").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-alert-area]");
      if (!btn) return;
      const p = prefs();
      if (p.on) apply({ area: btn.dataset.alertArea });
      else {
        save({ ...p, area: btn.dataset.alertArea });
        show(prefs());
      }
    });
    $("#alertLevels").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-alert-level]");
      if (!btn) return;
      const p = prefs();
      if (p.on) apply({ level: btn.dataset.alertLevel });
      else {
        save({ ...p, level: btn.dataset.alertLevel });
        show(prefs());
      }
    });
    $("#alertsToggle").addEventListener("click", () => apply({ on: !prefs().on }));
    $("#alertsTest").addEventListener("click", test);

    show(prefs());
    // In the app, once it has said what it can do.
    if (inApp()) initApp();
    else resync();
  }

  window.SgAlerts = { init };
})();
