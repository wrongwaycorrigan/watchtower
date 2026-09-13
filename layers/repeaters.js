// Amateur Radio Repeaters — static, curated. Plots well-known elevated
// sites around the Kanto/Tokyo Bay area commonly used for VHF/UHF repeater
// siting. Location only — no frequency, offset, or tone, since that data
// needs to be current and verified to actually use a repeater safely.
// See RepeaterBook or JARL for the real repeater list at each site.

function antennaIconDataUrl() {
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 24;
  const ctx = canvas.getContext('2d');

  ctx.beginPath();
  ctx.arc(12, 12, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#e0995e';
  ctx.fill();

  ctx.strokeStyle = '#3a2416';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';

  ctx.beginPath(); // mast
  ctx.moveTo(12, 17);
  ctx.lineTo(12, 9);
  ctx.stroke();

  ctx.beginPath(); // signal arcs
  ctx.arc(12, 9, 3.2, Math.PI * (-5 / 6), Math.PI * (-1 / 6));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(12, 9, 5.6, Math.PI * (-5 / 6), Math.PI * (-1 / 6));
  ctx.stroke();

  ctx.beginPath(); // top dot
  ctx.arc(12, 9, 1.3, 0, Math.PI * 2);
  ctx.fillStyle = '#3a2416';
  ctx.fill();

  return canvas.toDataURL();
}
const ICON = antennaIconDataUrl();

const SITES = [
  { name: 'Tokyo Tower', lat: 35.6586, lon: 139.7454, note: 'Central Tokyo' },
  { name: 'Tokyo Skytree', lat: 35.7101, lon: 139.8107, note: 'Central Tokyo' },
  { name: 'Mount Takao', lat: 35.6247, lon: 139.2432, note: 'Western Tokyo highpoint' },
  { name: 'Mount Tsukuba', lat: 36.2253, lon: 140.1046, note: 'Ibaraki highpoint' },
  { name: 'Mount Nokogiri', lat: 35.1508, lon: 139.8564, note: 'Chiba, across the bay' },
  { name: 'Mount Oyama', lat: 35.4508, lon: 139.2430, note: 'Kanagawa highpoint' },
  { name: 'Yokohama Landmark Tower', lat: 35.4546, lon: 139.6317, note: 'Yokohama' },
];

let _dataSource = null;

export function init(viewer) {
  _dataSource = new Cesium.CustomDataSource('repeaters');
  _dataSource.show = false;
  viewer.dataSources.add(_dataSource);

  for (const s of SITES) {
    _dataSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat),
      billboard: {
        image: ICON,
        width: 22,
        height: 22,
        scaleByDistance: new Cesium.NearFarScalar(20_000, 1.0, 300_000, 0.5),
      },
      label: {
        text: s.name,
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
      description: `
        <b>${s.name}</b> — ${s.note}<br>
        Elevated site commonly used for amateur VHF/UHF repeater siting.<br>
        For the actual repeater list, frequency, and tone at this site, see
        <a href="https://www.repeaterbook.com/row_repeaters/index2.php?state_id=JP" target="_blank" rel="noopener noreferrer">RepeaterBook</a>
        or <a href="https://www.jarl.org/English/" target="_blank" rel="noopener noreferrer">JARL</a>.
      `,
    });
  }
}

export function setEnabled(enabled) {
  _dataSource.show = enabled;
}

export function getCount() {
  return _dataSource ? _dataSource.entities.values.length : 0;
}
