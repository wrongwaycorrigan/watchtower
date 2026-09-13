// Air traffic — local tar1090/readsb feed, no third party involved.
//
// CORS still applies even on your own LAN. If you get a CORS error, add
// an Access-Control-Allow-Origin header in your receiver's lighttpd
// config. Also: https:// pages can't fetch plain http:// (mixed content).
//
// tar1090 serves an "aircraft" array; checking "ac" too as a fallback for
// adsb.fi/ADSB Exchange-style installs.
//
// Aircraft whose ICAO type (tar1090's `t` field) matches a key below get a
// real 3D model from srcejon/sdrangel-3d-models (gitignored — see
// LICENSE-NOTICES.md). Everything else falls back to a flat triangle.
// Model choice per type is arbitrary (first livery alphabetically in that
// type's folder) — it doesn't match the real operating airline.

const TAR1090_URL = 'http://192.168.1.14/tar1090/data/aircraft.json';
const REFRESH_MS = 5_000; // local network, no rate limit to respect
const MODELS_BASE = '/sdrangel-3d-models';

// type -> relative path
const AIRCRAFT_MODELS = {
  A310: 'BB_Airbus_png/A310/A310_AIC.gltf',
  A318: 'BB_Airbus_png/A318/A318_AFR.gltf',
  A319: 'BB_Airbus_png/A319/A319_AAF.gltf',
  A320: 'BB_Airbus_png/A320/A320_AAF.gltf',
  A321: 'BB_Airbus_png/A321/A321_AAR.gltf',
  A332: 'BB_Airbus_png/A332/A332_AAL.gltf',
  A333: 'BB_Airbus_png/A333/A333_AAL.gltf',
  A342: 'BB_Airbus_png/A342/A342_AUA.gltf',
  A343: 'BB_Airbus_png/A343/A343_ACA.gltf',
  A345: 'BB_Airbus_png/A345/A345_AHY.gltf',
  A346: 'BB_Airbus_png/A346/A346_CES.gltf',
  A388: 'BB_Airbus_png/A388/A388_AAR.gltf',
  B717: 'BB_Boeing_png/B717/B717_BLF.gltf',
  B733: 'BB_Boeing_png/B733/B733_AUL.gltf',
  B734: 'BB_Boeing_png/B734/B734_ARR.gltf',
  B737: 'BB_Boeing_png/B737/B737_ARG.gltf',
  B738: 'BB_Boeing_png/B738/B738_AAL.gltf',
  B739: 'BB_Boeing_png/B739/B739_ASA.gltf',
  B744: 'BB_Boeing_png/B744/B744_AAA.gltf',
  B74F: 'BB_Boeing_png/B74F/B74F_AAR.gltf',
  B752: 'BB_Boeing_png/B752/B752_AAL.gltf',
  B763: 'BB_Boeing_png/B763/B763_AAL.gltf',
  B772: 'BB_Boeing_png/B772/B772_AAL.gltf',
  B773: 'BB_Boeing_png/B773/B773_ANA.gltf',
  B77L: 'BB_Boeing_png/B77L/B77L_ACA.gltf',
  B77W: 'BB_Boeing_png/B77W/B77W_AAL.gltf',
  B788: 'BB_Boeing_png/B788/B788_AAL.gltf',
  BE20: 'BB_GA_png/BE20/BE20_BGT.gltf',
  C150: 'BB_GA_png/C150/C150_r2.gltf',
  C172: 'BB_GA_png/C172/C172_r2.gltf',
  C421: 'BB_GA_png/C421/C421_BGM.gltf',
  H25B: 'BB_GA_png/H25B/H25B_N228TM.gltf',
  LJ45: 'BB_GA_png/LJ45/LJ45_B-3988.gltf',
  B462: 'BB_Jets_png/B462/B462_BAE.gltf',
  B463: 'BB_Jets_png/B463/B463_AZI.gltf',
  CRJ2: 'BB_Jets_png/CRJ2/CRJ2_ACA.gltf',
  CRJ7: 'BB_Jets_png/CRJ7/CRJ7_AFR.gltf',
  CRJ9: 'BB_Jets_png/CRJ9/CRJ9_ANE.gltf',
  CRJX: 'BB_Jets_png/CRJX/CRJX_ANE.gltf',
  DC10: 'BB_Jets_png/DC10/DC10_FDX.gltf',
  E135: 'BB_Jets_png/E135/E135_BMI.gltf',
  E145: 'BB_Jets_png/E145/E145_AMX.gltf',
  E170: 'BB_Jets_png/E170/E170_AFR.gltf',
  E190: 'BB_Jets_png/E190/E190_ACA.gltf',
  E195: 'BB_Jets_png/E195/E195_AEA.gltf',
  F100: 'BB_Jets_png/F100/F100_AAL.gltf',
  F28: 'BB_Jets_png/F28/F28_ARG.gltf',
  F70: 'BB_Jets_png/F70/F70_AUA.gltf',
  MD11: 'BB_Jets_png/MD11/MD11_CWC.gltf',
  MD83: 'BB_Jets_png/MD83/MD83_AAL.gltf',
  MD90: 'BB_Jets_png/MD90/MD90_DAL.gltf',
  AT42: 'BB_Props_png/AT42/AT42_BCI.gltf',
  AT72: 'BB_Props_png/AT72/AT72_AIZ.gltf',
  D328: 'BB_Props_png/D328/D328_AUL.gltf',
  DH8D: 'BB_Props_png/DH8D/DH8D_ACA.gltf',
  F50: 'BB_Props_png/F50/F50_AVA.gltf',
  JS41: 'BB_Props_png/JS41/JS41_AAL.gltf',
  L410: 'BB_Props_png/L410/L410_BCV.gltf',
  SB20: 'BB_Props_png/SB20/SB20_BLF.gltf',
  SF34: 'BB_Props_png/SF34/SF34_ATK.gltf',
};

