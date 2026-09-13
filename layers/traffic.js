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

const TAR1090_URL = 'http://192.168.1.14/tar1090/data/aircraft.json';
const REFRESH_MS = 5_000; // local network, no rate limit to respect
const PLANE_MODEL = '/plane-models/Cesium_Air.glb';
const LOW_ALT_COLOR = Cesium.Color.fromCssColorString('#4fd6ff'); // below ~10,000 ft
const HIGH_ALT_COLOR = Cesium.Color.fromCssColorString('#ffd24f'); // above ~10,000 ft

let _dataSource = null;
let _timer = null;

async function refresh() {
  if (!_dataSource?.show) return;

  try {
    const res = await fetch(TAR1090_URL);
    console.log('[Traffic] response status:', res.status);
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '(could not read body)');
      console.warn('[Traffic] non-OK response, body was:', bodyText);
      return;
    }
    const data = await res.json();
    const aircraft = data.aircraft ?? data.ac ?? []; // "ac" fallback for other installs
    console.log('[Traffic] aircraft in response:', aircraft.length);
    if (aircraft.length) {
      console.log('[Traffic] DIAGNOSTIC - raw fields of first aircraft:', aircraft[0]);
      console.log('[Traffic] DIAGNOSTIC - type field (t) values seen:', aircraft.map((a) => a.t));
    }

    _dataSource.entities.removeAll();
    for (const ac of aircraft) {
      if (!Number.isFinite(ac.lat) || !Number.isFinite(ac.lon)) continue;
      const altFt = typeof ac.alt_baro === 'number' ? ac.alt_baro : 0; // alt_baro can be "ground"
      const altM = altFt * 0.3048;
      const headingDeg = Number.isFinite(ac.track) ? ac.track : 0;
      const callsign = (ac.flight || ac.hex || '').trim();
      const position = Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, Math.max(altM, 50));
      const description = `<b>${callsign || 'Unknown'}</b>${ac.t ? ` (${ac.t})` : ''}<br>Altitude: ${Math.round(altFt)} ft`;

      const hpr = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(headingDeg), 0, 0);
      _dataSource.entities.add({
        position,
        orientation: Cesium.Transforms.headingPitchRollQuaternion(position, hpr),
        model: {
          uri: PLANE_MODEL,
          minimumPixelSize: 24,
          maximumScale: 300,
          color: altFt > 10_000 ? HIGH_ALT_COLOR : LOW_ALT_COLOR,
          colorBlendMode: Cesium.ColorBlendMode.MIX,
          colorBlendAmount: 0.35,
        },
        description,
      });
    }
    console.log('[Traffic] aircraft rendered:', aircraft.length);
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
