// Air traffic — local tar1090/readsb feed, no third party involved.
//
// CORS still applies even on your own LAN. If you get a CORS error, add
// an Access-Control-Allow-Origin header in your receiver's lighttpd
// config. Also: https:// pages can't fetch plain http:// (mixed content).
//
// tar1090 serves an "aircraft" array; checking "ac" too as a fallback for
// adsb.fi/ADSB Exchange-style installs.
//
// Every aircraft renders as the same stylized model (see
// plane-models/NOTICE.txt for source/license), tinted by altitude band
// rather than picked per real ICAO type - no verified CC0 "cute" low-poly
// aircraft kit with real category variety was found, unlike the ships.
//
// Aircraft are upserted by ICAO hex (not rebuilt from scratch every poll)
// into a SampledPositionProperty per aircraft, so the entity glides
// smoothly between the last few real fixes instead of snapping to a new
// spot every REFRESH_MS. forwardExtrapolationType keeps it moving on its
// last known heading/speed for a bit past the newest sample too, so a
// slow or missed poll doesn't freeze it mid-air. Orientation comes from
// Cesium's VelocityOrientationProperty - derived from the interpolated
// path itself, so banking stays in sync with position rather than
// snapping separately every poll. Requires viewer.clock.shouldAnimate,
// set once in main.js.

const TAR1090_URL = 'http://192.168.1.14/tar1090/data/aircraft.json';
const REFRESH_MS = 5_000; // local network, no rate limit to respect
const STALE_MS = 30_000; // pruned if missing from ~6 consecutive polls
const EXTRAPOLATE_SECONDS = 15; // safety margin past the newest sample
const PLANE_MODEL = '/plane-models/Cesium_Air.glb';
const LOW_ALT_COLOR = Cesium.Color.fromCssColorString('#4fd6ff'); // below ~10,000 ft
const HIGH_ALT_COLOR = Cesium.Color.fromCssColorString('#ffd24f'); // above ~10,000 ft

let _dataSource = null;
let _timer = null;
const _aircraft = new Map(); // hex -> { positionProperty, entity, lastUpdate }

function upsertAircraft(hex, ac) {
  const altFt = typeof ac.alt_baro === 'number' ? ac.alt_baro : 0; // alt_baro can be "ground"
  const altM = altFt * 0.3048;
  const callsign = (ac.flight || ac.hex || '').trim();
  const position = Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, Math.max(altM, 50));
  // ac.t (ICAO type, e.g. "A320") depends on the receiver's own database
  // being populated - confirmed absent on at least one real install, so
  // this suffix just won't show there. Harmless either way.
  const description = `<b>${callsign || 'Unknown'}</b>${ac.t ? ` (${ac.t})` : ''}<br>Altitude: ${Math.round(altFt)} ft`;
  const color = altFt > 10_000 ? HIGH_ALT_COLOR : LOW_ALT_COLOR;
  const now = Cesium.JulianDate.now();

  let a = _aircraft.get(hex);
  if (!a) {
    const positionProperty = new Cesium.SampledPositionProperty();
    positionProperty.forwardExtrapolationType = Cesium.ExtrapolationType.EXTRAPOLATE;
    positionProperty.forwardExtrapolationDuration = EXTRAPOLATE_SECONDS;
    positionProperty.setInterpolationOptions({
      interpolationDegree: 1,
      interpolationAlgorithm: Cesium.LinearApproximation,
    });
    positionProperty.addSample(now, position);

    const entity = _dataSource.entities.add({
      position: positionProperty,
      orientation: new Cesium.VelocityOrientationProperty(positionProperty),
      model: {
        uri: PLANE_MODEL,
        minimumPixelSize: 40,
        maximumScale: 600,
        color,
        colorBlendMode: Cesium.ColorBlendMode.MIX,
        colorBlendAmount: 0.35,
      },
      description,
    });
    a = { positionProperty, entity };
    _aircraft.set(hex, a);
  } else {
    a.positionProperty.addSample(now, position);
    a.entity.model.color = color;
    a.entity.description = description;
  }
  a.lastUpdate = Date.now();
}

function pruneStaleAircraft() {
  const now = Date.now();
  for (const [hex, a] of _aircraft) {
    if (now - a.lastUpdate <= STALE_MS) continue;
    _dataSource.entities.remove(a.entity);
    _aircraft.delete(hex);
  }
}

async function refresh() {
  if (!_dataSource?.show) return;

  try {
    const res = await fetch(TAR1090_URL);
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '(could not read body)');
      console.warn('[Traffic] non-OK response, body was:', bodyText);
      return;
    }
    const data = await res.json();
    const aircraft = data.aircraft ?? data.ac ?? []; // "ac" fallback for other installs

    for (const ac of aircraft) {
      if (!Number.isFinite(ac.lat) || !Number.isFinite(ac.lon) || !ac.hex) continue;
      upsertAircraft(ac.hex, ac);
    }
    pruneStaleAircraft();
  } catch (e) {
    console.error('[Traffic] fetch failed (check the Network tab - could be CORS, could be the receiver being offline):', e);
  }
}

export function init(viewer) {
  _dataSource = new Cesium.CustomDataSource('traffic');
  _dataSource.show = false;
  viewer.dataSources.add(_dataSource);
}

export function getCount() {
  return _dataSource ? _dataSource.entities.values.length : 0;
}

export function setEnabled(enabled) {
  _dataSource.show = enabled;
  if (enabled) {
    refresh();
    if (!_timer) _timer = setInterval(refresh, REFRESH_MS);
  } else if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
