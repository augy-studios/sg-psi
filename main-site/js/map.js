// The Map view: Leaflet on OpenStreetMap's tiles, with each region's reading pinned at
// NEA's label point and the wind drawn as an arrow at every weather station.
//
// OSM has no dark style, so in dark mode style.css turns the tiles down to match.
// Plain script, not a module: published on window.SgMap. Leaflet is vendor/leaflet.

(function () {
  const { psiBand, pm25Band, REGION_LABELS, compass, knotsToKmh } = window.SgPsi;
  const { esc } = window.UwuUI;

  const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

  // The main island, which the map opens fitted to on any screen, and a looser box the
  // view is held to.
  const ISLAND = [[1.23, 103.62], [1.47, 104.03]];
  const BOUNDS = [[1.1, 103.5], [1.55, 104.15]];

  let map = null;
  let regionLayer = null;
  let windLayer = null;
  let data = null;
  let metric = "psi";
  let showWind = true;

  function init() {
    map = L.map("map", {
      minZoom: 10,
      maxZoom: 18,
      maxBounds: BOUNDS,
      maxBoundsViscosity: 0.8,
      zoomSnap: 0.25,
      // Bottom right, stacked above the attribution and clear of the controls
      // floating at the top of the screen.
      zoomControl: false,
    });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    // Room left for the floating controls top left and the tray top right.
    map.fitBounds(ISLAND, { paddingTopLeft: [10, 120], paddingBottomRight: [70, 30] });
    // The map fills the screen below the update bar, so it is measured again whenever
    // that box changes: the bar coming or going, a phone turning, a window resizing.
    new ResizeObserver(() => map.invalidateSize()).observe(map.getContainer());
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');

    L.tileLayer(OSM_URL, {
      minZoom: 10,
      maxZoom: 18,
      attribution: OSM_ATTRIBUTION,
      // CORS, so the service worker can keep a copy that works offline.
      crossOrigin: "anonymous",
    }).addTo(map);

    windLayer = L.layerGroup();
    regionLayer = L.layerGroup().addTo(map);
    if (showWind) windLayer.addTo(map);

    // Zoomed out, labels give way so the pins don't pile up: wind speeds below 11.5,
    // and the region names too below 11, which is how a phone opens. The name is still
    // in each pin's popup and title.
    const crowding = () => {
      const zoom = map.getZoom();
      map.getContainer().classList.toggle("map-wide", zoom < 11.5);
      map.getContainer().classList.toggle("map-compact", zoom < 11);
    };
    map.on("zoomend", crowding);
    crowding();

    render();
  }

  function regionPin(region) {
    const psi = data.psi?.readings?.psi_twenty_four_hourly?.[region.name];
    const pm25 = data.pm25?.regions?.[region.name];
    const value = metric === "psi" ? psi : pm25;
    const band = metric === "psi" ? psiBand(value) : pm25Band(value);
    const label = REGION_LABELS[region.name];
    const html =
      `<span class="pin"><span class="band-dot" data-level="${band?.level ?? ""}"></span>` +
      `<strong>${Number.isFinite(value) ? value : "--"}</strong><span>${esc(label)}</span></span>`;

    const marker = L.marker([region.lat, region.lng], {
      icon: L.divIcon({ className: "region-pin", html, iconSize: null }),
      title: `${label}: ${metric === "psi" ? "24-hour PSI" : "1-hour PM2.5"} ${Number.isFinite(value) ? value : "not reported"}${band ? `, ${band.label}` : ""}`,
      keyboard: true,
      riseOnHover: true,
      // Above the wind arrows, which are only the backdrop to them.
      zIndexOffset: 1000,
    });
    const psiB = psiBand(psi);
    const pmB = pm25Band(pm25);
    marker.bindPopup(
      `<p class="popup-title">${esc(label)}</p>` +
      `<p>24-hour PSI <strong>${Number.isFinite(psi) ? psi : "--"}</strong>${psiB ? `, ${psiB.label}` : ""}</p>` +
      `<p>1-hour PM2.5 <strong>${Number.isFinite(pm25) ? pm25 : "--"}</strong> µg/m³${pmB ? `, ${pmB.label}` : ""}</p>`
    );
    return marker;
  }

  function windPin(s) {
    // The direction is where the wind comes from; the arrow points where it goes.
    const html =
      `<span class="pin wind"><span class="wind-arrow" style="transform:rotate(${(s.direction + 180) % 360}deg)">` +
      `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 18 15h-4.5v6h-3v-6H6z"/></svg></span>` +
      `<span>${s.speed}</span></span>`;
    const marker = L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: "wind-pin", html, iconSize: null }),
      title: `${s.name}: ${s.speed} knots from the ${compass(s.direction)}`,
      keyboard: true,
    });
    marker.bindPopup(
      `<p class="popup-title">${esc(s.name)}</p>` +
      `<p><strong>${s.speed}</strong> knots (${knotsToKmh(s.speed)} km/h)</p>` +
      `<p>From the ${compass(s.direction)} (${s.direction}°)</p>`
    );
    return marker;
  }

  function render() {
    if (!map || !data) return;
    regionLayer.clearLayers();
    windLayer.clearLayers();
    for (const region of data.regions || []) regionPin(region).addTo(regionLayer);
    for (const s of data.wind?.stations || []) windPin(s).addTo(windLayer);
  }

  // Called when the Map tab is shown. Leaflet measures its container, so it is only
  // built once the container is on screen.
  function show() {
    if (!map) init();
    else map.invalidateSize();
  }

  function update(now) {
    data = now;
    render();
  }

  function setMetric(next) {
    metric = next;
    render();
  }

  function setWind(on) {
    showWind = on;
    if (!map) return;
    if (on) windLayer.addTo(map);
    else windLayer.remove();
  }

  window.SgMap = { show, update, setMetric, setWind };
})();
