import * as disasters from './layers/disasters.js';
import * as weather from './layers/weather.js';
import * as radiosondes from './layers/radiosondes.js';
import * as radio from './layers/radio.js';
import * as traffic from './layers/traffic.js';
import * as ports from './layers/ports.js';
import * as weatherBadge from './layers/weatherBadge.js';
import * as moonBadge from './layers/moonBadge.js';
import * as iss from './layers/iss.js';

// Cesium is a global from the CDN <script> tag in index.html, not an
// ES module import — that's intentional, matching the original file's
// no-build-step approach. Only *this* code uses import/export, between
// its own files.

const TOKYO_VIEW = {
  destination: Cesium.Cartesian3.fromDegrees(139.65, 35.4, 8000),
  orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-20) },
};

const GLOBE_VIEW = {
  // Same longitude as Tokyo, pulled straight back so the toggle reads as
  // "zoom out to see the whole Earth" rather than jumping somewhere new.
  destination: Cesium.Cartesian3.fromDegrees(139.65, 20, 20_000_000),
  orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
};

// See the comment in index.html above the main.js <script> tag — set
// window.CESIUM_ION_TOKEN before this file loads rather than hardcoding a
// token in source. Japan 3D Buildings is an Ion-hosted asset, so this is
// required for the buildings layer to load at all, not just optional.
if (window.CESIUM_ION_TOKEN) {
  Cesium.Ion.defaultAccessToken = window.CESIUM_ION_TOKEN;
} else {
  console.warn('[main] window.CESIUM_ION_TOKEN not set — Japan 3D Buildings will fail to load. See the comment in index.html.');
}

// One entry per dock button whose data-target maps to a real layer.
// 'buildingsBtn' is handled separately below since it's not a data-fetching
// layer, just a Japan 3D Buildings primitive toggle.
const LAYERS = {
  'disaster-panel': disasters,
  'weather-panel': weather,
  'sonde-panel': radiosondes,
  'radio-panel': radio,
  'traffic-panel': traffic,
  'ports-panel': ports,
};

let buildingTileset = null;

