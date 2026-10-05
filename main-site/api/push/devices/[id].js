// Turn PSI alerts on for a device or change its area and level (PUT, sent again on every
// page load, which also keeps the subscription fresh), or off (DELETE: the device is
// forgotten).

import { devices, rateLimited, storeConfigured } from "../../_push/store.js";
import { ValidationError, isId, parseDevice } from "../../_push/validate.js";

const MAX_DEVICES = 50_000;
const RATE_LIMIT = 60; // requests per IP per minute

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!storeConfigured()) return res.status(503).json({ error: "PSI alerts are not set up: no Redis store" });

  const { id } = req.query;
  if (!isId(id)) return res.status(400).json({ error: "bad device id" });

  // Vercel puts the client's address first in x-forwarded-for.
  const ip = req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";

  try {
    if (await rateLimited(ip, RATE_LIMIT)) return res.status(429).json({ error: "too many requests" });

    if (req.method === "PUT") {
      if (!(await devices.has(id)) && (await devices.size()) >= MAX_DEVICES) {
        return res.status(503).json({ error: "server full" });
      }
      const device = parseDevice(req.body);
      await devices.set(id, { ...device, updatedAt: Date.now() });
      return res.status(200).json({ area: device.area, level: device.level });
    }

    if (req.method === "DELETE") {
      await devices.delete(id);
      return res.status(204).end();
    }

    res.setHeader("Allow", "PUT, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}
