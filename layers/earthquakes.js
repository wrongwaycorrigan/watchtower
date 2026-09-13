// Earthquakes — USGS, last 24h, M2.5+.
// Colored by depth (shallow=red, intermediate=orange, deep=yellow), sized by
// magnitude. Click a disc for details via Cesium's built-in infoBox — no
// custom card needed for a minimal build.

const API_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const REFRESH_MS = 60_000;

let _dataSource = null;
let _timer = null;

function depthColor(depthKm) {
  if (depthKm < 70) return Cesium.Color.RED;
  if (depthKm < 300) return Cesium.Color.ORANGE;
  return Cesium.Color.YELLOW;
}

async function refresh() {
  if (!_dataSource) return;
  try {
    const res = await fetch(API_URL);
    if (!res.ok) return;
    const geojson = await res.json();

    _dataSource.entities.removeAll();
    for (const feature of geojson.features) {
      const [lon, lat, depthKm] = feature.geometry.coordinates;
      const mag = feature.properties.mag;
      if (mag == null || mag < 2.5) continue;

      const color = depthColor(depthKm || 0);
      const radiusM = Math.pow(2, mag) * 1000;
      const timeStr = new Date(feature.properties.time).toLocaleString();

      _dataSource.entities.add({
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
    console.warn('[Earthquakes] fetch failed:', e);
  }
}

export function init(viewer) {
  _dataSource = new Cesium.CustomDataSource('earthquakes');
  _dataSource.show = false;
  viewer.dataSources.add(_dataSource);
}

export function setEnabled(enabled) {
  if (!_dataSource) return;
  _dataSource.show = enabled;
  if (enabled) {
    refresh();
    if (!_timer) _timer = setInterval(refresh, REFRESH_MS);
  } else if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
