// A small SVG line chart for the Trends and Wind views: time along the bottom, one line
// per series, a crosshair and tooltip that snap to the nearest reading, and optional
// guide lines (NEA's band boundaries). Colours come from CSS custom properties, so a
// theme or mode change needs no redraw. No library: it has to work offline.
// Plain script, not a module: published on window.SgCharts.

(function () {
  const NS = "http://www.w3.org/2000/svg";
  const HOUR = 3600 * 1000;
  const SGT = 8 * HOUR;
  const M = { top: 14, right: 14, bottom: 28, left: 40 };

  function el(name, attrs = {}, parent) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  // 1, 2, 2.5 or 5 times a power of ten: ticks people can read.
  function niceStep(span, count) {
    const raw = span / count;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const n = raw / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
  }

  // Ticks on the hours a person would pick: every 6 hours over a day, midnights over a week.
  function timeTicks(t0, t1) {
    const span = t1 - t0;
    const every = span <= 36 * HOUR ? 6 * HOUR : 24 * HOUR;
    const ticks = [];
    for (let t = Math.ceil((t0 + SGT) / every) * every - SGT; t <= t1; t += every) ticks.push(t);
    return { ticks, daily: every === 24 * HOUR };
  }

  // `opts`: { times: [ms], series: [{ id, label, color, values: [number|null] }],
  //           format(v), guides: [{ value, label }], label, tickLabel(t, daily), tipTime(t) }
  function line(container, opts) {
    const state = { opts, index: null, width: 0 };
    container.classList.add("chart");
    container.innerHTML = "";

    if (opts.series.length > 1) container.appendChild(legend(opts.series));

    const frame = document.createElement("div");
    frame.className = "chart-frame";
    container.appendChild(frame);

    const tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.hidden = true;
    frame.appendChild(tip);

    const svg = el("svg", { class: "chart-svg", tabindex: "0", role: "img", "aria-label": opts.label });
    frame.appendChild(svg);

    function draw() {
      const width = frame.clientWidth;
      if (!width) return;
      state.width = width;
      const { times, series } = opts;
      const t0 = times[0];
      const t1 = times[times.length - 1];
      const { ticks, daily } = timeTicks(t0, t1);

      // Day labels ("Mon 5 Oct") are too wide to sit side by side on a phone, so over a
      // week they're tilted, with the room they need added below rather than taken from
      // the plot.
      const bottom = daily ? M.bottom + 30 : M.bottom;
      const height = (width < 480 ? 220 : 260) + bottom - M.bottom;
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute("height", height);
      svg.innerHTML = "";

      const values = series.flatMap((s) => s.values).filter(Number.isFinite);
      const peak = Math.max(1, ...values);
      const step = niceStep(peak * 1.1, 4);
      const yMax = Math.ceil((peak * 1.1) / step) * step;

      const x = (t) => M.left + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (width - M.left - M.right);
      const y = (v) => M.top + (1 - v / yMax) * (height - M.top - bottom);
      state.x = x;
      state.y = y;
      state.height = height;
      state.bottom = bottom;

      // Grid and y ticks: hairlines, recessive.
      const grid = el("g", { class: "chart-grid" }, svg);
      for (let v = 0; v <= yMax + 1e-9; v += step) {
        el("line", { x1: M.left, x2: width - M.right, y1: y(v), y2: y(v), class: v === 0 ? "chart-base" : "" }, grid);
        const label = el("text", { x: M.left - 6, y: y(v) + 4, "text-anchor": "end", class: "chart-tick" }, grid);
        label.textContent = String(Math.round(v * 10) / 10);
      }

      // Band boundaries inside the plotted range. Their labels go on after the lines.
      const guides = (opts.guides || []).filter((g) => g.value <= yMax);
      for (const g of guides) {
        el("line", { x1: M.left, x2: width - M.right, y1: y(g.value), y2: y(g.value), class: "chart-guide" }, grid);
      }

      for (const t of ticks) {
        const label = daily
          ? el("text", { x: x(t), y: height - bottom + 14, "text-anchor": "end", transform: `rotate(-40 ${x(t)} ${height - bottom + 14})`, class: "chart-tick" }, grid)
          : el("text", { x: x(t), y: height - 8, "text-anchor": "middle", class: "chart-tick" }, grid);
        label.textContent = opts.tickLabel(t, daily);
      }

      // Lines, broken wherever a reading is missing: a null value, or a stretch of time
      // with no readings at all. A line drawn straight across a missing day would look
      // like data.
      const maxGap = opts.maxGap ?? 2.5 * HOUR;
      for (const s of series) {
        let d = "";
        let pen = false;
        let lastT = null;
        s.values.forEach((v, i) => {
          if (!Number.isFinite(v)) {
            pen = false;
            return;
          }
          if (lastT != null && times[i] - lastT > maxGap) pen = false;
          d += `${pen ? "L" : "M"}${x(times[i]).toFixed(1)},${y(v).toFixed(1)}`;
          pen = true;
          lastT = times[i];
        });
        el("path", { d, class: "chart-line", style: `stroke:${s.color}` }, svg);

        const last = s.values.findLastIndex(Number.isFinite);
        if (last >= 0) el("circle", { cx: x(times[last]), cy: y(s.values[last]), r: 4, class: "chart-dot", style: `fill:${s.color}` }, svg);
      }

      // The band each guide opens, just above it at the left, haloed in the page colour
      // so a line passing behind doesn't hide it.
      for (const g of guides) {
        const label = el("text", { x: M.left + 4, y: y(g.value) - 4, class: "chart-guide-label" }, svg);
        label.textContent = g.label;
      }

      state.cross = el("g", { class: "chart-cross" }, svg);
      if (state.index != null) point(state.index);
    }

    // The crosshair and tooltip at one reading.
    function point(i) {
      const { times, series } = opts;
      state.index = i;
      const g = state.cross;
      g.innerHTML = "";
      const cx = state.x(times[i]);
      el("line", { x1: cx, x2: cx, y1: M.top, y2: state.height - state.bottom, class: "chart-crossline" }, g);
      for (const s of series) {
        const v = s.values[i];
        if (Number.isFinite(v)) el("circle", { cx, cy: state.y(v), r: 4, class: "chart-dot", style: `fill:${s.color}` }, g);
      }

      tip.innerHTML = "";
      const head = document.createElement("p");
      head.className = "chart-tip-time";
      head.textContent = opts.tipTime(times[i]);
      tip.appendChild(head);
      for (const s of series) {
        const row = document.createElement("p");
        row.className = "chart-tip-row";
        const key = document.createElement("span");
        key.className = "chart-key";
        key.style.background = s.color;
        const value = document.createElement("strong");
        value.textContent = Number.isFinite(s.values[i]) ? opts.format(s.values[i]) : "No reading";
        row.append(key, value);
        if (series.length > 1) {
          const name = document.createElement("span");
          name.textContent = s.label;
          row.append(name);
        }
        tip.appendChild(row);
      }
      tip.hidden = false;
      // Beside the crosshair, flipping to the left past the middle so it stays inside.
      const left = cx > state.width / 2;
      tip.style.left = left ? "" : `${cx + 12}px`;
      tip.style.right = left ? `${state.width - cx + 12}px` : "";
    }

    function clear() {
      state.index = null;
      if (state.cross) state.cross.innerHTML = "";
      tip.hidden = true;
    }

    function nearest(clientX) {
      const rect = svg.getBoundingClientRect();
      const px = ((clientX - rect.left) / rect.width) * state.width;
      let best = 0;
      opts.times.forEach((t, i) => {
        if (Math.abs(state.x(t) - px) < Math.abs(state.x(opts.times[best]) - px)) best = i;
      });
      return best;
    }

    svg.addEventListener("pointermove", (e) => point(nearest(e.clientX)));
    svg.addEventListener("pointerdown", (e) => point(nearest(e.clientX)));
    svg.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") clear();
    });
    svg.addEventListener("blur", clear);
    svg.addEventListener("keydown", (e) => {
      const last = opts.times.length - 1;
      const at = state.index ?? last + 1;
      const next = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: last }[e.key];
      if (next == null) return;
      e.preventDefault();
      point(Math.max(0, Math.min(last, next)));
    });

    const observer = new ResizeObserver(() => {
      if (frame.clientWidth !== state.width) draw();
    });
    observer.observe(frame);
    draw();

    return { destroy: () => observer.disconnect() };
  }

  function legend(series) {
    const list = document.createElement("ul");
    list.className = "chart-legend";
    for (const s of series) {
      const item = document.createElement("li");
      const key = document.createElement("span");
      key.className = "chart-key";
      key.style.background = s.color;
      const name = document.createElement("span");
      name.textContent = s.label;
      item.append(key, name);
      list.appendChild(item);
    }
    return list;
  }

  window.SgCharts = { line };
})();
