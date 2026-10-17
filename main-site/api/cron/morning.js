// Run by Vercel Cron at 07:00 Singapore time (23:00 UTC, vercel.json): the morning summary,
// pushed to every Android app that turned it on in the alerts window, which joins the FCM
// topic sgpsi-morning (js/alerts.js, SgPsiPlugin.setTopic). So the server keeps no list, and
// there's nothing to store.
//
//   "PSI this morning: 52–68, moderate"
//   "Highest in the West at 6am. PM2.5 9–24 µg/m³. Normal activities."
//
// The newest reading at 7am is usually 6am's: NEA publishes about a quarter past each hour.
// Sent at high priority, so a phone dozing overnight shows it now, not when it's picked up.

import { ADVICE, PSI_BANDS, psiLevel } from "../_lib/bands.js";
import { byRegion, latest } from "../_lib/datagov.js";
import { fcmConfigured, sendToTopic } from "../_push/fcm.js";

const TOPIC = "sgpsi-morning";
// Not worth showing once the day's under way: FCM drops it after this.
const TTL_SECONDS = 3 * 3600;

const LABELS = { north: "North", south: "South", east: "East", west: "West", central: "Central" };

function sgHour(iso) {
  return new Date(iso)
    .toLocaleTimeString("en-SG", { timeZone: "Asia/Singapore", hour: "numeric", hour12: true })
    .replace(/\s/g, "")
    .toLowerCase();
}

const span = (values) => {
  const nums = Object.values(values);
  const low = Math.min(...nums);
  const high = Math.max(...nums);
  return low === high ? String(high) : `${low}–${high}`;
};

export default async function handler(req, res) {
  // Vercel Cron sends CRON_SECRET as a bearer token; nobody else can make every phone buzz.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!fcmConfigured()) return res.status(200).json({ sent: false, why: "FIREBASE_SERVICE_ACCOUNT is not set" });

  let psiItem;
  let pm25;
  try {
    const [psi, pm] = await Promise.all([latest("psi"), latest("pm25").catch(() => null)]);
    psiItem = psi.items?.[0];
    pm25 = byRegion(pm?.items?.[0]?.readings?.pm25_one_hourly);
  } catch (err) {
    console.error("morning: data.gov.sg failed:", err.message);
    return res.status(502).json({ sent: false, error: "Couldn't reach data.gov.sg" });
  }
  const psi = byRegion(psiItem?.readings?.psi_twenty_four_hourly);
  if (!Object.keys(psi).length) return res.status(200).json({ sent: false, why: "no regional PSI" });

  const values = Object.values(psi);
  const low = psiLevel(Math.min(...values));
  const high = psiLevel(Math.max(...values));
  const band = low === high ? PSI_BANDS[high].label.toLowerCase() : `${PSI_BANDS[low].label.toLowerCase()} to ${PSI_BANDS[high].label.toLowerCase()}`;
  const worst = Object.entries(psi).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  const everywhere = Math.min(...values) === Math.max(...values);

  const title = `PSI this morning: ${span(psi)}, ${band}`;
  const body = [
    everywhere ? `The same across Singapore at ${sgHour(psiItem.timestamp)}.` : `Highest in the ${LABELS[worst]} at ${sgHour(psiItem.timestamp)}.`,
    Object.keys(pm25).length ? `PM2.5 ${span(pm25)} µg/m³.` : "",
    ADVICE[high],
  ].filter(Boolean).join(" ");

  try {
    await sendToTopic(TOPIC, {
      title,
      body,
      data: { type: "morning" },
      channel: "morning",
      tag: "morning",
      ttl: TTL_SECONDS,
      urgency: "high",
    });
  } catch (err) {
    console.error("morning:", err.message);
    return res.status(502).json({ sent: false, error: err.message });
  }
  return res.status(200).json({ sent: true, title, body });
}
