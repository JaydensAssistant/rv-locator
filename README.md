# RV Locator 1.1.1

Obsidian plugin: Geoapify geocode for return-visit notes + live Nearby Bases views (Vanilla / Glancable). **Never overwrites `Address`.**

`Location` is a YAML list of quoted strings, not bare numbers:

```yaml
Location:
  - "29.0313846"
  - "-82.5209372"
```

Auto-pick (no confirm modal) happens only when Geoapify `rank.confidence` is **1.00**, the hit is in a configured home-base county, and it is the **only** result in that home region. An empty home-county list always asks. A missing confidence never auto-picks. Street-token matching is not used.

Distance stays in memory only.

## Install (desktop)

Copy `manifest.json`, `main.js`, and `styles.css` into `<vault>/.obsidian/plugins/rv-locator/`, enable the plugin, add a Geoapify key in settings. See `docs/SETUP-REAL-HARDWARE-1.1.0.md`.

## Install (iOS)

Prefer desktop install + vault sync. Details: `docs/SETUP-iOS-1.1.0.md`.

## New RV note (Templater)

`extras/templater-metabind/geocodeNewRv.js` prompts for Address when it is missing, then runs command `rv-locator:geocode-current-note`. Meta Bind is not required. See `extras/templater-metabind/NEW-RV-GEOCODE.md`.

## Verify

```bash
shasum -a 256 main.js
# bcb03e33eda9517050eb08568b8d7d164c287530942abc16a8a6d7a87c4fafb8
```

## Attribution

Geocoding uses Geoapify (OpenStreetMap data). Addresses are sent to Geoapify. Powered by Geoapify.
