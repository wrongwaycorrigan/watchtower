# Watchtower

Watchtower is a 3D map of the Tokyo Bay area built on CesiumJS. It renders
satellite imagery, terrain, and Japan's PLATEAU 3D building models, then
overlays several live data layers on top.

## Layers

- 3D Buildings: Japan PLATEAU (MLIT) textured building models
- Radio: streaming radio stations, WSPR propagation data, and curated
  amateur repeater site locations
- Air Traffic: aircraft positions from a local receiver (tar1090)
- Tokyo Bay Ports: curated port and tide station locations, plus live
  ship traffic from aisstream.io (AIS)
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
3. Get a free AIS Stream API key from https://aisstream.io for the Ship
   Traffic layer.
4. Copy the example config file and add your tokens:

   cp config.example.js config.js

   Edit config.js and replace the placeholders with your real tokens.
   config.js is listed in .gitignore, so your tokens are not committed.

5. Serve the directory with any static file server and open index.html
   in a browser. For example:

   python3 -m http.server 8000

## Project layout

- index.html: page structure and styling
- main.js: viewer setup, dock navigation, and panel layout logic
- layers/: one file per data layer, each with an init() and setEnabled()
- config.example.js: template for config.js (not committed)
