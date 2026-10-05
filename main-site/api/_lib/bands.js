// NEA's bands for the 24-hour PSI, for the alerts the cron sends. The page has its own
// copy in js/bands.js, with the advice text too: keep the thresholds in step.

export const PSI_BANDS = [
  { id: "good", label: "Good", max: 50 },
  { id: "moderate", label: "Moderate", max: 100 },
  { id: "unhealthy", label: "Unhealthy", max: 200 },
  { id: "very-unhealthy", label: "Very unhealthy", max: 300 },
  { id: "hazardous", label: "Hazardous", max: Infinity },
];

// The bands a person can ask to be alerted at: every one but Good.
export const ALERT_LEVELS = PSI_BANDS.slice(1).map((b) => b.id);

// 0 for Good up to 4 for Hazardous.
export function psiLevel(value) {
  return PSI_BANDS.findIndex((b) => value <= b.max);
}

export const levelOf = (id) => PSI_BANDS.findIndex((b) => b.id === id);

// The lowest PSI in a band, which is what "reaches Unhealthy" means: 101.
export const floorOf = (level) => (level <= 0 ? 0 : PSI_BANDS[level - 1].max + 1);

// What NEA advises healthy people at each band, the line a notification has room for.
export const ADVICE = [
  "Normal activities.",
  "Normal activities.",
  "Reduce prolonged or strenuous outdoor physical exertion.",
  "Avoid prolonged or strenuous outdoor physical exertion.",
  "Minimise outdoor activity.",
];
