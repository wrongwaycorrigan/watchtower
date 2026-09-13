// Tokyo weather badge — small ambient status, not a toggleable globe layer.
// Uses Open-Meteo's current weather endpoint (keyless). WMO weather codes
// map to an emoji below; anything unmapped falls back to a generic icon.

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast?latitude=35.6895&longitude=139.6917&current=temperature_2m,weather_code';
const REFRESH_MS = 15 * 60_000; // ambient status, not live tracking

// WMO weather codes -> emoji. https://open-meteo.com/en/docs (weather_code)
function weatherEmoji(code) {
  if (code === 0) return '☀️';
  if (code === 1 || code === 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code === 85 || code === 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌡️'; // unmapped code
}

async function refresh() {
  const badge = document.getElementById('weather-badge');
  if (!badge) return;
  try {
    const res = await fetch(OPEN_METEO_URL);
    if (!res.ok) return;
    const data = await res.json();
    const tempC = data.current?.temperature_2m;
    const code = data.current?.weather_code;
    if (!Number.isFinite(tempC)) return;
    badge.textContent = `${weatherEmoji(code)} ${Math.round(tempC)}°C`;
  } catch (e) {
    console.warn('[WeatherBadge] fetch failed:', e);
  }
}

export function init() {
  refresh();
  setInterval(refresh, REFRESH_MS);
}
