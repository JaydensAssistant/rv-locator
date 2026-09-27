# RV Locator 1.1.0

Obsidian plugin: Geoapify geocode for return-visit notes + live Nearby Bases views (Vanilla / Glancable). **Never overwrites `Address`.**

> Note: This first push includes the **built plugin** (`main.js` / `styles.css` / `manifest.json`), install docs, and Templater/Meta Bind visit-log extras. Full TypeScript `src/` is being pushed by the Cursor cloud agent onto the same repo.

## Install (desktop)

Copy `manifest.json`, `main.js`, and `styles.css` into `<vault>/.obsidian/plugins/rv-locator/`, enable the plugin, add a Geoapify key in settings. See `docs/SETUP-REAL-HARDWARE-1.1.0.md`.

## Install (iOS)

Prefer desktop install + vault sync. Details: `docs/SETUP-iOS-1.1.0.md`.

## Verify

```bash
shasum -a 256 main.js
# dead81fc9acc8295987bf25bb5ca8f67af3044b4ed4b1f343f36e254337d6eb1
```

## Attribution

Geocoding uses Geoapify (OpenStreetMap data). Addresses are sent to Geoapify. Powered by Geoapify.
