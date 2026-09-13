// WSPR beacon propagation — wspr.live, a community-run open mirror of
// WSPRnet spot data with a SQL-queryable HTTP+JSON endpoint. Genuinely
// keyless, unlike the official WSPRnet API (which requires emailing
// their custodian for access).
//
// WSPR (Weak Signal Propagation Reporter) is amateur radio beacon data:
// low-power transmitters send a callsign+grid+power beacon every 2
// minutes, and stations that hear them report the reception. The result
// is a live picture of radio propagation - literally "who can hear whom,
// right now, and how far did that signal travel."
//
// CORS not confirmed for this small volunteer-run research service (same
// caution as Alert-JP earlier) - this is the first real test of it.
// Diagnostic logging left in deliberately so a failure is immediately
// diagnosable rather than another guessing round.
//
// Rendering: a gray polyline from transmitter to receiver for each spot,
// with opacity faded by signal strength (SNR) rather than a color
// gradient or animation - weak decodes are barely visible, strong ones
// stand out clearly. Capped at a modest LIMIT and a 30-minute window to
// keep the entity count reasonable, and polled every 3 minutes - WSPR
// itself only cycles every 2 minutes, and wspr.live's own scrape cadence
// is "every few minutes," so anything faster wouldn't show new data
// anyway.

const WSPR_LIVE_URL = 'https://db1.wspr.live/';
const REFRESH_MS = 3 * 60_000;

// Rough bounding box around greater Tokyo/Kanto.
const BBOX = { minLat: 34, maxLat: 37, minLon: 138, maxLon: 141 };

// SNR (signal-to-noise ratio, dB) is WSPR's core "how well did this
// decode" metric - practically almost always between about -30 (barely
// decodable) and a few dB positive (strong). Rendered as a fixed gray
// (avoids colliding with the traffic layer's gold/cyan plane icons - an
// earlier gold-for-strong-signal version literally matched traffic's
// high-altitude icon color exactly) that fades in and out with signal
// strength, rather than a color gradient or a directional animation.
// TX/RX distinction dropped entirely - not a priority for what this is
// actually being used to see.
const WSPR_GRAY = Cesium.Color.fromCssColorString('#9aa3ad');
const SNR_MIN = -30;
const SNR_MAX = 0;
const SNR_MIN_ALPHA = 0.08; // weakest decodes barely visible
const SNR_MAX_ALPHA = 0.75; // strongest decodes clearly visible, still not opaque

function snrAlpha(snr) {
  if (!Number.isFinite(snr)) return SNR_MIN_ALPHA;
  const clamped = Math.min(SNR_MAX, Math.max(SNR_MIN, snr));
  const t = (clamped - SNR_MIN) / (SNR_MAX - SNR_MIN);
  return SNR_MIN_ALPHA + t * (SNR_MAX_ALPHA - SNR_MIN_ALPHA);
}

function buildQuery() {
  return `
    SELECT tx_sign, tx_lat, tx_lon, rx_sign, rx_lat, rx_lon, band, snr, time
    FROM wspr.rx
    WHERE time > now() - INTERVAL 30 MINUTE
      AND ((tx_lat BETWEEN ${BBOX.minLat} AND ${BBOX.maxLat} AND tx_lon BETWEEN ${BBOX.minLon} AND ${BBOX.maxLon})
        OR (rx_lat BETWEEN ${BBOX.minLat} AND ${BBOX.maxLat} AND rx_lon BETWEEN ${BBOX.minLon} AND ${BBOX.maxLon}))
    ORDER BY time DESC
    LIMIT 50
    FORMAT JSON
  `.trim();
}

let _dataSource = null;
let _timer = null;
let _count = 0;

async function refresh() {
  if (!_dataSource?.show) return;

  const url = `${WSPR_LIVE_URL}?query=${encodeURIComponent(buildQuery())}`;
  try {
    console.log('[WSPR] requesting:', url);
    const res = await fetch(url);
    console.log('[WSPR] response status:', res.status);
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '(could not read body)');
      console.warn('[WSPR] non-OK response, body was:', bodyText);
      return;
    }
    const body = await res.json();
    const rows = body.data ?? [];
    console.log('[WSPR] spots in response:', rows.length);

    _dataSource.entities.removeAll();
    for (const row of rows) {
      if (![row.tx_lat, row.tx_lon, row.rx_lat, row.rx_lon].every(Number.isFinite)) continue;

      const alpha = snrAlpha(row.snr);
      const txPos = Cesium.Cartesian3.fromDegrees(row.tx_lon, row.tx_lat);
      const rxPos = Cesium.Cartesian3.fromDegrees(row.rx_lon, row.rx_lat);

      _dataSource.entities.add({
        polyline: {
          positions: [txPos, rxPos],
          width: 1.5,
          material: WSPR_GRAY.withAlpha(alpha),
          arcType: Cesium.ArcType.GEODESIC,
        },
      });
      _dataSource.entities.add({
        position: txPos,
        point: { pixelSize: 5, color: WSPR_GRAY.withAlpha(alpha), outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
        description: `<b>${row.tx_sign}</b> heard by <b>${row.rx_sign}</b><br>SNR: ${row.snr} dB<br>${row.time}`,
      });
      _dataSource.entities.add({
        position: rxPos,
        point: { pixelSize: 5, color: WSPR_GRAY.withAlpha(alpha), outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
        description: `<b>${row.tx_sign}</b> heard by <b>${row.rx_sign}</b><br>SNR: ${row.snr} dB<br>${row.time}`,
      });
    }
    _count = rows.length;
  } catch (e) {
    console.error('[WSPR] fetch failed (check the Network tab - could be CORS):', e);
  }
}

export function init(viewer) {
  _dataSource = new Cesium.CustomDataSource('wspr');
  _dataSource.show = false;
  viewer.dataSources.add(_dataSource);
}

export function setEnabled(enabled) {
  _dataSource.show = enabled;
  if (enabled) {
    refresh();
    if (!_timer) _timer = setInterval(refresh, REFRESH_MS);
  } else if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

export function getCount() {
  return _count;
}
