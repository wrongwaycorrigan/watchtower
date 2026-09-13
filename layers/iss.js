// ISS live position — Open Notify API (api.open-notify.org), keyless.
//
// This API is documented elsewhere as having no CORS headers, so a plain
// fetch() would likely be blocked the same way adsb.fi was earlier in
// this project. Its own docs explicitly document a JSONP fallback
// (?callback=...) built for exactly this situation — script tags aren't
// subject to the Same-Origin Policy the way fetch()/XHR are. Using that
// documented escape hatch directly rather than guessing at fetch() first.
//
// Note: the API is http:// only, not https://. Fine for this project's
// current local http://localhost setup: if Watchtower is ever served over
// https, this would need a different approach (mixed-content blocking,
// same class of issue flagged for the local tar1090 receiver).
//
// Not wired into the dock-toggle system at all — no new icon, per the
// request. show()/hide() are called directly from the globe-view toggle
// in main.js: the ISS only appears while zoomed out to see the whole
// Earth, which is the only view where its real orbital altitude actually
// reads as "in the sky" rather than an arbitrary floating dot.
//
// Uses the real iss.glb model from srcejon/sdrangel-3d-models (local copy
// at sdrangel-3d-models/ in the project root, served the same way as any
// other static file). minimumPixelSize keeps it visible at globe-view
// distances, where the model's real-world scale would otherwise be
// imperceptible.

const ISS_POLL_MS = 5000; // matches Open Notify's own "no more than once every 5s" guidance
const ISS_ALTITUDE_M = 408_000; // approximate mean ISS altitude - varies ~370-460km with reboosts

let _viewer = null;
let _entity = null;
let _pollTimer = null;

function fetchIssPositionJsonp() {
  return new Promise((resolve, reject) => {
    const callbackName = `__issCallback_${Date.now()}`;
    const script = document.createElement('script');

    window[callbackName] = (data) => {
      delete window[callbackName];
      script.remove();
      resolve(data);
    };
    script.onerror = () => {
      delete window[callbackName];
      script.remove();
      reject(new Error('ISS JSONP request failed'));
    };
    script.src = `http://api.open-notify.org/iss-now.json?callback=${callbackName}`;
    document.body.appendChild(script);
  });
}

async function refresh() {
  try {
    const data = await fetchIssPositionJsonp();
    const lat = parseFloat(data.iss_position?.latitude);
    const lon = parseFloat(data.iss_position?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const position = Cesium.Cartesian3.fromDegrees(lon, lat, ISS_ALTITUDE_M);
    if (_entity) {
      _entity.position = position;
    } else {
      _entity = _viewer.entities.add({
        position,
        model: {
          uri: '/sdrangel-3d-models/iss.glb',
          minimumPixelSize: 48, // real ISS scale would be invisible at globe-view distances
          maximumScale: 20000,
        },
        label: {
          text: 'ISS',
          font: '700 11px Nunito, sans-serif',
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
          backgroundPadding: new Cesium.Cartesian2(5, 3),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -20),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        description: '<b>International Space Station</b><br>Live position via Open Notify. Altitude shown is an approximation (~408km mean orbit).',
      });
    }
  } catch (e) {
    console.warn('[ISS] position fetch failed:', e);
  }
}

export function init(viewer) {
  _viewer = viewer;
}

export function setEnabled(enabled) {
  if (_entity) _entity.show = enabled;

  if (enabled) {
    refresh();
    if (!_pollTimer) _pollTimer = setInterval(refresh, ISS_POLL_MS);
  } else if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}
