// PSI alerts: a notification when the 24-hour PSI in a chosen area reaches a chosen
// band, while the site is closed. The page subscribes to Web Push and tells
// /api/push/devices which area and level it wants; the collect cron
// (api/cron/collect.js) compares each new reading with the last and pushes.
// The subscribing follows sgbus-timings' js/alerts.js.
// Plain script, not a module: published on window.SgAlerts.

(function () {
  const { REGION_LABELS, PSI_BANDS } = window.SgPsi;

  const API_BASE = "/api/push";
  const PREFS_KEY = "sgpsi.alerts";
  const DEVICE_KEY = "sgpsi.pushDeviceId";
  const AREAS = ["islandwide", "north", "south", "east", "west", "central"];
  const LEVELS = ["moderate", "unhealthy", "very-unhealthy", "hazardous"];
  const DEFAULTS = { on: false, area: "islandwide", level: "unhealthy" };

  const $ = (sel) => document.querySelector(sel);

  const PROBLEMS = {
    unsupported: "This browser can't receive notifications. On iPhone or iPad, add SG PSI to your Home Screen, open it from there, and try again.",
    denied: "Notifications are blocked for this site. Allow them in your browser's site settings, then try again.",
    failed: "Couldn't reach the alerts server. Try again in a minute.",
  };

  function prefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (saved && AREAS.includes(saved.area) && LEVELS.includes(saved.level)) return { ...DEFAULTS, ...saved, on: saved.on === true };
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

  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  const floorOf = (level) => PSI_BANDS[PSI_BANDS.findIndex((b) => b.id === level) - 1].max + 1;
  const labelOf = (level) => PSI_BANDS.find((b) => b.id === level).label;
  const areaText = (area) => (area === "islandwide" ? "any region" : `the ${REGION_LABELS[area]}`);

  function noteFor(p) {
    if (!p.on) return "Alerts are off. Pick where and when, then turn them on.";
    return `You'll be notified when the 24-hour PSI in ${areaText(p.area)} reaches ${labelOf(p.level).toLowerCase()} (${floorOf(p.level)} or more), when it changes band above that, and when it eases back.`;
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
    note(problem ? PROBLEMS[problem] : noteFor(p), problem ? "bad" : "");

    const icon = $("#alertsBtn [data-icon]");
    icon.setAttribute("data-icon", p.on ? "bell-on" : "bell");
    $("#alertsBtn").setAttribute("aria-label", p.on ? "PSI alerts, on" : "PSI alerts");
    window.UwuUI.hydrateIcons($("#alertsBtn"));
  }

  function note(text, tone) {
    $("#alertsNote").textContent = text;
    $("#alertsNote").dataset.tone = tone;
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

  async function subscription() {
    const reg = await readyRegistration();
    return (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: await fetchPublicKey(),
    });
  }

  async function subscribe(p) {
    const sub = await subscription();
    const res = await fetch(`${API_BASE}/devices/${deviceId()}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON(), area: p.area, level: p.level }),
    });
    if (!res.ok) throw new Error(`alerts server replied ${res.status}`);
  }

  // Unsubscribe and have the server forget this device. Browsers don't let a page
  // revoke notification permission itself; this is the closest it gets.
  async function unsubscribe() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      await (await reg?.pushManager.getSubscription())?.unsubscribe();
    } catch (err) {
      console.warn("unsubscribe failed:", err);
    }
    try {
      await fetch(`${API_BASE}/devices/${deviceId()}`, { method: "DELETE" });
    } catch (err) {
      // The subscription is already gone, so the server drops the device the first
      // time a push to it fails.
      console.warn("device delete failed:", err);
    }
  }

  let busy = false;

  // `change` is what was just picked; turning on asks for permission first.
  async function apply(change) {
    if (busy) return;
    const previous = prefs();
    const next = { ...previous, ...change };

    if (!next.on) {
      save(next);
      show(next);
      if (previous.on && pushSupported()) await unsubscribe();
      return;
    }
    if (!pushSupported()) return show({ ...next, on: false }, "unsupported");

    busy = true;
    try {
      const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (perm !== "granted") return show({ ...next, on: false }, "denied");
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
        if (res.status === 410) await (await (await readyRegistration()).pushManager.getSubscription())?.unsubscribe();
        await subscribe(prefs());
        res = await postTest();
      }
      if (res.ok) {
        note("Test alert sent. Nothing within a minute? Check that notifications from this browser aren't muted or held back by Do Not Disturb.", "");
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
  // permission revoked in the browser's settings turns alerts off here too.
  function resync() {
    const p = prefs();
    if (!p.on) return;
    if (!pushSupported() || Notification.permission !== "granted") {
      const off = { ...p, on: false };
      save(off);
      show(off);
      return;
    }
    subscribe(p).catch((err) => console.warn("PSI alerts resync failed:", err));
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
    resync();
  }

  window.SgAlerts = { init };
})();
