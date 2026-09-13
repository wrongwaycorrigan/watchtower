// Weather — RainViewer live precipitation radar, keyless.
//
// Earlier versions of this file tried two approaches that didn't land:
//   1. A grid of Open-Meteo cloud/precip billboard dots - functionally
//      fine, but visually just reads as "a grid of dots," not weather.
//   2. RainViewer's imagery layer with no zoom limit set - which meant
//      zooming in past their tile depth requested a tile that doesn't
//      exist, and their server returns an actual "Zoom level Not
//      Supported" placeholder image instead of just going blank.
//
// The real fix for #2: RainViewer's own docs confirm their free tier's
// maximum zoom is 7 (~150km per tile - they restricted this in Jan 2026;
// it used to go deeper). Passing `maximumLevel: 7` to Cesium's imagery
// provider tells it to stop there and reuse/stretch that tile for closer
// zooms, instead of requesting a nonexistent deeper one. That's exactly
// what `maximumLevel` is for, and it's the standard way to handle any
// imagery source with a hard native resolution ceiling.
//
// Honest trade-off: at true close/street-level zoom, this will look like
// a soft, blurry color wash rather than crisp radar detail, since a 150km
// tile is being stretched, not resampled from finer data that doesn't
// exist. But it stays visibly present and never shows an error tile.
//
// If genuinely crisp close-zoom radar matters later: LibreWXR
// (github.com/JoshuaKimsey/LibreWXR) is a self-hostable, drop-in-API-
// compatible replacement that restores full pre-restriction resolution -
// swapping to it later would just mean changing RAINVIEWER_INDEX/tile
// URL below to your own hosted instance, no other code changes needed.

const RAINVIEWER_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';
const REFRESH_MS = 10 * 60_000;
const RAINVIEWER_MAX_ZOOM = 7; // confirmed via RainViewer's own docs

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
