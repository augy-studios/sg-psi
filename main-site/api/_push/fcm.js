// Pushes to the Android app (android/) through Firebase Cloud Messaging. Its WebView has no Web
// Push, so the app registers with FCM and signs up for PSI alerts with its token as its
// subscription, { fcm: token } (js/alerts.js). Two ways to send:
//
//   sendFcm(token, payload)   one phone: PSI alerts and test alerts (api/_push/notify.js), the
//                             same payload a Web Push carries
//   sendToTopic(topic, msg)   every phone that joined a topic (SgPsiPlugin.setTopic), so the
//                             server keeps no list for them:
//                               sgpsi-morning    the 7am summary (api/cron/morning.js)
//                               sgpsi-releases   new versions (api/push/release.js)
//
// FCM's HTTP v1 API, with an OAuth token made from the Firebase project's service account:
// FIREBASE_SERVICE_ACCOUNT holds its JSON key, as downloaded or base64'd
// (android/FIREBASE-SETUP.md). The token is signed here with node:crypto, so there's no Google
// library, and kept until just before it runs out (an hour). Following sgbus-timings' and
// uwuHere's api/_push/fcm.js and api/_lib/fcm.js.
//
// Each push carries a notification, which Android shows itself while the app is in the
// background, on the app's own channels (android/.../Notifications.java), and the same as data,
// for the app when it's in front.

import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_MARGIN_S = 300;

let account;
let token = null;
let tokenExpires = 0;

function serviceAccount() {
  if (account !== undefined) return account;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  account = null;
  if (!raw) return account;
  try {
    const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    if (parsed.project_id && parsed.client_email && parsed.private_key) account = parsed;
    else console.error("[fcm] FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email or private_key");
  } catch {
    console.error("[fcm] FIREBASE_SERVICE_ACCOUNT isn't the service account's JSON key");
  }
  return account;
}

export const fcmConfigured = () => Boolean(serviceAccount());

const b64url = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (token && now < tokenExpires - TOKEN_MARGIN_S) return token;
  const sa = serviceAccount();
  const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data?.access_token) throw new Error(`Google token responded ${r.status}: ${data?.error_description || data?.error || ""}`);
  token = data.access_token;
  tokenExpires = now + (Number(data.expires_in) || 3600);
  return token;
}

// An error like web-push's, so callers treat the two alike: statusCode 410 means the app's
// token is gone for good (uninstalled, data cleared) and the device should be dropped.
export class PushError extends Error {
  constructor(statusCode, body) {
    super(`FCM responded ${statusCode}`);
    this.statusCode = statusCode;
    this.body = body;
  }
}

async function send(message) {
  const post = async () => fetch(`https://fcm.googleapis.com/v1/projects/${serviceAccount().project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ message }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  let r = await post();
  // A token Google took back early: once more with a fresh one.
  if (r.status === 401) {
    token = null;
    r = await post();
  }
  if (r.ok) return;
  const body = await r.json().catch(() => null);
  // Only FCM's own word that the token's gone drops the device. A plain 404 can also mean the
  // project in the key is wrong, and that would drop every phone.
  const code = body?.error?.details?.find((d) => d.errorCode)?.errorCode;
  if (code === "UNREGISTERED") throw new PushError(410, body);
  throw new PushError(r.status, body);
}

const asData = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));

/**
 * One push to one phone. `payload` is the JSON string a Web Push carries
 * ({ type: "psi-alert", title, body, url }), `ttl` in seconds.
 *
 * Always high priority, whatever the Web Push urgency: every one shows a notification, which
 * is what FCM asks of high priority, and a phone dozing on the desk would otherwise hold a PSI
 * alert back until it's picked up.
 */
export async function sendFcm(fcmToken, payload, { ttl = 3600 } = {}) {
  if (!fcmConfigured()) throw new PushError(503, "FIREBASE_SERVICE_ACCOUNT is not set");
  const msg = JSON.parse(payload);
  const title = msg.title || "PSI alert";
  await send({
    token: fcmToken,
    data: asData({ ...msg, title }),
    notification: { title, body: msg.body || "" },
    android: {
      priority: "HIGH",
      ttl: `${ttl}s`,
      notification: {
        channel_id: "alerts",
        // One tag, so a new band replaces the last alert rather than stacking, as sw.js does.
        tag: "psi-alert",
        icon: "ic_notification_icon",
        notification_priority: "PRIORITY_HIGH",
        visibility: "PUBLIC",
      },
    },
  });
}

/**
 * A notification to every phone on `topic`, on the app's `channel` (Notifications.java). `tag`
 * replaces an earlier one with the same tag rather than stacking under it. `data` reaches the
 * app when it's tapped (MainActivity.onNewIntent). `ttl` is how long FCM keeps trying a phone
 * that is off, in seconds.
 */
export async function sendToTopic(topic, { title, body, data = {}, channel, tag, ttl = 86400, urgency = "normal" }) {
  if (!fcmConfigured()) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set");
  await send({
    topic,
    notification: { title, body },
    data: asData(data),
    android: {
      priority: urgency === "high" ? "HIGH" : "NORMAL",
      ttl: `${ttl}s`,
      notification: { channel_id: channel, tag, icon: "ic_notification_icon" },
    },
  });
}