async function initCesium() {
  const terrainProvider = await Cesium.createWorldTerrainAsync();
  const viewer = new Cesium.Viewer('cesiumContainer', {
    terrainProvider,
    baseLayer: false, // replaced right below with Sentinel-2 instead of Cesium's Bing Maps default
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    infoBox: true, // left on deliberately — native click-for-details, no custom card needed
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    fullscreenButton: false,
  });

  // Sentinel-2 (Ion asset 3954) instead of the Bing Maps default - cloudless
  // global satellite imagery, 10m resolution. Requires this asset to be
  // added to your Ion account first (Asset Depot -> search "Sentinel-2" ->
  // Add to my assets), same one-time step as the Japan 3D Buildings asset.
  const sentinel2 = await Cesium.IonImageryProvider.fromAssetId(3954);
  viewer.imageryLayers.addImageryProvider(sentinel2);

  const logo = document.getElementById('cesium-logo');
  if (logo) logo.style.display = 'none';

  viewer.camera.flyTo(TOKYO_VIEW);

  console.log('Cesium viewer initialized successfully');

  // Every real layer gets set up once, hidden, then toggled by its dock button.
  disasters.init(viewer);
  weather.init(viewer);
  radiosondes.init(viewer);
  radio.init(viewer);
  traffic.init(viewer);
  ports.init(viewer);
  weatherBadge.init();
  iss.init(viewer);

  // === Panel stacking ===
  // Tracks which panels are currently open, in the order they were opened,
  // and stacks them by REAL measured height (offsetHeight), not a fixed
  // assumed height per panel - panels like Disasters have a variable-length
  // recent-alerts list that can grow taller than any fixed guess, which is
  // exactly what caused the overlap.
  const openPanels = [];
  const PANEL_TOP_BASE = 24; // matches the .control-panel base `top` in CSS
  const PANEL_GAP = 16;

  function relayoutPanels() {
    let top = PANEL_TOP_BASE;
    for (const id of openPanels) {
      const panel = document.getElementById(id);
      if (!panel) continue;
      panel.style.top = `${top}px`;
      top += panel.offsetHeight + PANEL_GAP;
    }
  }

  function setPanelOpen(panelId, isOpen) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    panel.classList.toggle('hidden', !isOpen);

    const idx = openPanels.indexOf(panelId);
    if (isOpen && idx === -1) openPanels.push(panelId);
    if (!isOpen && idx !== -1) openPanels.splice(idx, 1);

    relayoutPanels();
  }

  // === Live counts ===
  // Cheap to poll (just reading array/collection lengths, no network
  // calls) — updates whatever's currently visible every couple seconds so
  // the number reflects each layer's own refresh cycle promptly.
  setInterval(() => {
    for (const [panelId, layer] of Object.entries(LAYERS)) {
      const panel = document.getElementById(panelId);
      if (!panel || panel.classList.contains('hidden')) continue;

      if (typeof layer.getCount === 'function') {
        const countEl = document.getElementById(panelId.replace('-panel', '-count'));
        if (countEl) countEl.textContent = layer.getCount();
      }

      if (typeof layer.getRecentAlerts === 'function') {
        const listEl = document.getElementById(panelId.replace('-panel', '-recent'));
        if (listEl) {
          const items = layer.getRecentAlerts();
          const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
          listEl.innerHTML = items.length
            ? items.map((text) => `<li title="${escapeHtml(text)}">${escapeHtml(text)}</li>`).join('')
            : '<li>No recent alerts</li>';
        }
      }
    }
    // Content above (recent-alerts list length especially) can change
    // height without any panel being opened/closed - re-measure every
    // tick rather than only on open/close, or panels below a growing one
    // would drift out of sync exactly like the overlap in the screenshot.
    relayoutPanels();
  }, 2000);

  // === Dock Navigation ===

  let isGlobeView = false;
  document.getElementById('globeBtn').addEventListener('click', function () {
    isGlobeView = !isGlobeView;
    this.classList.toggle('active', isGlobeView);
    viewer.camera.flyTo(isGlobeView ? GLOBE_VIEW : TOKYO_VIEW);
    iss.setEnabled(isGlobeView); // ISS only appears zoomed out - that's the only view where its real altitude reads as "in the sky" rather than an arbitrary dot
  });

  document.getElementById('buildingsBtn').addEventListener('click', async function () {
    const btn = this;
    const isOn = btn.classList.toggle('active');
    btn.classList.toggle('disabled', !isOn);
    setPanelOpen('buildings-layer', isOn);
    if (isOn) {
      // Japan 3D Buildings (Cesium Ion asset 2602291) - derived from
      // Japan's MLIT PLATEAU 3D City Model, with real textures in many
      // areas, unlike OSM Buildings' generic gray extrusions. No color
      // override here on purpose - the whole point of switching is the
      // real texture detail, so we let it show rather than flattening it.
      buildingTileset = await Cesium.Cesium3DTileset.fromIonAssetId(2602291);
      viewer.scene.primitives.add(buildingTileset);
    } else if (buildingTileset) {
      viewer.scene.primitives.remove(buildingTileset);
      buildingTileset = null;
    }
  });

  // Generic wiring for every real data layer — reads the panel id straight
  // off data-target instead of (incorrectly) assuming it matches the
  // button's own id, which is the bug the original file had.
  document.querySelectorAll('.dock-toggle').forEach((btn) => {
    const panelId = btn.dataset.target;
    const layer = LAYERS[panelId];
    if (!layer) return; // buildingsBtn is handled above, not in LAYERS

    btn.addEventListener('click', () => {
      const isOn = btn.classList.toggle('active');
      btn.classList.toggle('disabled', !isOn);

      setPanelOpen(panelId, isOn);

      // Radio's volume control is a separate floating element (bottom
      // right), not part of the info panel — show/hide it in step.
      if (panelId === 'radio-panel') {
        document.getElementById('volume-control')?.classList.toggle('hidden', !isOn);
      }

      layer.setEnabled(isOn);
    });
  });

  document.getElementById('volume-slider').addEventListener('input', (e) => {
    radio.setVolume(Number(e.target.value) / 100);
  });
}

// Decoupled from initCesium() entirely - this doesn't touch the viewer at
// all, and shouldn't be blockable by anything Cesium-related failing
// partway through that long async chain (imagery, terrain, buildings...).
moonBadge.init();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { initCesium().catch(console.error); });
} else {
  initCesium().catch(console.error);
}
