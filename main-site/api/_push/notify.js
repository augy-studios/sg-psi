// PSI alerts: compares each new 24-hour PSI reading with the last one, and pushes to every
// device whose area changed band at or above the level it asked for. Called by the collect
// cron once it has stored the reading.
//
// A device set to Unhealthy in the West hears when the West reaches Unhealthy, when it
// moves to another band while still at or above it, and when it eases back below.

import webpush from "web-push";
import { ADVICE, PSI_BANDS, floorOf, levelOf, psiLevel } from "../_lib/bands.js";
import { byRegion } from "../_lib/datagov.js";
import { devices, getState, setState, storeConfigured } from "./store.js";
import { AREAS } from "./validate.js";

// A push the device can't receive within this long is dropped: a PSI from hours ago
// shown as news is worse than none, and the next reading is an hour away anyway.
const PUSH_TTL = 2 * 3600;
// Sends in flight at once, so a long device list doesn't open thousands of connections.
const SEND_BATCH = 50;

export function pushConfigured() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  return storeConfigured() && Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
}

const areaText = (area) => (area === "islandwide" ? "in Singapore" : `in the ${area[0].toUpperCase()}${area.slice(1)}`);

function sgHour(iso) {
  return new Date(iso)
    .toLocaleTimeString("en-SG", { timeZone: "Asia/Singapore", hour: "numeric", hour12: true })
    .replace(/\s/g, "")
    .toLowerCase();
}

function message(area, before, now, value, time, threshold) {
  const band = PSI_BANDS[now].label;
  const at = `24-hour PSI ${value} at ${sgHour(time)}.`;
  if (now > before) {
    return { title: `PSI is ${band.toLowerCase()} ${areaText(area)}`, body: `${at} ${ADVICE[now]}` };
  }
  if (now >= threshold) {
    return { title: `PSI has eased to ${band.toLowerCase()} ${areaText(area)}`, body: `${at} ${ADVICE[now]}` };
  }
  return {
    title: `PSI is back to ${band.toLowerCase()} ${areaText(area)}`,
    body: `${at} Below ${floorOf(threshold)} again.`,
  };
}

// `item` is a data.gov.sg /psi item.
export async function notifyPsi(item) {
  const regions = byRegion(item?.readings?.psi_twenty_four_hourly);
  if (!Object.keys(regions).length) return { skipped: "no regional PSI" };

  const values = { ...regions, islandwide: Math.max(...Object.values(regions)) };
  const levels = Object.fromEntries(Object.entries(values).map(([a, v]) => [a, psiLevel(v)]));
  const next = { time: item.timestamp, values, levels };

  const prev = await getState("levels");
  // The first run only records where things stand: there is nothing to compare with.
  if (!prev) {
    await setState("levels", next);
    return { first: true };
  }
  // The same hour again, or a revision of it: already announced.
  if (Date.parse(prev.time) >= Date.parse(item.timestamp)) return { changed: false };
  await setState("levels", next);

  const changed = AREAS.filter((a) => Number.isInteger(prev.levels[a]) && Number.isInteger(levels[a]) && prev.levels[a] !== levels[a]);
  if (!changed.length) return { changed: false };

  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const payloads = {};
  const sends = [];
  for (const [id, device] of await devices.all()) {
    if (!device || !changed.includes(device.area)) continue;
    const threshold = levelOf(device.level);
    const before = prev.levels[device.area];
    const now = levels[device.area];
    // Only changes at or above the level asked for, and the step back below it.
    if (Math.max(before, now) < threshold) continue;

    const key = `${device.area}|${device.level}`;
    payloads[key] ??= JSON.stringify({
      type: "psi-alert",
      ...message(device.area, before, now, values[device.area], item.timestamp, threshold),
      url: "/",
    });
    sends.push([id, device, payloads[key]]);
  }

  let sent = 0;
  let dropped = 0;
  for (let i = 0; i < sends.length; i += SEND_BATCH) {
    const results = await Promise.all(sends.slice(i, i + SEND_BATCH).map(([id, device, payload]) => send(id, device, payload)));
    sent += results.filter((r) => r === "sent").length;
    dropped += results.filter((r) => r === "dropped").length;
  }
  return { changed: changed, sent, dropped };
}

async function send(id, device, payload) {
  try {
    await webpush.sendNotification(device.subscription, payload, { TTL: PUSH_TTL, urgency: "normal" });
    return "sent";
  } catch (err) {
    // 404 and 410 mean the subscription is gone for good: permission revoked, app
    // uninstalled, or site data cleared.
    if (err.statusCode === 404 || err.statusCode === 410) {
      await devices.delete(id).catch(() => {});
      console.info(`dropped expired subscription ${id}`);
      return "dropped";
    }
    console.error(`push to ${id} failed:`, err.statusCode ?? "", err.body ?? err.message);
    return "failed";
  }
}
