// Radio — internet radio stations (radio-browser.info), WSPR beacon
// propagation (wspr.live), and static amateur repeater sites, combined
// under one button/panel/count. Same pattern as disasters.js: independent
// sources under one layer, each keeping its own module.
//
// radio-browser.info is served from community mirrors (de1, nl1, at1, ...);
// swap the host below if de1 is ever down.

import * as wspr from './wspr.js';
import * as repeaters from './repeaters.js';

const STATIONS_URL = 'https://de1.api.radio-browser.info/json/stations/bycountry/Japan?hidebroken=true&order=clickcount&reverse=true&limit=40';
const STATION_ALTITUDE_M = 2500; // visual raise only, not a real antenna height

let _viewer = null;
let _dataSource = null;
let _audio = null;
let _selectedHandler = null;
let _loaded = false;

function stationIconDataUrl() {
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 24;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(12, 12, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#c97bff';
  ctx.fill();
  ctx.fillStyle = '#1a0b24';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\u266B', 12, 13); // ♫
  return canvas.toDataURL();
}
const ICON = stationIconDataUrl();

async function loadStations() {
  if (_loaded) return;
  _loaded = true;
  try {
    const res = await fetch(STATIONS_URL);
    if (!res.ok) return;
    const stations = await res.json();

    for (const s of stations) {
      const lat = s.geo_lat;
      const lon = s.geo_long;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue; // most entries lack geo data — skip
      if (!s.url_resolved) continue;

      const groundPos = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
      const raisedPos = Cesium.Cartesian3.fromDegrees(lon, lat, STATION_ALTITUDE_M);

      _dataSource.entities.add({
        polyline: {
          positions: [groundPos, raisedPos],
          width: 1,
          material: Cesium.Color.WHITE.withAlpha(0.4),
        },
      });

      _dataSource.entities.add({
        position: raisedPos,
        billboard: {
          image: ICON,
          width: 22,
          height: 22,
          scaleByDistance: new Cesium.NearFarScalar(20_000, 1.0, 300_000, 0.5),
        },
        label: {
          text: s.name.length > 18 ? `${s.name.slice(0, 17)}…` : s.name,
          font: '700 11px Nunito, sans-serif',
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
          backgroundPadding: new Cesium.Cartesian2(5, 3),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(20_000, 1.0, 300_000, 0.5),
        },
        description: `<b>${s.name}</b><br>${s.tags || ''}`,
        properties: { streamUrl: s.url_resolved, name: s.name },
      });
    }
  } catch (e) {
    console.warn('[Radio] station fetch failed:', e);
  }
}

function play(streamUrl, name) {
  _audio.src = streamUrl;
  _audio.play().catch((e) => console.warn('[Radio] playback failed:', e));
  console.log(`[Radio] Now playing: ${name}`);
}

export function init(viewer) {
  _viewer = viewer;
  _dataSource = new Cesium.CustomDataSource('radio');
  _dataSource.show = false;
  viewer.dataSources.add(_dataSource);

  _audio = document.createElement('audio');
  _audio.volume = 0.7;
  document.body.appendChild(_audio);

  _selectedHandler = () => {
    const entity = viewer.selectedEntity;
    const streamUrl = entity?.properties?.streamUrl?.getValue();
    if (streamUrl) play(streamUrl, entity.properties.name.getValue());
  };
  viewer.selectedEntityChanged.addEventListener(_selectedHandler);

  wspr.init(viewer);
  repeaters.init(viewer);
}

export function setVolume(volume01) {
  if (_audio) _audio.volume = Math.min(1, Math.max(0, volume01));
}

export function toggleMute() {
  if (!_audio) return false;
  _audio.muted = !_audio.muted;
  return _audio.muted;
}

export function isMuted() {
  return _audio ? _audio.muted : false;
}

export function getCount() {
  const stationCount = _dataSource
    ? _dataSource.entities.values.filter((e) => e.properties?.streamUrl).length
    : 0;
  return stationCount + wspr.getCount() + repeaters.getCount();
}

export function setEnabled(enabled) {
  _dataSource.show = enabled;
  if (enabled) {
    loadStations();
  } else {
    _audio.pause();
    _audio.removeAttribute('src');
  }
  wspr.setEnabled(enabled);
  repeaters.setEnabled(enabled);
}
