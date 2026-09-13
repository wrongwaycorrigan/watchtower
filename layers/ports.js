// Tokyo Bay Ports — port terminals and tide stations are static; NDBC
// weather buoys are the one live piece, discovered once from NOAA's
// station list, with readings fetched lazily on click.
//
// Port terminal coordinates are approximate placements, not survey-grade.
// Tide station coordinates come from TidesAtlas's database.

const NDBC_ACTIVE_STATIONS_URL = 'https://www.ndbc.noaa.gov/activestations.xml';
const NDBC_REALTIME_BASE = 'https://www.ndbc.noaa.gov/data/realtime2';
// Covers Japan and Korea in one box.
const NDBC_BBOX = { minLat: 24, maxLat: 46, minLon: 122, maxLon: 146 };

const PORT_COLOR = Cesium.Color.fromCssColorString('#1e88a8'); // deep maritime teal
const TIDE_STATION_COLOR = Cesium.Color.fromCssColorString('#5ec8e0'); // lighter blue, distinct from port terminals
const BUOY_COLOR = Cesium.Color.fromCssColorString('#5a7d9a'); // muted steel blue, distinct from both of the above

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
let _buoysDiscovered = false;
let _selectedHandler = null;

// NDBC realtime2 format: header line, units line, then data rows.
function parseNdbcObservation(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 3) return null;
  const headers = lines[0].replace(/^#/, '').trim().split(/\s+/);
  const values = lines[2].trim().split(/\s+/); // row 2 = most recent observation
  const obs = {};
  headers.forEach((h, i) => {
    const v = values[i];
    obs[h] = v === 'MM' || v === undefined ? null : v; // NDBC uses "MM" for missing values
  });
  return obs;
}

function formatBuoyDescription(name, obs) {
  if (!obs) return `<b>${name}</b><br>No recent observation available.`;
  const rows = [
    ['Wind speed', obs.WSPD, 'm/s'],
    ['Wave height', obs.WVHT, 'm'],
    ['Sea temp', obs.WTMP, '°C'],
    ['Air temp', obs.ATMP, '°C'],
    ['Pressure', obs.PRES, 'hPa'],
  ].filter(([, v]) => v != null).map(([label, v, unit]) => `${label}: ${v} ${unit}`).join('<br>');
  return `<b>${name}</b> (NDBC buoy)<br>${rows || 'No recent readings.'}`;
}

async function loadBuoyObservation(entity, stationId, name) {
  entity.description = 'Loading observation...';
  try {
    const url = `${NDBC_REALTIME_BASE}/${stationId}.txt`;
    console.log('[Ports/NDBC] requesting:', url);
    const res = await fetch(url);
    console.log('[Ports/NDBC] response status:', res.status);
    if (!res.ok) {
      entity.description = `<b>${name}</b><br>Could not load observation (status ${res.status}).`;
      return;
    }
    const text = await res.text();
    const obs = parseNdbcObservation(text);
    entity.description = formatBuoyDescription(name, obs);
  } catch (e) {
    console.error('[Ports/NDBC] fetch failed (check the Network tab - could be CORS):', e);
    entity.description = `<b>${name}</b><br>Could not load observation (network error).`;
  }
}

async function discoverBuoys() {
  if (_buoysDiscovered) return;
  _buoysDiscovered = true;

  try {
    console.log('[Ports/NDBC] requesting station list:', NDBC_ACTIVE_STATIONS_URL);
    const res = await fetch(NDBC_ACTIVE_STATIONS_URL);
    console.log('[Ports/NDBC] station list response status:', res.status);
    if (!res.ok) return;
    const xmlText = await res.text();
    const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
    const stations = Array.from(xml.getElementsByTagName('station'));
    console.log('[Ports/NDBC] total stations in list:', stations.length);

    let matched = 0;
    for (const s of stations) {
      const lat = parseFloat(s.getAttribute('lat'));
      const lon = parseFloat(s.getAttribute('lon'));
      const id = s.getAttribute('id');
      const name = s.getAttribute('name') || id;
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !id) continue;
      if (lat < NDBC_BBOX.minLat || lat > NDBC_BBOX.maxLat || lon < NDBC_BBOX.minLon || lon > NDBC_BBOX.maxLon) continue;

      matched += 1;
      const entity = _dataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        point: { pixelSize: 7, color: BUOY_COLOR, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
        description: `<b>${name}</b><br>Click to load current observation.`,
      });
      entity.properties = new Cesium.PropertyBag({ isNdbcBuoy: true, stationId: id, stationName: name });
    }
    console.log('[Ports/NDBC] stations matched in Japan/Korea bbox:', matched);
  } catch (e) {
    console.error('[Ports/NDBC] station list fetch failed (check the Network tab - could be CORS):', e);
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
    _dataSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat),
      point: { pixelSize: 8, color: TIDE_STATION_COLOR, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
      description: `<b>${s.name} tide station</b><br>Position via TidesAtlas.`,
    });
  }

  _selectedHandler = () => {
    const entity = viewer.selectedEntity;
    if (!entity?.properties?.isNdbcBuoy) return;
    const stationId = entity.properties.stationId.getValue();
    const stationName = entity.properties.stationName.getValue();
    loadBuoyObservation(entity, stationId, stationName);
  };
  viewer.selectedEntityChanged.addEventListener(_selectedHandler);
}

export function setEnabled(enabled) {
  _dataSource.show = enabled;
  if (enabled) discoverBuoys();
}

export function getCount() {
  return _dataSource.entities.values.length;
}