let _dataSource = null;
let _timer = null;

function planeIconDataUrl(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 24;
  const ctx = canvas.getContext('2d');
  ctx.translate(12, 12);
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(8, 10);
  ctx.lineTo(0, 5);
  ctx.lineTo(-8, 10);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  return canvas.toDataURL();
}

const ICON_LOW = planeIconDataUrl('#4fd6ff');   // below ~10,000 ft
const ICON_HIGH = planeIconDataUrl('#ffd24f');  // above ~10,000 ft

async function refresh() {
  if (!_dataSource?.show) return;

  try {
    const res = await fetch(TAR1090_URL);
    console.log('[Traffic] response status:', res.status);
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '(could not read body)');
      console.warn('[Traffic] non-OK response, body was:', bodyText);
      return;
    }
    const data = await res.json();
    const aircraft = data.aircraft ?? data.ac ?? []; // "ac" fallback for other installs
    console.log('[Traffic] aircraft in response:', aircraft.length);
    if (aircraft.length) {
      console.log('[Traffic] DIAGNOSTIC - raw fields of first aircraft:', aircraft[0]);
      console.log('[Traffic] DIAGNOSTIC - type field (t) values seen:', aircraft.map((a) => a.t));
    }

    _dataSource.entities.removeAll();
    let modelMatches = 0;
    for (const ac of aircraft) {
      if (!Number.isFinite(ac.lat) || !Number.isFinite(ac.lon)) continue;
      const altFt = typeof ac.alt_baro === 'number' ? ac.alt_baro : 0; // alt_baro can be "ground"
      const altM = altFt * 0.3048;
      const headingDeg = Number.isFinite(ac.track) ? ac.track : 0;
      const callsign = (ac.flight || ac.hex || '').trim();
      const position = Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, Math.max(altM, 50));

      const modelPath = ac.t ? AIRCRAFT_MODELS[ac.t] : undefined;
      const description = `<b>${callsign || 'Unknown'}</b>${ac.t ? ` (${ac.t})` : ''}<br>Altitude: ${Math.round(altFt)} ft`;

      if (modelPath) {
        modelMatches += 1;
        const hpr = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(headingDeg), 0, 0);
        _dataSource.entities.add({
          position,
          orientation: Cesium.Transforms.headingPitchRollQuaternion(position, hpr),
          model: {
            uri: `${MODELS_BASE}/${modelPath}`,
            minimumPixelSize: 24,
            maximumScale: 300,
          },
          description,
        });
      } else {
        _dataSource.entities.add({
          position,
          billboard: {
            image: altFt > 10_000 ? ICON_HIGH : ICON_LOW,
            width: 20,
            height: 20,
            rotation: Cesium.Math.toRadians(-headingDeg),
            alignedAxis: Cesium.Cartesian3.ZERO,
            scaleByDistance: new Cesium.NearFarScalar(20_000, 1.0, 300_000, 0.4),
          },
          description,
        });
      }
    }
    console.log('[Traffic] rendered with real 3D models:', modelMatches, '/ total:', aircraft.length);
  } catch (e) {
    console.error('[Traffic] fetch failed (check the Network tab - could be CORS, could be the receiver being offline):', e);
  }
}

export function init(viewer) {
  _dataSource = new Cesium.CustomDataSource('traffic');
  _dataSource.show = false;
  viewer.dataSources.add(_dataSource);
}

export function getCount() {
  return _dataSource ? _dataSource.entities.values.length : 0;
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
