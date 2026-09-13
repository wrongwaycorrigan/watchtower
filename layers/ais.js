// AIS vessel tracking — aisstream.io, a free worldwide AIS relay over a
// WebSocket. Needs a free API key in config.js (window.AISSTREAM_API_KEY),
// same pattern as the Cesium Ion token.
//
// Vessels are assembled from two message types that arrive independently:
// PositionReport (lat/lon/course/speed, frequent) and ShipStaticData
// (name/callsign, rare). Entities are upserted by MMSI so a name that
// arrives after the first position still gets attached to the right ship.
// A vessel not heard from in STALE_MS is pruned — the bbox filter on the
// server means a ship that leaves the area simply stops sending, it's
// never told to us explicitly.

const AIS_WS_URL = 'wss://stream.aisstream.io/v0/stream';
const RECONNECT_DELAY_MS = 5000;
const STALE_MS = 10 * 60_000;
const PRUNE_INTERVAL_MS = 2 * 60_000;

// Tokyo Bay plus the Uraga Channel entrance.
const BBOX = { minLat: 35.15, maxLat: 35.75, minLon: 139.6, maxLon: 140.15 };

function shipIconDataUrl() {
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 24;
  const ctx = canvas.getContext('2d');
  ctx.translate(12, 12);
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(6, 7);
  ctx.lineTo(0, 4);
  ctx.lineTo(-6, 7);
  ctx.closePath();
  ctx.fillStyle = '#4fc3f7';
  ctx.fill();
  return canvas.toDataURL();
}
const ICON = shipIconDataUrl();

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
  const description = describeVessel(mmsi, v);

  if (v.entity) {
    v.entity.position = position;
    v.entity.billboard.rotation = Cesium.Math.toRadians(-headingDeg);
    v.entity.label.text = label;
    v.entity.description = description;
  } else {
    v.entity = _dataSource.entities.add({
      position,
      billboard: {
        image: ICON,
        width: 18,
        height: 18,
        rotation: Cesium.Math.toRadians(-headingDeg),
        alignedAxis: Cesium.Cartesian3.ZERO,
        scaleByDistance: new Cesium.NearFarScalar(5_000, 1.0, 100_000, 0.4),
      },
      label: {
        text: label,
        font: '700 10px Nunito, sans-serif',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
        backgroundPadding: new Cesium.Cartesian2(4, 2),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(5_000, 1.0, 100_000, 0.4),
      },
      description,
    });
  }
}

function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
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
    if (!sd?.Name) return;
    upsertVessel(mmsi, { name: sd.Name.trim() });
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
    _socket.send(JSON.stringify({
      APIKey: window.AISSTREAM_API_KEY,
      BoundingBoxes: [[[BBOX.minLat, BBOX.minLon], [BBOX.maxLat, BBOX.maxLon]]],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    }));
  };
  _socket.onmessage = (e) => handleMessage(e.data);
  _socket.onerror = (e) => console.warn('[AIS] socket error:', e);
  _socket.onclose = () => {
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
