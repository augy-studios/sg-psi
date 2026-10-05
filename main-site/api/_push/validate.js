// Checks what the page sends before it is stored. Anything that fails throws a
// ValidationError, which the server turns into a 400. The subscription checks are
// sgbus-timings' api/_push/validate.js.

import { ALERT_LEVELS } from "../_lib/bands.js";
import { REGION_NAMES } from "../_lib/datagov.js";

// "islandwide" is whichever region is worst.
export const AREAS = ["islandwide", ...REGION_NAMES];

// The server POSTs to whatever endpoint a subscription names, so only the browsers'
// own push services are accepted. Otherwise anyone could point it at an arbitrary URL.
const PUSH_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge on Android, Samsung Internet, Opera
  ".push.services.mozilla.com", // Firefox
  "web.push.apple.com", // Safari, and iOS home screen apps
  ".notify.windows.com", // Edge on Windows
];

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+=*$/;

export class ValidationError extends Error {}

function fail(message) {
  throw new ValidationError(message);
}

export function isId(value) {
  return typeof value === "string" && ID_RE.test(value);
}

// { subscription, area, level }: where to watch and the band that sets an alert off.
export function parseDevice(body) {
  if (!body || typeof body !== "object") fail("body must be an object");
  if (!AREAS.includes(body.area)) fail(`area must be one of ${AREAS.join(", ")}`);
  if (!ALERT_LEVELS.includes(body.level)) fail(`level must be one of ${ALERT_LEVELS.join(", ")}`);
  return { subscription: parseSubscription(body.subscription), area: body.area, level: body.level };
}

function parseSubscription(sub) {
  if (!sub || typeof sub !== "object") fail("subscription is required");

  let url;
  try {
    url = new URL(sub.endpoint);
  } catch {
    fail("subscription.endpoint must be a URL");
  }
  if (url.protocol !== "https:") fail("subscription.endpoint must be https");
  const host = url.hostname;
  const known = PUSH_HOSTS.some((h) => (h.startsWith(".") ? host.endsWith(h) : host === h));
  if (!known) fail("subscription.endpoint is not a known push service");

  const { p256dh, auth } = sub.keys ?? {};
  if (typeof p256dh !== "string" || p256dh.length > 200 || !B64URL_RE.test(p256dh)) fail("bad subscription.keys.p256dh");
  if (typeof auth !== "string" || auth.length > 100 || !B64URL_RE.test(auth)) fail("bad subscription.keys.auth");

  return { endpoint: url.href, keys: { p256dh, auth } };
}
