// SG PSI: the page. Wires the theme modal (uwuapps-theme.md, section 6), the five
// views and their tabs, and draws the readings from /api/now and /api/history into
// each view. Offline, the service worker answers both from the last copy it kept.
// Plain script, not a module, like everything under js/.

(function () {
  const { hydrateIcons, openModal, closeModal, esc } = window.UwuUI;
  const Theme = window.UwuTheme;
  const P = window.SgPsi;

  const $ = (sel) => document.querySelector(sel);

  const REFRESH_MS = 5 * 60 * 1000;
  const HISTORY_MAX_AGE_MS = 10 * 60 * 1000;
  // NEA publishes about a quarter past each hour, so two hours old means one is missing.
  const STALE_MS = 2 * 3600 * 1000;

  const VIEWS = ["overview", "map", "trends", "pollutants", "wind"];

  // One colour per region, in a fixed order that never changes with the data.
  const SERIES = P.REGIONS.map((r, i) => ({ id: r, label: P.REGION_LABELS[r], color: `var(--series-${i + 1})` }));

  let now = null;
  let lastFetch = 0;
  let loadFailed = false;
  const histories = {};
  let view = "overview";
  let trendRange = "24h";
  let trendMetric = "psi";
  let trendTable = false;
  let windTable = false;

  // ---------- theme ----------

  function buildThemeModal() {
    const grid = $("#swatchGrid");
    grid.innerHTML = Theme.COLOR_THEMES.map(
      (t) => `
        <button class="swatch" data-theme-id="${t.id}" style="--swatch-color:${t.hex}" type="button" aria-label="${t.label}">
          <span class="swatch-dot"></span>
          <span class="swatch-label">${t.label}</span>
        </button>`
    ).join("");

    syncThemeModalState();

    grid.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-theme-id]");
      if (!btn) return;
      Theme.applyColorTheme(btn.dataset.themeId);
      syncThemeModalState();
    });

    $("#modeToggle").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-mode]");
      if (!btn) return;
      Theme.applyMode(btn.dataset.mode);
      syncThemeModalState();
    });

    // A tab left open across 09:00 or 18:00 re-resolves itself; redraw the
    // modal so the note and pressed state stay in step with the change.
    document.addEventListener("uwu:modechange", syncThemeModalState);
  }

  function syncThemeModalState() {
    const activeTheme = Theme.getStoredColorTheme();
    const activePreference = Theme.getModePreference();
    const resolvedMode = Theme.getStoredMode();

    document.querySelectorAll("#swatchGrid .swatch").forEach((el) => {
      el.classList.toggle("active", el.dataset.themeId === activeTheme);
    });
    document.querySelectorAll("#modeToggle .mode-btn").forEach((el) => {
      const isActive = el.dataset.mode === activePreference;
      el.classList.toggle("active", isActive);
      el.setAttribute("aria-pressed", String(isActive));
    });

    const note = $("#modeNote");
    if (note) {
      note.hidden = activePreference !== "time";
      if (activePreference === "time") {
        note.textContent = `Following the clock. Currently ${resolvedMode}.`;
      }
    }

    updateThemeButtonIcon();
  }

  function updateThemeButtonIcon() {
    const span = $("#themeBtn [data-icon]");
    span.setAttribute("data-icon", Theme.getStoredMode() === "dark" ? "moon" : "sun");
    hydrateIcons($("#themeBtn"));
  }

  function wireModals() {
    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
    });
    document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeModal(backdrop.id);
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      document.querySelectorAll(".modal-backdrop:not(.hidden)").forEach((m) => closeModal(m.id));
    });
    $("#themeBtn").addEventListener("click", () => openModal("themeModal"));
    $("#alertsBtn").addEventListener("click", () => openModal("alertsModal"));
  }

  // ---------- views ----------

  function showView(name, { focus = false } = {}) {
    if (!VIEWS.includes(name)) name = "overview";
    view = name;
    for (const v of VIEWS) {
      const tab = $(`#tab-${v}`);
      const on = v === name;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      tab.classList.toggle("active", on);
      $(`#view-${v}`).hidden = !on;
    }
    if (focus) $(`#tab-${name}`).focus();
    // The Map view fills the screen; style.css keys that off this class. The
    // column's padding moves with the tray, not with the view, so it is held
    // still while the class changes and the new layout is applied.
    const root = document.documentElement;
    root.classList.add("layout-still");
    for (const v of VIEWS) document.body.classList.toggle(`view-${v}`, v === name);
    void root.offsetWidth;
    root.classList.remove("layout-still");
    if (name !== "map") window.scrollTo({ top: 0 });

    // The address stays plain. A hash only ever arrives from outside (the manifest's
    // shortcuts, an old link) to pick the first view, and is cleared once it has.
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);

    if (name === "map") window.SgMap.show();
    if (name === "trends") loadHistory(trendRange);
    if (name === "wind") loadHistory("24h");
  }

  /* The tray: the nav, alerts and theme, which slides off the right edge and
     leaves an arrow tab to bring it back (wordrain-game's). Open until somebody
     closes it; the choice is a per-browser convenience, so storage failing only
     means it opens again next time. */

  const TRAY_KEY = "sgpsi.trayOpen";

  function setTray(open, { save = true } = {}) {
    $("#tray").classList.toggle("collapsed", !open);
    $("#trayTab").setAttribute("aria-expanded", String(open));
    $("#trayTab").setAttribute("aria-label", open ? "Hide menu" : "Show menu");
    // Off screen buttons must not take focus.
    $("#trayButtons").inert = !open;
    document.body.classList.toggle("tray-open", open);
    if (save) {
      try {
        localStorage.setItem(TRAY_KEY, open ? "1" : "0");
      } catch {
        // Remembered for this page view only.
      }
    }
  }

  function initTray() {
    let open = true;
    try {
      open = localStorage.getItem(TRAY_KEY) !== "0";
    } catch {
      // Open, the default.
    }
    setTray(open, { save: false });
    // The inline script in index.html held a shut tray still for first paint.
    // Lifted a frame later, so from here on toggles animate.
    requestAnimationFrame(() => document.documentElement.classList.remove("tray-start-collapsed"));
    $("#trayTab").addEventListener("click", () => setTray($("#tray").classList.contains("collapsed")));
  }

  function wireTabs() {
    const tabs = $(".tray-views");
    tabs.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-view]");
      if (tab) showView(tab.dataset.view);
    });
    // Arrow keys move between tabs, as a tab list should. The list runs top to
    // bottom, but left and right work too.
    tabs.addEventListener("keydown", (e) => {
      const i = VIEWS.indexOf(view);
      const next = { ArrowUp: i - 1, ArrowLeft: i - 1, ArrowDown: i + 1, ArrowRight: i + 1, Home: 0, End: VIEWS.length - 1 }[e.key];
      if (next == null) return;
      e.preventDefault();
      showView(VIEWS[(next + VIEWS.length) % VIEWS.length], { focus: true });
    });
    window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
  }

  // A group of pressed-state buttons where one is on.
  function pick(group, attr, value) {
    group.querySelectorAll(`[${attr}]`).forEach((btn) => {
      const on = btn.getAttribute(attr) === value;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
  }

  function wireControls() {
    $("#mapMetric").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-metric]");
      if (!btn) return;
      pick($("#mapMetric"), "data-metric", btn.dataset.metric);
      window.SgMap.setMetric(btn.dataset.metric);
    });
    $("#mapWind").addEventListener("click", () => {
      const on = $("#mapWind").getAttribute("aria-pressed") !== "true";
      $("#mapWind").setAttribute("aria-pressed", String(on));
      $("#mapWind").classList.toggle("active", on);
      window.SgMap.setWind(on);
    });

    $("#trendRange").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-range]");
      if (!btn) return;
      trendRange = btn.dataset.range;
      pick($("#trendRange"), "data-range", trendRange);
      loadHistory(trendRange);
    });
    $("#trendMetric").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-metric]");
      if (!btn) return;
      trendMetric = btn.dataset.metric;
      pick($("#trendMetric"), "data-metric", trendMetric);
      renderTrends();
    });
    $("#trendTableBtn").addEventListener("click", () => {
      trendTable = !trendTable;
      $("#trendTableBtn").setAttribute("aria-pressed", String(trendTable));
      $("#trendTableBtn").classList.toggle("active", trendTable);
      renderTrends();
    });
    $("#windTableBtn").addEventListener("click", () => {
      windTable = !windTable;
      $("#windTableBtn").setAttribute("aria-pressed", String(windTable));
      $("#windTableBtn").classList.toggle("active", windTable);
      renderWindChart();
    });

    $("#refreshBtn").addEventListener("click", () => {
      loadNow();
      if (view === "trends") loadHistory(trendRange, { force: true });
      if (view === "wind") loadHistory("24h", { force: true });
    });
  }

  // ---------- shared bits of markup ----------

  const dot = (band) => `<span class="band-dot" data-level="${band?.level ?? ""}"></span>`;
  const num = (v) => (Number.isFinite(v) ? String(v) : "--");

  function rangeText(r) {
    if (!r) return "--";
    return r.low === r.high ? String(r.high) : `${r.low}–${r.high}`;
  }

  // "Good", or "Moderate to unhealthy" when the range crosses a boundary. The worse end
  // sets the colour and the advice.
  function bandText(r, bandOf) {
    if (!r) return null;
    const low = bandOf(r.low);
    const high = bandOf(r.high);
    return { band: high, label: low.id === high.id ? high.label : `${low.label} to ${high.label.toLowerCase()}` };
  }

  function chip(el, b) {
    el.hidden = !b;
    if (b) el.innerHTML = `${dot(b.band)}${esc(b.label)}`;
  }

  // ---------- data: now ----------

  async function loadNow() {
    $("#refreshBtn").classList.add("busy");
    try {
      const res = await fetch("/api/now", { cache: "no-store" });
      if (!res.ok) throw new Error(`/api/now replied ${res.status}`);
      now = await res.json();
      loadFailed = false;
      renderAll();
    } catch (err) {
      console.warn("readings unavailable:", err);
      loadFailed = true;
    } finally {
      lastFetch = Date.now();
      $("#refreshBtn").classList.remove("busy");
      renderStatus();
    }
  }

  function renderStatus() {
    const el = $("#statusText");
    const time = now?.psi?.time || now?.pm25?.time;
    if (!now) {
      el.textContent = loadFailed
        ? "Couldn't load the readings. Check your connection, then tap refresh."
        : "Loading the latest readings.";
      return;
    }
    const parts = [`Readings for ${P.sgWhen(time)}.`];
    if (loadFailed) parts.push("Couldn't refresh just now.");
    else if (Object.values(now.source || {}).includes("stored")) parts.push("data.gov.sg isn't answering, so this is the last reading saved.");
    else if (Date.now() - Date.parse(time) > STALE_MS) parts.push("data.gov.sg hasn't published a newer one yet.");
    el.textContent = parts.join(" ");
  }

  function renderAll() {
    renderOverview();
    renderPollutants();
    renderWind();
    window.SgMap.update(now);
  }

  function renderOverview() {
    const psi = now.psi?.readings?.psi_twenty_four_hourly;
    const pm25 = now.pm25?.regions;
    const psiR = P.range(psi);
    const pmR = P.range(pm25);

    $("#psiTime").textContent = now.psi ? P.sgWhen(now.psi.time) : "";
    $("#psiRange").textContent = rangeText(psiR);
    const psiB = bandText(psiR, P.psiBand);
    chip($("#psiBand"), psiB);

    $("#advice").innerHTML = psiB
      ? P.ADVICE_GROUPS.map((g, i) => `<div><dt>${esc(g)}</dt><dd>${esc(P.ADVICE[psiB.band.id][i])}</dd></div>`).join("")
      : "";

    $("#pm25Time").textContent = now.pm25 ? P.sgWhen(now.pm25.time) : "";
    $("#pm25Range").textContent = rangeText(pmR);
    chip($("#pm25Band"), bandText(pmR, P.pm25Band));

    $("#regionGrid").innerHTML = P.REGIONS.map((r) => {
      const v = psi?.[r];
      const m = pm25?.[r];
      const b = P.psiBand(v);
      const mb = P.pm25Band(m);
      return `
        <article class="region-card glass">
          <h3>${P.REGION_LABELS[r]}</h3>
          <p class="region-value"><strong>${num(v)}</strong><span class="band-label">${dot(b)}${b ? esc(b.label) : "No reading"}</span></p>
          <p class="region-sub">PM2.5 <strong>${num(m)}</strong> µg/m³${mb ? `, ${esc(mb.label.toLowerCase())}` : ""}</p>
        </article>`;
    }).join("");
  }

  // ---------- pollutants ----------

  const SUB_INDICES = [
    ["pm25_sub_index", "PM2.5"],
    ["pm10_sub_index", "PM10"],
    ["o3_sub_index", "Ozone (O₃)"],
    ["co_sub_index", "Carbon monoxide (CO)"],
    ["so2_sub_index", "Sulphur dioxide (SO₂)"],
  ];

  const CONCENTRATIONS = [
    ["pm25_twenty_four_hourly", "PM2.5", "24-hour mean", "µg/m³"],
    ["pm10_twenty_four_hourly", "PM10", "24-hour mean", "µg/m³"],
    ["o3_eight_hour_max", "Ozone (O₃)", "8-hour max", "µg/m³"],
    ["co_eight_hour_max", "Carbon monoxide (CO)", "8-hour max", "mg/m³"],
    ["so2_twenty_four_hourly", "Sulphur dioxide (SO₂)", "24-hour mean", "µg/m³"],
    ["no2_one_hour_max", "Nitrogen dioxide (NO₂)", "1-hour max", "µg/m³"],
  ];

  const headRow = (first) => `<thead><tr><th scope="col">${first}</th>${P.REGIONS.map((r) => `<th scope="col">${P.REGION_LABELS[r]}</th>`).join("")}</tr></thead>`;

  function renderPollutants() {
    const readings = now.psi?.readings || {};
    $("#polTime").textContent = now.psi ? P.sgWhen(now.psi.time) : "";

    // The sub-index that sets each region's PSI.
    const top = {};
    for (const r of P.REGIONS) {
      let best = null;
      for (const [key] of SUB_INDICES) {
        const v = readings[key]?.[r];
        if (Number.isFinite(v) && (best == null || v > readings[best][r])) best = key;
      }
      top[r] = best;
    }

    const subRows = SUB_INDICES.filter(([key]) => readings[key]).map(([key, label]) => `
      <tr><th scope="row">${label}</th>${P.REGIONS.map((r) => {
        const v = readings[key][r];
        const isTop = top[r] === key;
        return `<td class="${isTop ? "is-top" : ""}">${dot(P.psiBand(v))}${num(v)}${isTop ? '<span class="sr-only"> (highest, sets the PSI)</span>' : ""}</td>`;
      }).join("")}</tr>`).join("");
    const psiRow = readings.psi_twenty_four_hourly
      ? `<tr class="total"><th scope="row">24-hour PSI</th>${P.REGIONS.map((r) => `<td>${num(readings.psi_twenty_four_hourly[r])}</td>`).join("")}</tr>`
      : "";
    $("#subTable").innerHTML = subRows
      ? `<table class="data-table">${headRow("Sub-index")}<tbody>${subRows}${psiRow}</tbody></table>`
      : `<p class="muted">No sub-indices in the latest reading.</p>`;

    const concRows = CONCENTRATIONS.filter(([key]) => readings[key]).map(([key, label, period, unit]) => `
      <tr><th scope="row">${label}<span class="row-note">${period}, ${unit}</span></th>${P.REGIONS.map((r) => `<td>${num(readings[key][r])}</td>`).join("")}</tr>`).join("");
    $("#concTable").innerHTML = concRows
      ? `<table class="data-table">${headRow("Pollutant")}<tbody>${concRows}</tbody></table>`
      : `<p class="muted">No concentrations in the latest reading.</p>`;
  }

  // ---------- wind ----------

  const arrow = (deg) =>
    `<span class="wind-arrow" style="transform:rotate(${(deg + 180) % 360}deg)" aria-hidden="true">` +
    `<svg viewBox="0 0 24 24"><path d="M12 3 18 15h-4.5v6h-3v-6H6z"/></svg></span>`;

  // The direction most of the air is moving from: the average of every station's wind
  // as a vector, so a few still stations pointing anywhere don't drag it about.
  function prevailing(stations) {
    let x = 0;
    let y = 0;
    for (const s of stations) {
      const rad = (s.direction * Math.PI) / 180;
      x += s.speed * Math.sin(rad);
      y += s.speed * Math.cos(rad);
    }
    if (Math.hypot(x, y) < 0.5) return null;
    return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  }

  function renderWind() {
    const stations = now.wind?.stations || [];
    $("#windTime").textContent = now.wind?.time ? P.sgWhen(now.wind.time) : "";
    if (!stations.length) {
      $("#windTiles").innerHTML = "";
      $("#stationList").innerHTML = `<li class="muted">No wind readings right now.</li>`;
      return;
    }

    const mean = Math.round((stations.reduce((a, s) => a + s.speed, 0) / stations.length) * 10) / 10;
    const strongest = stations.reduce((a, s) => (s.speed > a.speed ? s : a));
    const from = prevailing(stations);
    $("#windTiles").innerHTML = `
      <div class="tile glass"><p class="tile-label">Average</p><p class="tile-value">${mean} <span class="unit">kn</span></p><p class="tile-sub">${P.knotsToKmh(mean)} km/h</p></div>
      <div class="tile glass"><p class="tile-label">Strongest</p><p class="tile-value">${strongest.speed} <span class="unit">kn</span></p><p class="tile-sub">${esc(strongest.name)}</p></div>
      <div class="tile glass"><p class="tile-label">Mostly from</p><p class="tile-value">${from == null ? "Calm" : P.compass(from)}</p><p class="tile-sub">${from == null ? "No clear direction" : `${Math.round(from)}°`}</p></div>`;

    $("#stationList").innerHTML = [...stations]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => `
        <li>
          ${arrow(s.direction)}
          <span class="station-name">${esc(s.name)}</span>
          <span class="station-speed"><strong>${s.speed}</strong> kn <span class="muted">${P.knotsToKmh(s.speed)} km/h</span></span>
          <span class="station-dir">from ${P.compass(s.direction)}</span>
        </li>`).join("");
  }

  // ---------- data: history ----------

  const loading = {};

  async function loadHistory(range, { force = false } = {}) {
    const have = histories[range];
    if (have && !force && Date.now() - have.fetchedAt < HISTORY_MAX_AGE_MS) {
      renderHistory(range);
      return;
    }
    if (loading[range]) return;
    loading[range] = true;
    $("#trendChart").classList.add("is-loading");
    try {
      const res = await fetch(`/api/history?range=${range}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`/api/history replied ${res.status}`);
      histories[range] = { ...(await res.json()), fetchedAt: Date.now() };
    } catch (err) {
      console.warn("history unavailable:", err);
      if (!histories[range]) histories[range] = { failed: true, fetchedAt: 0 };
    } finally {
      loading[range] = false;
      $("#trendChart").classList.remove("is-loading");
      renderHistory(range);
    }
  }

  function renderHistory(range) {
    if (range === trendRange) renderTrends();
    if (range === "24h") renderWindChart();
  }

  const charts = {};
  function drawChart(id, opts) {
    charts[id]?.destroy();
    charts[id] = window.SgCharts.line($(`#${id}`), opts);
  }
  function clearChart(id) {
    charts[id]?.destroy();
    delete charts[id];
    $(`#${id}`).innerHTML = "";
  }

  const HOUR_MS = 3600 * 1000;
  // Readings come hourly; more than this between two rows means hours are missing.
  const TABLE_GAP_MS = 1.5 * HOUR_MS;

  const GUIDES = {
    psi: [
      { value: 50, label: "Moderate" },
      { value: 100, label: "Unhealthy" },
      { value: 200, label: "Very unhealthy" },
      { value: 300, label: "Hazardous" },
    ],
    pm25: [
      { value: 55, label: "Elevated" },
      { value: 150, label: "High" },
      { value: 250, label: "Very high" },
    ],
  };

  function renderTrends() {
    const h = histories[trendRange];
    const metricName = trendMetric === "psi" ? "24-hour PSI" : "1-hour PM2.5";
    $("#trendTitle").textContent = `${metricName}, last ${trendRange === "24h" ? "24 hours" : "7 days"}`;
    if (!h) return;
    if (h.failed || !h.points?.length) {
      $("#trendSummary").textContent = "Couldn't load the history. Check your connection, then tap refresh.";
      clearChart("trendChart");
      $("#trendTable").hidden = true;
      return;
    }

    const points = h.points.filter((p) => p[trendMetric]);
    const times = points.map((p) => Date.parse(p.t));
    const series = SERIES.map((s) => ({ ...s, values: points.map((p) => p[trendMetric]?.[s.id] ?? null) }));
    const unit = trendMetric === "psi" ? "" : " µg/m³";

    // The worst reading in the window, and when.
    let peak = null;
    points.forEach((p, i) => {
      for (const s of SERIES) {
        const v = p[trendMetric]?.[s.id];
        if (Number.isFinite(v) && (!peak || v > peak.v)) peak = { v, region: s.label, t: times[i] };
      }
    });
    $("#trendSummary").textContent = peak
      ? `Highest: ${peak.v}${unit} in the ${peak.region}, ${P.sgWhen(peak.t)}.`
      : "No readings in this window.";

    if (!points.length) {
      clearChart("trendChart");
      return;
    }

    $("#trendChart").hidden = trendTable;
    $("#trendTable").hidden = !trendTable;
    if (trendTable) {
      // Newest first, with a row saying so wherever hours are missing, rather than
      // letting Friday sit straight under Monday.
      const rows = [];
      for (let i = points.length - 1; i >= 0; i--) {
        rows.push(`<tr><th scope="row">${esc(P.sgWhen(times[i]))}</th>${P.REGIONS.map((r) => `<td>${num(points[i][trendMetric]?.[r])}</td>`).join("")}</tr>`);
        if (i > 0 && times[i] - times[i - 1] > TABLE_GAP_MS) {
          rows.push(`<tr class="gap"><td colspan="${P.REGIONS.length + 1}">No readings from ${esc(P.sgWhen(times[i - 1] + HOUR_MS))} to ${esc(P.sgWhen(times[i] - HOUR_MS))}</td></tr>`);
        }
      }
      $("#trendTable").innerHTML = `<table class="data-table">${headRow("Time")}<tbody>${rows.join("")}</tbody></table>`;
      return;
    }

    drawChart("trendChart", {
      times,
      series,
      format: (v) => `${v}${unit}`,
      guides: GUIDES[trendMetric],
      label: `${metricName} by region, ${$("#trendTitle").textContent.split(", ")[1]}. Use the left and right arrow keys to read each hour, or the Table button for every value.`,
      tickLabel: (t, daily) => (daily ? P.sgDay(t) : P.sgTime(t)),
      tipTime: (t) => P.sgWhen(t),
    });
  }

  function renderWindChart() {
    const h = histories["24h"];
    if (!h) return;
    const wind = h.wind || [];
    if (wind.length < 2) {
      $("#windSummary").textContent = h.failed
        ? "Couldn't load the wind history. Check your connection, then tap refresh."
        : "Wind history builds up an hour at a time once the site starts collecting it. Check back later.";
      clearChart("windChart");
      $("#windTable").hidden = true;
      return;
    }
    const strongest = wind.reduce((a, w) => (w.mean > a.mean ? w : a));
    $("#windSummary").textContent = `Windiest hour: ${strongest.mean} knots on average, ${P.sgWhen(strongest.t)}.`;

    $("#windChart").hidden = windTable;
    $("#windTable").hidden = !windTable;
    if (windTable) {
      // Laid out like the Trends table: newest first, with a row wherever hours are missing.
      const times = wind.map((w) => Date.parse(w.t));
      const rows = [];
      for (let i = wind.length - 1; i >= 0; i--) {
        rows.push(`<tr><th scope="row">${esc(P.sgWhen(times[i]))}</th><td>${num(wind[i].mean)}</td><td>${num(wind[i].max)}</td></tr>`);
        if (i > 0 && times[i] - times[i - 1] > TABLE_GAP_MS) {
          rows.push(`<tr class="gap"><td colspan="3">No readings from ${esc(P.sgWhen(times[i - 1] + HOUR_MS))} to ${esc(P.sgWhen(times[i] - HOUR_MS))}</td></tr>`);
        }
      }
      $("#windTable").innerHTML =
        `<table class="data-table"><thead><tr><th scope="col">Time</th><th scope="col">Average, kn</th><th scope="col">Strongest station, kn</th></tr></thead>` +
        `<tbody>${rows.join("")}</tbody></table>`;
      return;
    }

    drawChart("windChart", {
      times: wind.map((w) => Date.parse(w.t)),
      series: [{ id: "mean", label: "Average", color: "var(--series-1)", values: wind.map((w) => w.mean) }],
      format: (v) => `${v} kn (${P.knotsToKmh(v)} km/h)`,
      guides: [],
      label: "Average wind speed across Singapore's stations, last 24 hours, in knots. Use the left and right arrow keys to read each hour, or the Table button for every value.",
      tickLabel: (t) => P.sgTime(t),
      tipTime: (t) => P.sgWhen(t),
    });
  }

  // ---------- refreshing ----------

  function wireRefresh() {
    setInterval(() => {
      if (document.visibilityState === "visible") loadNow();
    }, REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFetch > 60 * 1000) loadNow();
      if (view === "trends") loadHistory(trendRange);
      if (view === "wind") loadHistory("24h");
    });
    window.addEventListener("online", () => loadNow());
    // On a first visit the readings were fetched before the service worker took
    // control, so it never kept a copy. Fetching them again once it has makes the
    // very next visit work offline. (An update's controllerchange reloads the page
    // anyway; see js/update.js.)
    if ("serviceWorker" in navigator && !navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener("controllerchange", () => loadNow(), { once: true });
    }
    // The page says which day "today" is, so it is redrawn once the stamps go stale.
    setInterval(renderStatus, 60 * 1000);
  }

  // ---------- boot ----------

  function boot() {
    Theme.initTheme();
    hydrateIcons();
    updateThemeButtonIcon();
    buildThemeModal();
    wireModals();
    initTray();
    wireTabs();
    wireControls();
    wireRefresh();
    window.SgAlerts.init();
    showView(location.hash.slice(1));
    loadNow();
  }

  boot();
})();
