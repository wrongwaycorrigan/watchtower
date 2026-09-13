// Weather — RainViewer live precipitation radar, keyless.
//
// RainViewer's free tier caps at zoom 7 (~150km tiles). maximumLevel: 7
// tells Cesium to stretch that tile at closer zooms instead of requesting
// a nonexistent deeper one, which otherwise returns an error placeholder.
// Close zoom will look like a soft blur rather than crisp radar detail.
//
// LibreWXR (github.com/JoshuaKimsey/LibreWXR) is a self-hostable
// alternative with full resolution, if that's needed later.

const RAINVIEWER_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';
const REFRESH_MS = 10 * 60_000;
const RAINVIEWER_MAX_ZOOM = 7;

let _viewer = null;
let _precipLayer = null;
let _pollTimer = null;

async function refreshRadarImagery() {
  try {
    const res = await fetch(RAINVIEWER_INDEX);
    if (!res.ok) return;
    const { radar } = await res.json();
    const latest = radar.past.at(-1);

    if (_precipLayer) _viewer.imageryLayers.remove(_precipLayer, true);
    _precipLayer = _viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: `https://tilecache.rainviewer.com${latest.path}/256/{z}/{x}/{y}/2/1_1.png`,
        credit: 'RainViewer',
        maximumLevel: RAINVIEWER_MAX_ZOOM,
      }),
    );
    _precipLayer.alpha = 0.55;
    _precipLayer.show = true;
  } catch (e) {
    console.warn('[Weather] radar imagery fetch failed:', e);
  }
}

export function init(viewer) {
  _viewer = viewer;
}

export function setEnabled(enabled) {
  if (_precipLayer) _precipLayer.show = enabled;

  if (enabled) {
    refreshRadarImagery();
    if (!_pollTimer) _pollTimer = setInterval(refreshRadarImagery, REFRESH_MS);
  } else if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}
