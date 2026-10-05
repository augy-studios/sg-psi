// NEA's bands and advice, the five regions, and Singapore-time formatting, shared by
// every view. The 24-hour PSI thresholds are also in api/_lib/bands.js, which the
// alerts use: keep the two in step.
// Plain script, not a module: published on window.SgPsi.

(function () {
  // `level` picks the band colour (--band-1 to --band-5 in style.css), so a PSI and a
  // PM2.5 band of the same severity look alike.
  const PSI_BANDS = [
    { id: "good", label: "Good", max: 50, level: 1 },
    { id: "moderate", label: "Moderate", max: 100, level: 2 },
    { id: "unhealthy", label: "Unhealthy", max: 200, level: 3 },
    { id: "very-unhealthy", label: "Very unhealthy", max: 300, level: 4 },
    { id: "hazardous", label: "Hazardous", max: Infinity, level: 5 },
  ];

  // NEA's bands for the 1-hour PM2.5 concentration, in micrograms per cubic metre.
  const PM25_BANDS = [
    { id: "normal", label: "Normal", max: 55, level: 1 },
    { id: "elevated", label: "Elevated", max: 150, level: 2 },
    { id: "high", label: "High", max: 250, level: 3 },
    { id: "very-high", label: "Very high", max: Infinity, level: 4 },
  ];

  // NEA's health advisory for the 24-hour PSI, by band, for each group it names.
  const ADVICE_GROUPS = [
    "Healthy people",
    "Elderly, pregnant women and children",
    "People with chronic lung or heart disease",
  ];
  const ADVICE = {
    good: ["Normal activities", "Normal activities", "Normal activities"],
    moderate: ["Normal activities", "Normal activities", "Normal activities"],
    unhealthy: [
      "Reduce prolonged or strenuous outdoor physical exertion",
      "Minimise prolonged or strenuous outdoor physical exertion",
      "Avoid prolonged or strenuous outdoor physical exertion",
    ],
    "very-unhealthy": [
      "Avoid prolonged or strenuous outdoor physical exertion",
      "Minimise outdoor activity",
      "Avoid outdoor activity",
    ],
    hazardous: ["Minimise outdoor activity", "Avoid outdoor activity", "Avoid outdoor activity"],
  };

  const REGIONS = ["north", "south", "east", "west", "central"];
  const REGION_LABELS = { north: "North", south: "South", east: "East", west: "West", central: "Central", islandwide: "Anywhere in Singapore" };

  const bandOf = (bands) => (value) => (Number.isFinite(value) ? bands.find((b) => value <= b.max) : null);
  const psiBand = bandOf(PSI_BANDS);
  const pm25Band = bandOf(PM25_BANDS);

  // The finite values of a { region: value } map, as a low and high.
  function range(byRegion) {
    const nums = REGIONS.map((r) => byRegion?.[r]).filter(Number.isFinite);
    return nums.length ? { low: Math.min(...nums), high: Math.max(...nums) } : null;
  }

  // ---------- Singapore time, whatever the device's own zone ----------

  const TZ = "Asia/Singapore";
  const hourFmt = new Intl.DateTimeFormat("en-SG", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
  const dayFmt = new Intl.DateTimeFormat("en-SG", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
  const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

  // "11pm", or "11:18pm" when it isn't on the hour.
  function sgTime(t) {
    const parts = hourFmt.formatToParts(new Date(t));
    const get = (type) => parts.find((p) => p.type === type)?.value || "";
    const minute = get("minute");
    return `${get("hour")}${minute && minute !== "00" ? `:${minute}` : ""}${get("dayPeriod").replace(/\W/g, "").toLowerCase()}`;
  }

  const sgDay = (t) => dayFmt.format(new Date(t));
  const sameSgDay = (a, b) => dateKey.format(new Date(a)) === dateKey.format(new Date(b));

  // "11pm" today, "Mon 5 Oct, 11pm" otherwise.
  function sgWhen(t) {
    return sameSgDay(t, Date.now()) ? sgTime(t) : `${sgDay(t)}, ${sgTime(t)}`;
  }

  // Meteorological direction (where the wind comes from) as a 16-point compass name.
  const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
  const knotsToKmh = (kn) => Math.round(kn * 1.852);

  window.SgPsi = {
    PSI_BANDS,
    PM25_BANDS,
    ADVICE_GROUPS,
    ADVICE,
    REGIONS,
    REGION_LABELS,
    psiBand,
    pm25Band,
    range,
    sgTime,
    sgDay,
    sgWhen,
    sameSgDay,
    compass,
    knotsToKmh,
  };
})();
