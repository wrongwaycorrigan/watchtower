# Watchtower

Watchtower is a 3D map of the Tokyo Bay area built on CesiumJS. It renders
satellite imagery, terrain, and Japan's PLATEAU 3D building models, then
overlays several live data layers on top.

## Layers

- 3D Buildings: Japan PLATEAU (MLIT) textured building models
- Radio: streaming radio stations plus WSPR propagation data
- Air Traffic: aircraft positions from a local receiver (tar1090)
- Tokyo Bay Ports: curated port locations (static, no live feed)
- Radiosondes: weather balloon positions from SondeHub
- Weather: precipitation radar from RainViewer
- Disasters: recent earthquakes and volcanic activity

The interface also shows an ambient Tokyo weather badge and a moon phase
badge, and an ISS marker when zoomed out to the full globe view.

## Setup

This project has no build step. It runs directly as static files.

1. Get a Cesium Ion access token from https://ion.cesium.com
2. In your Cesium Ion account, add the Sentinel-2 imagery asset and the
   Japan 3D Buildings asset (asset ID 2602291) to your account.
3. Copy the example config file and add your token:

   cp config.example.js config.js

   Edit config.js and replace the placeholder with your real token.
   config.js is listed in .gitignore, so your token is not committed.

4. Serve the directory with any static file server and open index.html
   in a browser. For example:

   python3 -m http.server 8000

## Project layout

- index.html: page structure and styling
- main.js: viewer setup, dock navigation, and panel layout logic
- layers/: one file per data layer, each with an init() and setEnabled()
- config.example.js: template for config.js (not committed)
