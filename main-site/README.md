# SG PSI site

The site at [sgpsi.uwuapps.org](https://sgpsi.uwuapps.org): a static page, no build step,
plus Vercel Functions in `api/`.

## Layout

```text
main-site/
├── index.html, style.css, script.js   the page: five views, theme and alerts modals
├── js/
│   ├── theme.js, icons.js, ui.js      the uwuapps theme (uwuapps-theme.md), time-based mode included
│   ├── update.js                      service worker registration, update bar and offline bar
│   ├── bands.js                       NEA's PSI and PM2.5 bands, health advice, SGT formatting
│   ├── charts.js                      the SVG line chart behind Trends and Wind
│   ├── map.js                         Leaflet on OneMap tiles, falling back to OSM per tile
│   └── alerts.js                      PSI alerts: subscribing to web push
├── vendor/leaflet/                    Leaflet 1.9.4, self-hosted so the map works offline
├── sw.js                              service worker
├── api/
│   ├── now.js                         latest PSI, PM2.5 and wind
│   ├── history.js                     last 24 hours or 7 days, for the charts
│   ├── cron/collect.js                every 5 minutes: store readings, send alerts
│   ├── push/vapid-key.js              public VAPID key for subscribing
│   ├── push/devices/[id].js           turn a device's alerts on, change them, or off
│   ├── _lib/                          data.gov.sg, Supabase, PSI bands
│   └── _push/                         Upstash store, validation, the alert rules
└── .env.example                       every environment variable, explained
```

Supabase holds the readings (`sgpsi_` tables, `../migrations/`). Upstash holds only
what alerts need: each device's push subscription and choice, and the last PSI levels.

## Setting it up

Every variable is in [`.env.example`](.env.example). Set them in the Vercel project
under Settings, Environment Variables, for Production (and Preview if wanted).
Variables reach only deployments made after they are added, so redeploy afterwards.

1. **data.gov.sg.** `DATA_GOV_KEY`. Optional, but it lifts the rate limit.
2. **Supabase.** Run [`../migrations/001_sgpsi_schema.sql`](../migrations/001_sgpsi_schema.sql)
   in the Supabase SQL editor, then set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
   (the service role key).
3. **Cron.** `CRON_SECRET`, any long random string (`openssl rand -hex 32`). Vercel
   sends it to `/api/cron/collect` every 5 minutes (`vercel.json`); without it nothing
   is collected. The schedule needs the Pro plan.
4. **PSI alerts.**
   - In the Vercel project, Storage, Create Database, Upstash, Redis, and connect it
     without a prefix. That sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Every key
     this site writes starts with `sgpsi:`, so one store can serve several projects.
   - Make the VAPID keys once, and keep them: new keys mean every device has to turn
     alerts off and on again.

     ```sh
     cd main-site
     npm install
     npx web-push generate-vapid-keys
     ```

     Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (mark it Sensitive) and
     `VAPID_SUBJECT` (`mailto:` an address push services can reach).

### Checking it

1. `/api/now` shows the latest readings, and `/api/push/vapid-key` your public key
   (a `503` names what is missing).
2. In Settings, Cron Jobs, press **Run** on `/api/cron/collect` and open its logs. The
   first run backfills the last 7 days of PSI and PM2.5 into Supabase and records the
   PSI levels for alerts: `"backfilled": {"psi": [...dates], ...}, "alerts": {"first": true}`.
   Later runs store the newest reading; backfill runs again at the top of each hour
   for any day still missing hours.
3. Trends then draws from Supabase. Wind history has no backfill (data.gov.sg keeps it
   by the minute, dozens of pages a day), so the Wind chart fills in an hour at a time
   from the first run.
4. On a phone, open the alerts bell, pick an area and a level, and turn alerts on. An
   alert comes when that area's 24-hour PSI next changes band at or above the level.
   On iPhone and iPad, only from the site added to the Home Screen.

## How alerts decide

Each new hourly reading is compared with the last (`api/_push/notify.js`). A device set
to, say, Unhealthy in the West hears when the West reaches Unhealthy, when it changes to
another band while still at or above it, and when it eases back below. "Any region"
follows whichever region is worst. A reading revised within the same hour is not
announced twice.

## Offline

The service worker precaches the page, scripts, styles, icons and Leaflet. The last
`/api/now` and `/api/history` answers, the Jua font and up to 800 map tiles already
looked at are kept as they are used, in caches that survive updates. Offline, the page
shows those with a bar saying so; the map shows whatever tiles were seen before.

## Changing things

- **Bump `VERSION` in `sw.js` on every deploy** that changes anything it serves.
  That is what offers people the update bar; nothing reloads until they press Reload.
- A new file the page needs offline goes in `ASSETS` in `sw.js`.
- Band thresholds live in `js/bands.js` and `api/_lib/bands.js`; keep them in step.
- `migrations/` files are never edited once run. A change is a new numbered file.

## Running locally

```sh
cd main-site
npm install
vercel dev
```

`vercel env pull .env.local` brings the variables down. Without any, the page still
works: readings come straight from data.gov.sg, and Trends asks it for each day.

## Privacy

For alerts, Upstash holds each device's push subscription, its area and its level,
under a random ID the browser made up. No names or locations. Turning alerts off
deletes the device. Supabase holds only NEA's public readings.
