// Disasters — merges two sources under one button/panel: USGS earthquakes
// (polled) and Alert-JP's SSE stream for volcanic alerts only (its
// earthquake coverage is much sparser than USGS). Two separate
// CustomDataSources, since the earthquake source clears and rebuilds every
// poll, which would wipe the incrementally-pushed volcanic markers.

const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const USGS_REFRESH_MS = 60_000;

const ALERTS_REST_URL = 'https://api.alert-jp.org/api/v1/alerts?limit=20';
const ALERTS_STREAM_URL = 'https://api.alert-jp.org/api/v1/stream/alerts';

// Volcanic alerts only give a Japanese volcano name, no coordinates.
// Alerts for a volcano not in this table are counted but not placed.
const VOLCANO_COORDS = {
  '桜島': { lat: 31.5772, lon: 130.6589 },        // Sakurajima
  '十勝岳': { lat: 43.4183, lon: 142.6863 },       // Tokachidake
  '浅間山': { lat: 36.4061, lon: 138.5261 },       // Asama-yama
  '阿蘇山': { lat: 32.8842, lon: 131.1044 },       // Aso-san
  '御嶽山': { lat: 35.8925, lon: 137.4805 },       // Ontake-san
  '有珠山': { lat: 42.5439, lon: 140.8358 },       // Usu-zan
  '三宅島': { lat: 34.0808, lon: 139.5264 },       // Miyake-jima
  '諏訪之瀬島': { lat: 29.6386, lon: 129.7139 },    // Suwanosejima
  '口永良部島': { lat: 30.4433, lon: 130.2172 },    // Kuchinoerabujima
  '霧島山(新燃岳)': { lat: 31.9142, lon: 130.8858 }, // Kirishima (Shinmoedake)
};

let _quakeSource = null;
let _alertJpSource = null;
let _quakeTimer = null;
let _eventSource = null;
let _alertJpAlerts = new Map(); // id -> entity|null
let _recentAlerts = []; // [{timeMs, text}], newest first, capped
const RECENT_ALERTS_CAP = 20;

function addRecentAlert(timeMs, text) {
  if (!text) return;
  if (_recentAlerts.some((a) => a.text === text)) return; // dedup
  _recentAlerts.push({ timeMs: timeMs || Date.now(), text });
  _recentAlerts.sort((a, b) => b.timeMs - a.timeMs);
  if (_recentAlerts.length > RECENT_ALERTS_CAP) _recentAlerts.length = RECENT_ALERTS_CAP;
}

function depthColor(depthKm) {
  if (depthKm < 70) return Cesium.Color.RED;
  if (depthKm < 300) return Cesium.Color.ORANGE;
  return Cesium.Color.YELLOW;
}

function volcanicColor(alertLevel) {
  if (alertLevel >= 4) return Cesium.Color.fromCssColorString('#e05252'); // high alert
  if (alertLevel >= 3) return Cesium.Color.fromCssColorString('#f0b23e'); // moderate
  return Cesium.Color.fromCssColorString('#f0d24f'); // low/watch
}

const TSUNAMI_COLOR = Cesium.Color.fromCssColorString('#3ea8f0'); // distinct blue - not used by any other category
const WEATHER_COLOR = Cesium.Color.fromCssColorString('#a35ee0'); // distinct purple

async function refreshEarthquakes() {
  if (!_quakeSource) return;
  try {
    const res = await fetch(USGS_URL);
    if (!res.ok) return;
    const geojson = await res.json();

    _quakeSource.entities.removeAll();
    for (const feature of geojson.features) {
      const [lon, lat, depthKm] = feature.geometry.coordinates;
      const mag = feature.properties.mag;
      if (mag == null || mag < 2.5) continue;

      const color = depthColor(depthKm || 0);
      const radiusM = Math.pow(2, mag) * 1000;
      const timeStr = new Date(feature.properties.time).toLocaleString();
      addRecentAlert(feature.properties.time, `M${mag.toFixed(1)} — ${feature.properties.place ?? 'Unknown location'}`);

      _quakeSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        ellipse: {
          semiMajorAxis: radiusM,
          semiMinorAxis: radiusM,
          material: color.withAlpha(0.35),
          outline: true,
          outlineColor: color,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: `M${mag.toFixed(1)}`,
          font: '700 11px Nunito, sans-serif',
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
          backgroundPadding: new Cesium.Cartesian2(5, 3),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        description: `
          <b>M${mag.toFixed(1)}</b> — ${feature.properties.place ?? 'Unknown location'}<br>
          Depth: ${(depthKm ?? 0).toFixed(1)} km<br>
          Time: ${timeStr}<br>
          <a href="${feature.properties.url}" target="_blank" rel="noopener noreferrer">USGS event page</a>
        `,
      });
    }
  } catch (e) {
    console.warn('[Disasters] USGS fetch failed:', e);
  }
}

