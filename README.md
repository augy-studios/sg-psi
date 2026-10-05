# SG PSI

Singapore's air quality at a glance: live PSI, PM2.5 and wind across the island.

Live at **[sgpsi.uwuapps.org](https://sgpsi.uwuapps.org)**

## Features

- **Overview**: the islandwide 24-hour PSI and 1-hour PM2.5, NEA's health advice for the
  current band, and each region's readings
- **Map**: a full screen map of Singapore on OneMap, with each region's reading and the
  wind at every weather station
- **Trends**: PSI and PM2.5 by region over the last 24 hours or 7 days, as a chart or a table
- **Pollutants**: every sub-index and concentration behind the PSI, and which one sets it
- **Wind**: speed and direction at every station, and the last day's average
- **PSI alerts**: a notification when the PSI in a chosen region reaches a chosen level
- **Works offline**, installs as an app, and follows the uwuapps theme, with light, dark
  and time-based modes

## Layout

```text
sg-psi/
├── main-site/       the site and its Vercel Functions; setup in main-site/README.md
├── migrations/      SQL to run in the Supabase SQL editor, in order
└── *.json           data.gov.sg's API specs for the PSI, PM2.5 and wind feeds
```

## Credits

- PSI, PM2.5 and wind from NEA via [data.gov.sg](https://data.gov.sg/) (Singapore Open Data Licence)
- Map tiles from [OneMap](https://www.onemap.gov.sg/) by the Singapore Land Authority, and
  [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- Maps drawn with [Leaflet](https://leafletjs.com/)

## License

[MIT](LICENSE) © Augy Studios

---

[Terms](https://augystudios.com/terms) • [EULA](https://augystudios.com/eula) • [Cookies](https://augystudios.com/cookies) • [Privacy](https://augystudios.com/privacy)
