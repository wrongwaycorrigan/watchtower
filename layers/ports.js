// Tokyo Bay Ports — port terminals and tide stations are static; live ship
// traffic (AIS) is its own module, called into here the same way radio.js
// pulls in wspr.js.
//
// This used to also plot NDBC weather buoys, discovered live from NOAA's
// station list. Dropped that: neither activestations.xml nor the
// per-buoy realtime2 endpoint sends Access-Control-Allow-Origin, so both
// fetches were always going to be blocked by the browser - confirmed by
// testing directly, not just the earlier "untested" guess. NDBC's own
// coverage near Japan/Korea was never actually confirmed either, so
// there's no verified static data to fall back to - see the tide-station
// precedent below for what "static, but for real" looks like when there
// is one.
//
// Port terminal coordinates are approximate placements, not survey-grade.
// Tide station coordinates come from TidesAtlas's database.

import * as ais from './ais.js';

const PORT_COLOR = Cesium.Color.fromCssColorString('#1e88a8'); // deep maritime teal
const TIDE_STATION_COLOR = Cesium.Color.fromCssColorString('#5ec8e0'); // lighter blue, distinct from port terminals

const PORTS = [
  {
    name: 'Oi Container Terminal',
    port: 'Port of Tokyo',
    lat: 35.610,
    lon: 139.771,
    description: 'One of the Port of Tokyo\'s largest container terminals. Tokyo Port overall has roughly 205 berths across the bay, run by the Tokyo Port Authority.',
  },
  {
    name: 'Shinagawa Pier (Shinagawa Futo)',
    port: 'Port of Tokyo',
    lat: 35.609,
    lon: 139.751,
    description: 'The oldest container terminal in Japan, opened in 1967. 3 berths, ~333m of quay.',
  },
  {
    name: 'Tokyo International Cruise Terminal',
    port: 'Port of Tokyo',
    lat: 35.637,
    lon: 139.793,
    description: 'Opened 2020 at Ariake, replacing the older Harumi passenger terminal. One berth (~430m quay), with long-term plans for a second.',
  },
  {
    name: 'Honmoku Pier',
    port: 'Port of Yokohama',
    lat: 35.427,
    lon: 139.677,
    description: "Yokohama's core port facility - 24 berths, including 14 dedicated container berths.",
  },
  {
    name: 'Osanbashi Pier',
    port: 'Port of Yokohama',
    lat: 35.451,
    lon: 139.649,
    description: "Yokohama's passenger/cruise terminal, with customs, immigration, and quarantine facilities for international arrivals.",
  },
  {
    name: 'Daikoku Pier',
    port: 'Port of Yokohama',
    lat: 35.456,
    lon: 139.674,
    description: 'Known for fresh produce imports, notably bananas.',
  },
  {
    name: 'Kawasaki Port',
    port: 'Port of Kawasaki',
    lat: 35.520,
    lon: 139.760,
    description: 'Industrial port on the Keihin industrial belt, handling heavy industry and energy cargo.',
  },
  {
    name: 'Chiba Port',
    port: 'Port of Chiba',
    lat: 35.605,
    lon: 140.106,
    description: 'One of Japan\'s largest ports by cargo tonnage, anchoring the Keiyo industrial zone.',
  },
];

const TIDE_STATIONS = [
  { name: 'Tokyo', slug: 'tokyo', lat: 35.648617, lon: 139.77 },
  { name: 'Yokohama', slug: 'yokohama', lat: 35.466667, lon: 139.633333 },
  { name: 'Yokohamashinko', slug: 'yokohamashinko', lat: 35.454167, lon: 139.644167 },
  { name: 'Kawasaki', slug: 'kawasaki', lat: 35.5, lon: 139.766667 },
  { name: 'Chiba', slug: 'chiba', lat: 35.56805, lon: 140.04555 },
];

let _dataSource = null;

export function init(viewer) {
  _dataSource = new Cesium.CustomDataSource('ports');
  _dataSource.show = false;
  viewer.dataSources.add(_dataSource);

  for (const p of PORTS) {
    _dataSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
      point: { pixelSize: 10, color: PORT_COLOR, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
      description: `<b>${p.name}</b> — ${p.port}<br>${p.description}`,
    });
  }

  for (const s of TIDE_STATIONS) {
    _dataSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat),
      point: { pixelSize: 8, color: TIDE_STATION_COLOR, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
      description: `<b>${s.name} tide station</b><br>Position via TidesAtlas.`,
    });
  }

  ais.init(viewer);
}

export function setEnabled(enabled) {
  _dataSource.show = enabled;
  ais.setEnabled(enabled);
}

export function getCount() {
  return _dataSource.entities.values.length + ais.getCount();
}