// Shared placement for tsunami/weather alerts, placed only when the alert
// includes real coordinates (best-effort field names, unconfirmed schema).
function upsertGenericAlert(alert, { icon, color, fallbackLabel }) {
  const lat = alert.location?.lat;
  const lon = alert.location?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    _alertJpAlerts.set(alert.id, null); // counted, not placed
    return;
  }

  const existing = _alertJpAlerts.get(alert.id);
  if (existing) _alertJpSource.entities.remove(existing);

  const label = alert.areas?.[0] || fallbackLabel;
  const entity = _alertJpSource.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat),
    point: { pixelSize: 12, color, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
    label: {
      text: `${icon} ${label}`,
      font: '700 11px Nunito, sans-serif',
      fillColor: Cesium.Color.WHITE,
      showBackground: true,
      backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
      backgroundPadding: new Cesium.Cartesian2(5, 3),
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -14),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    description: `<b>${alert.title ?? fallbackLabel}</b><br>${alert.description ?? ''}`,
  });
  _alertJpAlerts.set(alert.id, entity);
}

function upsertAlertJpEvent(alert) {
  if (!alert?.id) return;
  if (alert.type === 'earthquake') return; // USGS direct is more complete

  if (alert.type === 'volcanic') {
    const volcanoName = alert.areas?.[0];
    addRecentAlert(Date.parse(alert.issuedAt) || Date.now(), alert.title || `⚠ ${volcanoName}`);
    const coords = VOLCANO_COORDS[volcanoName];
    if (!coords) {
      _alertJpAlerts.set(alert.id, null); // counted, not placed
      return;
    }
    const existing = _alertJpAlerts.get(alert.id);
    if (existing) _alertJpSource.entities.remove(existing);
    const color = volcanicColor(alert.rawData?.alertLevel ?? 3);
    const entity = _alertJpSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(coords.lon, coords.lat),
      point: { pixelSize: 12, color, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
      label: {
        text: `⚠ ${volcanoName}`,
        font: '700 11px Nunito, sans-serif',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
        backgroundPadding: new Cesium.Cartesian2(5, 3),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      description: `<b>${alert.title}</b><br>${alert.description}`,
    });
    _alertJpAlerts.set(alert.id, entity);
    return;
  }

  if (alert.type === 'tsunami') {
    addRecentAlert(Date.parse(alert.issuedAt) || Date.now(), alert.title || '🌊 Tsunami alert');
    upsertGenericAlert(alert, { icon: '🌊', color: TSUNAMI_COLOR, fallbackLabel: 'Tsunami' });
    return;
  }

  if (alert.type === 'weather') {
    addRecentAlert(Date.parse(alert.issuedAt) || Date.now(), alert.title || '⛈ Severe weather alert');
    upsertGenericAlert(alert, { icon: '⛈', color: WEATHER_COLOR, fallbackLabel: 'Severe weather' });
    return;
  }

  _alertJpAlerts.set(alert.id, null); // unknown type - counted, not placed
}

async function fetchInitialAlerts() {
  try {
    const res = await fetch(ALERTS_REST_URL);
    if (!res.ok) return;
    const body = await res.json();
    for (const alert of body.data ?? []) {
      upsertAlertJpEvent(alert);
    }
  } catch (e) {
    console.warn('[Disasters] Alert-JP initial fetch failed:', e);
  }
}

function connectStream() {
  if (_eventSource) return;
  _eventSource = new EventSource(ALERTS_STREAM_URL);
  _eventSource.addEventListener('alert', (e) => {
    try {
      upsertAlertJpEvent(JSON.parse(e.data));
    } catch (err) {
      console.warn('[Disasters] could not parse SSE alert:', err);
    }
  });
  _eventSource.onerror = () => {
    console.warn('[Disasters] SSE connection issue (browser will auto-retry)');
  };
}

function disconnectStream() {
  if (_eventSource) {
    _eventSource.close();
    _eventSource = null;
  }
}

export function init(viewer) {
  _quakeSource = new Cesium.CustomDataSource('disasters-earthquakes');
  _quakeSource.show = false;
  viewer.dataSources.add(_quakeSource);

  _alertJpSource = new Cesium.CustomDataSource('disasters-alertjp');
  _alertJpSource.show = false;
  viewer.dataSources.add(_alertJpSource);
}

export function setEnabled(enabled) {
  _quakeSource.show = enabled;
  _alertJpSource.show = enabled;
  if (enabled) {
    refreshEarthquakes();
    if (!_quakeTimer) _quakeTimer = setInterval(refreshEarthquakes, USGS_REFRESH_MS);
    fetchInitialAlerts();
    connectStream();
  } else {
    if (_quakeTimer) {
      clearInterval(_quakeTimer);
      _quakeTimer = null;
    }
    disconnectStream();
  }
}

export function getCount() {
  const quakeCount = _quakeSource ? _quakeSource.entities.values.length : 0;
  return quakeCount + _alertJpAlerts.size;
}

export function getRecentAlerts(limit = 4) {
  return _recentAlerts.slice(0, limit).map((a) => a.text);
}
