// Moon phase badge — pure math, no API call at all. Unlike tides, lunar
// phase is a genuinely universal astronomical fact (same everywhere on
// Earth at a given moment), no location-specific calibration problem, so
// there's nothing to fetch or approximate here.
//
// Method: days elapsed since a known reference new moon, modulo the
// synodic month (the real average new-moon-to-new-moon period, ~29.53
// days), gives a 0-1 phase fraction. Illumination is approximated from
// that fraction via a simple cosine model - not perfectly precise (real
// illumination varies slightly due to orbital eccentricity), but close
// enough for a small ambient badge, same "good enough for display, not
// scientific precision" standard used elsewhere in this project.

const SYNODIC_MONTH_DAYS = 29.530588861;
const KNOWN_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14, 0); // a well-documented reference new moon
const REFRESH_MS = 60 * 60_000; // phase changes slowly - hourly is plenty

const PHASE_NAMES = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
const PHASE_EMOJI = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];

function getMoonPhase(nowMs = Date.now()) {
  const daysSinceKnownNewMoon = (nowMs - KNOWN_NEW_MOON_MS) / 86_400_000;
  let phase = (daysSinceKnownNewMoon % SYNODIC_MONTH_DAYS) / SYNODIC_MONTH_DAYS;
  if (phase < 0) phase += 1;
  const illuminationPct = Math.round(((1 - Math.cos(2 * Math.PI * phase)) / 2) * 100);
  const bucket = Math.floor((phase + 0.0625) / 0.125) % 8;
  return { name: PHASE_NAMES[bucket], emoji: PHASE_EMOJI[bucket], illuminationPct };
}

function refresh() {
  const badge = document.getElementById('moon-badge');
  if (!badge) return;
  const { name, emoji, illuminationPct } = getMoonPhase();
  badge.textContent = `${emoji} ${illuminationPct}%`;
  badge.title = `${name} — ${illuminationPct}% illuminated`;
}

export function init() {
  refresh();
  setInterval(refresh, REFRESH_MS);
}
