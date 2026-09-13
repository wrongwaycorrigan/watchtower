// ISS live position — Open Notify API (api.open-notify.org), keyless.
// Uses JSONP (Open Notify has no CORS headers). API is http:// only, so
// this would need a different approach if Watchtower is served over https.
//
// Not wired into the dock-toggle system — setEnabled() is called directly
// from main.js's globe-view toggle, since real orbital altitude only reads
// as "in the sky" when zoomed out. Uses iss.glb from srcejon/sdrangel-3d-models.

const ISS_POLL_MS = 5000; // Open Notify's own rate guidance
const ISS_ALTITUDE_M = 408_000; // approximate mean altitude

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
          minimumPixelSize: 48, // real scale is invisible at globe-view distances
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
