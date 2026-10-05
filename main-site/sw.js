// Bump on every deploy that changes anything this worker serves. The browser
// compares this file byte for byte, so an unchanged VERSION means no update
// reaches anybody and the update bar never appears.
const VERSION = "v8";
const CACHE = `sgpsi-${VERSION}`;

// Kept across versions, so an update doesn't throw away what makes the site work
// offline: the last readings, and the map tiles already looked at.
const DATA_CACHE = "sgpsi-data";
const TILE_CACHE = "sgpsi-tiles";
const KEEP = [CACHE, DATA_CACHE, TILE_CACHE];

// About 15 MB of tiles at most; the oldest go first.
const MAX_TILES = 800;
// How long a reading may take before the last saved copy is shown instead.
const NETWORK_TIMEOUT_MS = 6000;

// The app shell. Served only from this version's own cache, so a page never
// mixes files from two deploys; the next version's shell arrives with the next
// worker, which waits until somebody presses Reload in the update bar.
// "/index.html" is not listed: cleanUrls redirects it to "/", and a redirected
// response can't answer a navigation.
const ASSETS = [
  "/",
  "/style.css",
  "/script.js",
  "/js/icons.js",
  "/js/ui.js",
  "/js/theme.js",
  "/js/bands.js",
  "/js/charts.js",
  "/js/map.js",
  "/js/alerts.js",
  "/js/update.js",
  "/vendor/leaflet/leaflet.js",
  "/vendor/leaflet/leaflet.css",
  "/manifest.json",
  "/favicon.ico",
  "/SGPSI-192.png",
  "/SGPSI-512.png",
  "/SGPSI-main.png",
  "/SGPSI-badge.png",
];
const SHELL = new Set(ASSETS);

// Readings, answered from the network first and from the last copy offline.
const DATA_PATHS = ["/api/now", "/api/history"];

// Cached on first use so the Jua font still renders offline.
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

const isTile = (url) => url.hostname === "tile.openstreetmap.org";

self.addEventListener("install", (event) => {
  // No skipWaiting here. A new version downloads, installs, and then waits.
  // `cache: "reload"` so the precache comes from the server, not from an HTTP
  // cache entry left over from the version being replaced.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" })))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      const stale = keys.filter((key) => !KEEP.includes(key));
      await Promise.all(stale.map((key) => caches.delete(key)));

      // First install only: no earlier version's cache, so there is nothing on
      // screen to protect. Claiming lets the very first visit fill the runtime
      // caches (readings, fonts, tiles), which is what makes a second visit work
      // offline. An update never gets here with a page to claim: it only
      // activates through the skip-waiting message below, or once every page
      // using the old version has closed.
      if (stale.length === 0) await self.clients.claim();
    })
  );
});

self.addEventListener("message", (event) => {
  const type = typeof event.data === "string" ? event.data : event.data?.type;

  // The only place skipWaiting is ever called: somebody pressed Reload.
  if (type === "skip-waiting") {
    event.waitUntil(self.skipWaiting().then(() => self.clients.claim()));
  }
});

/* -- PSI alerts, sent by the collect cron (api/cron/collect.js) -- */

self.addEventListener("push", (event) => {
  let data = null;
  try {
    data = event.data?.json();
  } catch {}
  if (data?.type !== "psi-alert") return;

  // One tag, so a new band replaces the last notification rather than stacking;
  // renotify still makes it heard.
  event.waitUntil(
    self.registration.showNotification(data.title || "PSI alert", {
      body: data.body || "",
      tag: "psi-alert",
      renotify: true,
      icon: "/SGPSI-192.png",
      // The status bar's icon. Android draws only its shape, so this is the wind
      // mark on a transparent background rather than the app icon's solid square.
      badge: "/SGPSI-badge.png",
      data: { url: data.url || "/" },
    })
  );
});

// Tapping one opens the site: the open window if there is one, otherwise a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const client = clients.find((c) => new URL(c.url).origin === self.location.origin);
      return client ? client.focus() : self.clients.openWindow(url);
    })
  );
});

/* -- Fetch -- */

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    if (FONT_HOSTS.includes(url.hostname)) event.respondWith(cacheFirst(request, CACHE));
    else if (isTile(url)) event.respondWith(tile(event, request));
    // Analytics goes straight to the network, untouched.
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (DATA_PATHS.includes(url.pathname)) event.respondWith(networkFirst(event, request));
    // Alerts sign-up and the cron talk to the server and nothing else.
    return;
  }

  // The app shell from this version's cache, including "/#map" and any query.
  // Offline navigations to anything uncached get the app itself.
  if (request.mode === "navigate" || SHELL.has(url.pathname)) {
    event.respondWith(shell(request, url));
    return;
  }

  event.respondWith(cacheFirst(request, CACHE));
});

async function shell(request, url) {
  const cache = await caches.open(CACHE);
  const key = request.mode === "navigate" ? "/" : url.pathname;
  const cached = await cache.match(key, { ignoreSearch: true });
  if (cached) return cached;
  return fetch(request);
}

async function cacheFirst(request, name) {
  const cache = await caches.open(name);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// The network, unless it is slow or gone: then the last copy. The page tells how old
// that is from the readings' own timestamps. The fetch carries on in the background
// either way, so the copy stays fresh.
async function networkFirst(event, request) {
  const cache = await caches.open(DATA_CACHE);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  event.waitUntil(network.catch(() => {}));

  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
  try {
    const response = await Promise.race([network, timeout]);
    if (response) return response;
  } catch {
    // Offline: fall through to the copy.
  }
  const cached = await cache.match(request);
  if (cached) return cached;
  return network;
}

// Tiles: whatever is cached, else the network, kept for next time. The cache is trimmed
// now and then rather than on every tile.
let tilePuts = 0;

async function tile(event, request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // CORS tiles only: an opaque response is padded to megabytes of quota.
  if (response.ok && response.type === "cors") {
    event.waitUntil(cache.put(request, response.clone()).then(() => (++tilePuts % 50 === 0 ? trimTiles(cache) : null)));
  }
  return response;
}

async function trimTiles(cache) {
  const keys = await cache.keys();
  const extra = keys.length - MAX_TILES;
  if (extra > 0) await Promise.all(keys.slice(0, extra).map((k) => cache.delete(k)));
}
