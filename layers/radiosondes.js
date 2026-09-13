// Radiosondes — live weather balloon positions from SondeHub, keyless.
//
// Refreshes on enable, on a DEBOUNCED camera-changed event, and on a slow
// interval as a fallback. Do not hook viewer.scene.preRender for this —
// that fires every rendered frame (30-60+/sec) and will get this endpoint
// rate-limited almost immediately. Learned the hard way once already.
//
// Uses entities (not a raw PointPrimitiveCollection) specifically so each
// balloon can carry a label — point primitives can't have one attached.

const SONDEHUB_BASE = 'https://api.v2.sondehub.org';
const CAMERA_SETTLE_MS = 2500;
const REFRESH_MS = 60_000;

let _viewer = null;
let _dataSource = null;
let _cameraChangedRemover = null;
let _settleTimer = null;
let _pollTimer = null;

function getDotSize(altM) {
  if (altM <= 1000) return 12;
  if (altM <= 5000) return 11;
  if (altM <= 10000) return 10;
  if (altM <= 20000) return 9;
  return 8;
}

function getColor(pressureHpa) {
  if (pressureHpa >= 950) return Cesium.Color.fromCssColorString('#2ecc71'); // near ground
  if (pressureHpa >= 850) return Cesium.Color.fromCssColorString('#f0b23e'); // mid altitude
  return Cesium.Color.fromCssColorString('#e05252'); // high altitude
}

function formatAltitude(altM) {
  return altM >= 1000 ? `${(altM / 1000).toFixed(1)}km` : `${Math.round(altM)}m`;
}

async function refresh() {
  if (!_viewer || !_dataSource.show) return;

  const carto = _viewer.camera.positionCartographic;
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const lon = Cesium.Math.toDegrees(carto.longitude);

  try {
    const params = new URLSearchParams({
      last: '86400',
      lat: lat.toFixed(4),
      lon: lon.toFixed(4),
      distance: '100000',
      format: 'json',
    });
    const res = await fetch(`${SONDEHUB_BASE}/sondes?${params}`);
    if (!res.ok) return;
    const data = await res.json();
    const active = Object.values(data).filter((s) => s.snr != null && s.snr > 0);

    _dataSource.entities.removeAll();
    for (const s of active) {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
      const altM = s.alt ?? 0;
      const pressureHpa = s.pressure || 1013.25;
      const color = getColor(pressureHpa);

      _dataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, altM),
        model: {
          uri: '/sdrangel-3d-models/radiosondeballon.glb',
          minimumPixelSize: getDotSize(altM) * 10, // bumped up substantially - few simultaneous sondes means clutter isn't a concern, prioritize visibility
          maximumScale: 15000,
          color,
          colorBlendMode: Cesium.ColorBlendMode.MIX,
          colorBlendAmount: 0.5,
        },
        label: {
          text: formatAltitude(altM),
          font: '700 13px Nunito, sans-serif',
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
          backgroundPadding: new Cesium.Cartesian2(6, 4),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(10_000, 1.0, 50_000, 0.4),
        },
        description: `
          <b>Serial:</b> ${s.serial}<br>
          <b>Altitude:</b> ${formatAltitude(altM)}<br>
          <b>Pressure:</b> ${pressureHpa.toFixed(1)} hPa
        `,
      });
    }
  } catch (e) {
    console.warn('[Radiosondes] fetch failed:', e);
  }
}

export function init(viewer) {
  _viewer = viewer;
  _dataSource = new Cesium.CustomDataSource('radiosondes');
  _dataSource.show = false;
  viewer.dataSources.add(_dataSource);

  _cameraChangedRemover = viewer.camera.changed.addEventListener(() => {
    if (!_dataSource.show) return;
    if (_settleTimer) clearTimeout(_settleTimer);
    _settleTimer = setTimeout(refresh, CAMERA_SETTLE_MS);
  });
}

export function getCount() {
  return _dataSource ? _dataSource.entities.values.length : 0;
}

export function setEnabled(enabled) {
  _dataSource.show = enabled;
  if (enabled) {
    refresh();
    if (!_pollTimer) _pollTimer = setInterval(refresh, REFRESH_MS);
  } else if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}
