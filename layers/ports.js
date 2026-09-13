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
// there's no verified static data to fall back to.
//
// BUOYS below is real static data instead: the one NOWPHAS (Nationwide
// Ocean Wave information network for Ports and HArbourS, run by MLIT's
// Port and Harbour Bureau) wave-observation station that actually falls
// inside Tokyo Bay itself, out of that network's full 2024 nationwide
// station list (77 stations total, most nowhere near the bay - nearby
// coastline like Shimoda/Shimizu/Kashima isn't the bay itself, so it's
// excluded rather than padding the count). Moored buoys like this hold a
// fixed charted position (small swing radius around the anchor aside),
// so a static point is a faithful representation, not a shortcut.
//
// Port terminal coordinates are approximate placements, not survey-grade.
// Tide station coordinates come from TidesAtlas's database.
//
// Tide stations are rendered as a little Kenney rowboat (not a flat dot)
// tinted by live sea surface temperature - blue when cold, orange when
// warm - and sized up a bit for rougher wave conditions, via the Open-
// Meteo Marine API (marine-api.open-meteo.com, separate from the regular
// forecast API weather.js/weatherBadge.js already use successfully).
// That subdomain is unreachable from this dev environment same as
// several other APIs this session, so the request shape below is built
// from Open-Meteo's well-established, consistent API convention rather
// than a directly confirmed response - diagnostic logging is left in on
// purpose, same as wspr.js/traffic.js for their own first real tests.

import * as ais from './ais.js';

const PORT_COLOR = Cesium.Color.fromCssColorString('#1e88a8'); // deep maritime teal
const BUOY_MODEL = '/ship-models/buoy.glb';
const BOAT_MODEL = '/ship-models/boat-row-small.glb';

const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const MARINE_REFRESH_MS = 20 * 60_000; // sea temp/wave conditions change slowly
const TEMP_MIN_C = 10; // typical Tokyo Bay winter low
const TEMP_MAX_C = 28; // typical Tokyo Bay summer high
const COLD_COLOR = Cesium.Color.fromCssColorString('#4fc3f7');
const WARM_COLOR = Cesium.Color.fromCssColorString('#ff7043');

function tempColor(tempC) {
  if (!Number.isFinite(tempC)) return Cesium.Color.WHITE;
  const t = Cesium.Math.clamp((tempC - TEMP_MIN_C) / (TEMP_MAX_C - TEMP_MIN_C), 0, 1);
  return Cesium.Color.lerp(COLD_COLOR, WARM_COLOR, t, new Cesium.Color());
}

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

// NOWPHAS 2024 nationwide station list, code 217 - the one entry actually
// inside Tokyo Bay. Coordinates converted from the source's DMS format
// (35°18'13"N 139°44'50"E).
const BUOYS = [
  {
    name: 'Daini Kaiho Wave Buoy',
    code: 217,
    lat: 35.303611,
    lon: 139.747222,
    description: 'NOWPHAS wave-observation buoy near the Daini Kaiho ("Second Sea Fort") artificial island in the Uraga Channel. Ultrasonic Doppler wave meter, water depth 31.8m, observing since March 2006.',
  },
];

let _dataSource = null;
let _marineTimer = null;
const _tideEntities = []; // [{ station, entity }]

async function refreshStationConditions(station, entity) {
  try {
    const params = new URLSearchParams({
      latitude: station.lat,
      longitude: station.lon,
      current: 'wave_height,wave_period,wave_direction,sea_surface_temperature',
      timezone: 'auto',
    });
    const res = await fetch(`${MARINE_URL}?${params}`);
    console.log('[Ports/Marine] response status:', res.status, station.name);
    if (!res.ok) return;
    const data = await res.json();
    console.log('[Ports/Marine] DIAGNOSTIC - raw current for', station.name, ':', data.current);
    const c = data.current;
    if (!c) return;

    const tempC = c.sea_surface_temperature;
    const waveM = c.wave_height;
    entity.model.color = tempColor(tempC);
    entity.model.minimumPixelSize = 18 + Math.min(Number(waveM) || 0, 2) * 6; // rougher seas -> bigger boat
    entity.label.text = Number.isFinite(tempC) ? `${tempC.toFixed(1)}°C` : station.name;
    entity.description = `
      <b>${station.name} tide station</b><br>
      Sea temp: ${Number.isFinite(tempC) ? `${tempC.toFixed(1)}°C` : 'unknown'}<br>
      Wave height: ${Number.isFinite(waveM) ? `${waveM.toFixed(1)}m` : 'unknown'}<br>
      Position via TidesAtlas, conditions via Open-Meteo Marine.
    `;
  } catch (e) {
    console.error('[Ports/Marine] fetch failed (check the Network tab - could be CORS):', e);
  }
}

function refreshAllMarineConditions() {
  for (const { station, entity } of _tideEntities) {
    refreshStationConditions(station, entity);
  }
}

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
    const entity = _dataSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat),
      model: {
        uri: BOAT_MODEL,
        minimumPixelSize: 18,
        maximumScale: 60,
        color: Cesium.Color.WHITE,
        colorBlendMode: Cesium.ColorBlendMode.MIX,
        colorBlendAmount: 0.55,
      },
      label: {
        text: s.name,
        font: '700 11px Nunito, sans-serif',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
        backgroundPadding: new Cesium.Cartesian2(5, 3),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      description: `<b>${s.name} tide station</b><br>Position via TidesAtlas.`,
    });
    _tideEntities.push({ station: s, entity });
  }

  for (const b of BUOYS) {
    _dataSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(b.lon, b.lat),
      model: {
        uri: BUOY_MODEL,
        minimumPixelSize: 20,
        maximumScale: 40,
      },
      label: {
        text: b.name,
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
        <b>${b.name}</b> (NOWPHAS code ${b.code})<br>
        ${b.description}<br>
        <a href="https://nowphas.mlit.go.jp/" target="_blank" rel="noopener noreferrer">NOWPHAS</a>
      `,
    });
  }

  ais.init(viewer);
}

export function setEnabled(enabled) {
  _dataSource.show = enabled;
  if (enabled) {
    refreshAllMarineConditions();
    if (!_marineTimer) _marineTimer = setInterval(refreshAllMarineConditions, MARINE_REFRESH_MS);
  } else if (_marineTimer) {
    clearInterval(_marineTimer);
    _marineTimer = null;
  }
  ais.setEnabled(enabled);
}

export function getCount() {
  return _dataSource.entities.values.length + ais.getCount();
}
