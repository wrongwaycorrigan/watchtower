// AIS vessel tracking — aisstream.io, a free worldwide AIS relay over a
// WebSocket. Needs a free API key in config.js (window.AISSTREAM_API_KEY),
// same pattern as the Cesium Ion token.
//
// Vessels are assembled from two message types that arrive independently:
// PositionReport (lat/lon/course/speed, frequent) and ShipStaticData
// (name/callsign/ship type, rare). Entities are upserted by MMSI so data
// that arrives after the first position still gets attached to the right
// ship. A vessel not heard from in STALE_MS is pruned — the bbox filter
// on the server means a ship that leaves the area simply stops sending,
// it's never told to us explicitly.
//
// Rendered with real 3D models (see ship-models/NOTICE.txt for source and
// license), picked by the ShipStaticData `Type` field (ITU-R M.1371 ship
// and cargo type codes) once it arrives. Falls back to a generic hull
// until then, since most position reports show up before the static data
// does.

const AIS_WS_URL = 'wss://stream.aisstream.io/v0/stream';
const RECONNECT_DELAY_MS = 5000;
const STALE_MS = 10 * 60_000;
const PRUNE_INTERVAL_MS = 2 * 60_000;
const MODELS_BASE = '/ship-models';

// Tokyo Bay plus the Uraga Channel entrance.
const BBOX = { minLat: 35.15, maxLat: 35.75, minLon: 139.6, maxLon: 140.15 };

// MMSI's first three digits are the Maritime Identification Digits (MID),
// an ITU-assigned country code - see itu.int's MID table. Not exhaustive:
// covers flag states likely to actually show up in Tokyo Bay traffic
// (Japanese coastal/fishing vessels, plus the usual flag-of-convenience
// registries big cargo ships carry). An unmapped MID just shows no flag.
const MID_COUNTRY = {
  431: 'JP', 432: 'JP',
  440: 'KR', 441: 'KR',
  445: 'KP',
  412: 'CN', 413: 'CN', 414: 'CN',
  477: 'HK', 453: 'MO', 416: 'TW',
  548: 'PH', 574: 'VN', 567: 'TH', 533: 'MY', 525: 'ID', 419: 'IN',
  563: 'SG', 564: 'SG', 565: 'SG', 566: 'SG',
  503: 'AU', 512: 'NZ',
  273: 'RU',
  338: 'US', 366: 'US', 367: 'US', 368: 'US', 369: 'US',
  316: 'CA',
  351: 'PA', 352: 'PA', 353: 'PA', 354: 'PA', 355: 'PA', 356: 'PA', 357: 'PA', // flag of convenience
  636: 'LR', 637: 'LR', // flag of convenience
  538: 'MH', // flag of convenience
  308: 'BS', 309: 'BS', 311: 'BS', // flag of convenience
  215: 'MT', 248: 'MT', 249: 'MT', 256: 'MT', // flag of convenience
  209: 'CY', 210: 'CY', 212: 'CY',
  232: 'GB', 233: 'GB', 234: 'GB', 235: 'GB',
  226: 'FR', 227: 'FR', 228: 'FR',
  211: 'DE', 218: 'DE',
  244: 'NL', 245: 'NL', 246: 'NL',
  219: 'DK', 220: 'DK',
  257: 'NO', 258: 'NO', 259: 'NO',
  247: 'IT',
  237: 'GR', 239: 'GR', 240: 'GR', 241: 'GR',
};

function countryForMmsi(mmsi) {
  const mid = Number(String(mmsi).slice(0, 3));
  return MID_COUNTRY[mid] || null;
}

function flagEmoji(countryCode) {
  return [...countryCode].map((c) => String.fromCodePoint(127397 + c.charCodeAt(0))).join('');
}

let _regionNames = null;
function countryName(countryCode) {
  try {
    _regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return _regionNames.of(countryCode) || countryCode;
  } catch (e) {
    return countryCode;
  }
}

function modelForType(type) {
  if (type === 30) return 'boat-fishing-small.glb';
  if (type === 36) return 'boat-sail-a.glb';
  if (type === 37) return 'boat-speed-a.glb';
  if (type === 52) return 'boat-tug-a.glb';
  if (type >= 60 && type <= 69) return 'ship-ocean-liner-small.glb';
  if (type >= 70 && type <= 79) return 'ship-cargo-a.glb';
  if (type >= 80 && type <= 89) return 'ship-cargo-c.glb'; // no dedicated tanker model in this kit - closest hull shape
  return 'ship-cargo-b.glb'; // unknown or not yet received - a plain hull, not ship-small.glb (which despite its name is actually a small sailboat with sail/flag meshes)
}

let _dataSource = null;
let _socket = null;
let _reconnectTimer = null;
let _pruneTimer = null;
let _enabled = false;
const _vessels = new Map(); // mmsi -> { lat, lon, cog, sog, name, entity, lastUpdate }

function describeVessel(mmsi, v) {
  const sog = Number.isFinite(v.sog) ? `${v.sog.toFixed(1)} kn` : 'unknown';
  const country = countryForMmsi(mmsi);
  const flagLine = country ? `<br>Flag: ${flagEmoji(country)} ${countryName(country)}` : '';
  return `<b>${v.name || 'Unknown vessel'}</b><br>MMSI: ${mmsi}<br>Speed: ${sog}${flagLine}`;
}

