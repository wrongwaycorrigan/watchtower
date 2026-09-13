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

function modelForType(type) {
  if (type === 30) return 'boat-fishing-small.glb';
  if (type === 36) return 'boat-sail-a.glb';
  if (type === 37) return 'boat-speed-a.glb';
  if (type === 52) return 'boat-tug-a.glb';
  if (type >= 60 && type <= 69) return 'ship-ocean-liner-small.glb';
  if (type >= 70 && type <= 79) return 'ship-cargo-a.glb';
  if (type >= 80 && type <= 89) return 'ship-cargo-b.glb'; // no dedicated tanker model in this kit
  return 'ship-small.glb'; // unknown or not yet received
}

let _dataSource = null;
let _socket = null;
let _reconnectTimer = null;
let _pruneTimer = null;
let _enabled = false;
const _vessels = new Map(); // mmsi -> { lat, lon, cog, sog, name, entity, lastUpdate }

function describeVessel(mmsi, v) {
  const sog = Number.isFinite(v.sog) ? `${v.sog.toFixed(1)} kn` : 'unknown';
  return `<b>${v.name || 'Unknown vessel'}</b><br>MMSI: ${mmsi}<br>Speed: ${sog}`;
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

  const label = v.name || `MMSI ${mmsi}`;
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
        maximumScale: 150,
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
      },
      description,
    });
  }
}

// Diagnostic counters/logging: the message schema below was sourced from
// third-party mirrors of aisstream.io's docs (their own docs site is
// unreachable from this dev environment), so it's unconfirmed against a
// real feed. Logging the first few raw messages in full, plus running
// counts, makes a field-name mismatch immediately visible in the console
// instead of failing silently - same diagnostic-logging approach already
// used in traffic.js and wspr.js for their own first real tests.
let _rawMessageCount = 0;
let _parsedVesselCount = 0;
const RAW_LOG_LIMIT = 5;

function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    console.warn('[AIS] could not parse message as JSON:', e, raw);
    return;
  }

  _rawMessageCount += 1;
  if (_rawMessageCount <= RAW_LOG_LIMIT) {
    console.log(`[AIS] raw message #${_rawMessageCount}:`, msg);
  }

  const mmsi = msg.MetaData?.MMSI;
  if (mmsi == null) {
    if (_rawMessageCount <= RAW_LOG_LIMIT) {
      console.warn('[AIS] message had no MetaData.MMSI, skipping:', msg);
    }
    return;
  }

  if (msg.MessageType === 'PositionReport') {
    const pr = msg.Message?.PositionReport;
    if (!pr) return;
    upsertVessel(mmsi, { lat: pr.Latitude, lon: pr.Longitude, cog: pr.Cog, sog: pr.Sog });
    _parsedVesselCount += 1;
  } else if (msg.MessageType === 'ShipStaticData') {
    const sd = msg.Message?.ShipStaticData;
    if (!sd) return;
    const updates = {};
    if (sd.Name) updates.name = sd.Name.trim();
    if (Number.isFinite(sd.Type)) updates.shipType = sd.Type;
    if (Object.keys(updates).length) upsertVessel(mmsi, updates);
  }

  if (_rawMessageCount % 50 === 0) {
    console.log(`[AIS] ${_rawMessageCount} messages received, ${_vessels.size} vessels tracked`);
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
