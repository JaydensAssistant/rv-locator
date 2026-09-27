# RV Locator 1.1.4

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

Copy `extras/templater-metabind/newRv.js` into Templater user scripts and use `extras/templater-metabind/New RV.md` as the template. It prompts for householder name and Address, renames to `{Name} on {Street}`, seeds Met / Last Spoke / Last Attempted, and starts Visits and Successful Visits at 1, then runs `rv-locator:geocode-current-note`. The top of the note is a bold two-line quote strip: Hubs, then Address with a 🗺️ link to `https://www.google.com/maps/search/?api=1&query=<urlencoded address>`. Geocode writes that same URL into the `Map Link` property from the stored Address (coordinates stay on `Location` only). Equal-size Home / Not home buttons sit under that strip and above a divider. The collapsed `> [!rv]-` dashboard is under the divider. One Glancable `### Wed, 2pm — Sep 9, 2026` heading sits above a blank notes line and a collapsed Attempt Log that already has that success bullet. Home does not repeat a `##` or `###` stamp that is already there. `cssclass: rv-dashboard` keeps the phone from scrolling sideways. See `extras/templater-metabind/NEW-RV-GEOCODE.md`.

## Verify

```bash
shasum -a 256 main.js styles.css manifest.json
# main.js     23b723c93026c8d2d46dae3ccd042379bf1e24f28bfe46d7a04bfa2b4d90b40c
# styles.css  80d3bb2ca936eb03a2ef2b975d1fbc2f63a3ffccc8303c11889bb33e7a934bb9
# manifest.json a4464257ed02c0e2908387c26fa19147ee59301a0f57d55fc4678e5233d885d9
```

## Attribution

Geocoding uses Geoapify (OpenStreetMap data). Addresses are sent to Geoapify. Powered by Geoapify.