function upsertVessel(mmsi, updates) {
  let v = _vessels.get(mmsi);
  if (!v) {
    v = { name: null, entity: null };
    _vessels.set(mmsi, v);
  }
  Object.assign(v, updates);
  v.lastUpdate = Date.now();

  if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) return;

  const country = countryForMmsi(mmsi);
  // Cesium labels are drawn into a canvas texture, not real HTML - flag
  // emoji (two combined regional-indicator characters) render unreliably
  // there across platforms, often as nothing at all. A plain country code
  // is font-independent and always shows; the popup below still gets the
  // real flag emoji since that's normal HTML rendering.
  const countryTag = country ? `[${country}] ` : '';
  const label = countryTag + (v.name || `MMSI ${mmsi}`);
  const headingDeg = Number.isFinite(v.cog) ? v.cog : 0;
  const position = Cesium.Cartesian3.fromDegrees(v.lon, v.lat);
  const hpr = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(headingDeg), 0, 0);
  const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr);
  const modelUri = `${MODELS_BASE}/${modelForType(v.shipType)}`;
  const description = describeVessel(mmsi, v);

  if (v.entity) {
    v.entity.position = position;
    v.entity.orientation = orientation;
    v.entity.model.uri = modelUri;
    v.entity.label.text = label;
    v.entity.description = description;
  } else {
    v.entity = _dataSource.entities.add({
      position,
      orientation,
      model: {
        uri: modelUri,
        minimumPixelSize: 24,
        // A low cap here (was 150) fights minimumPixelSize as you zoom in:
        // Cesium scales the model up to hold a minimum on-screen size at a
        // distance, then has to back that boost off as you approach: with
        // a tight ceiling, the falloff outpaces how fast perspective is
        // growing the model, so it visibly shrinks mid-zoom before
        // settling back to true size close up. A generous ceiling (same
        // idea as radiosondes.js's 15000) keeps that transition smooth.
        maximumScale: 3000,
      },
      label: {
        text: label,
        font: '700 10px Nunito, sans-serif',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
        backgroundPadding: new Cesium.Cartesian2(4, 2),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(5_000, 1.0, 100_000, 0.4),
        // Names only show up close - with a boat this small on the map,
        // labels at typical zoomed-out distances are just clutter, and
        // this needs no dock button/toggle to control it.
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 6000.0),
      },
      description,
    });
  }
}

// Message schema confirmed against the real feed (aisstream.io's own docs
// site was unreachable from this dev environment, so this was originally
// built from third-party mirrors) - PositionReport/ShipStaticData parse
// correctly, and SubscriptionConfirmation (no MetaData.MMSI) is expected
// and silently skipped, not an error.
function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    console.warn('[AIS] could not parse message as JSON:', e, raw);
    return;
  }

  const mmsi = msg.MetaData?.MMSI;
  if (mmsi == null) return;

  if (msg.MessageType === 'PositionReport') {
    const pr = msg.Message?.PositionReport;
    if (!pr) return;
    upsertVessel(mmsi, { lat: pr.Latitude, lon: pr.Longitude, cog: pr.Cog, sog: pr.Sog });
  } else if (msg.MessageType === 'ShipStaticData') {
    const sd = msg.Message?.ShipStaticData;
    if (!sd) return;
    const updates = {};
    if (sd.Name) updates.name = sd.Name.trim();
    if (Number.isFinite(sd.Type)) updates.shipType = sd.Type;
    if (Object.keys(updates).length) upsertVessel(mmsi, updates);
  }
}

function pruneStaleVessels() {
  const now = Date.now();
  for (const [mmsi, v] of _vessels) {
    if (now - v.lastUpdate <= STALE_MS) continue;
    if (v.entity) _dataSource.entities.remove(v.entity);
    _vessels.delete(mmsi);
  }
}

function connect() {
  if (!window.AISSTREAM_API_KEY) {
    console.warn('[AIS] window.AISSTREAM_API_KEY not set — vessel tracking disabled. See config.example.js.');
    return;
  }
  if (_socket) return;

  _socket = new WebSocket(AIS_WS_URL);
  _socket.onopen = () => {
    console.log('[AIS] socket open, sending subscription for bbox:', BBOX);
    _socket.send(JSON.stringify({
      APIKey: window.AISSTREAM_API_KEY,
      BoundingBoxes: [[[BBOX.minLat, BBOX.minLon], [BBOX.maxLat, BBOX.maxLon]]],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    }));
  };
  _socket.onmessage = (e) => {
    // aisstream.io sends frames as binary, not text - e.data arrives as a
    // Blob, not a string. Confirmed by testing: JSON.parse(blob) doesn't
    // throw a useful error, it silently stringifies to "[object Blob]"
    // first and fails parsing *that*.
    if (typeof e.data === 'string') {
      handleMessage(e.data);
    } else {
      e.data.text().then(handleMessage).catch((err) => console.warn('[AIS] could not read blob message:', err));
    }
  };
  _socket.onerror = (e) => console.warn('[AIS] socket error:', e);
  _socket.onclose = (e) => {
    console.warn(`[AIS] socket closed (code ${e.code}, reason: "${e.reason}")`);
    _socket = null;
    if (_enabled) _reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
  };
}

function disconnect() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (_socket) {
    _socket.onclose = null; // deliberate close - don't auto-reconnect
    _socket.close();
    _socket = null;
  }
}

export function init(viewer) {
  _dataSource = new Cesium.CustomDataSource('ais');
  _dataSource.show = false;
  viewer.dataSources.add(_dataSource);
}

export function setEnabled(enabled) {
  _enabled = enabled;
  _dataSource.show = enabled;
  if (enabled) {
    connect();
    if (!_pruneTimer) _pruneTimer = setInterval(pruneStaleVessels, PRUNE_INTERVAL_MS);
  } else {
    disconnect();
    if (_pruneTimer) {
      clearInterval(_pruneTimer);
      _pruneTimer = null;
    }
  }
}

export function getCount() {
  return _dataSource ? _dataSource.entities.values.length : 0;
}
