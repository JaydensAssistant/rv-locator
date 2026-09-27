# RV Locator 1.1.5

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

Copy `extras/templater-metabind/newRv.js` into Templater user scripts and use `extras/templater-metabind/New RV.md` as the template. It prompts for householder name and Address, renames to `{Name} on {Street}`, seeds Met / Last Spoke / Last Attempted, and starts Visits and Successful Visits at 1, then runs `rv-locator:geocode-current-note`. The top of the note is a bold two-line quote strip: Hubs, then Address with a 🗺️ link to `https://www.google.com/maps/search/?api=1&query=<urlencoded address>`. Geocode writes `Map Link` from the stored Address (coordinates stay on `Location` only). A street with no city gets the note’s City added to that search query only. Equal-size Home / Not home buttons sit under that strip and above a divider. The collapsed `> [!rv]-` dashboard starts on the next line. The `###` stamp follows Taken immediately, then one blank line and the Attempt Log. Home does not repeat a `##` or `###` stamp that is already there. Settings can refresh these extras from the pinned tag `v1.1.5` (not a moving branch). Existing files are skipped unless overwrite is checked. `cssclass: rv-dashboard` keeps the phone from scrolling sideways. See `extras/templater-metabind/NEW-RV-GEOCODE.md`.

## Verify

```bash
shasum -a 256 main.js styles.css manifest.json
# main.js       1bd41366d41a9ba0245832806886ecbb004c2ae1d56d49a99a45ebdc8e2a4dad
# styles.css    943f87078ea70f316a81d5cad82ca0623401efbb9792b0825cd987cc6e33a5bc
# manifest.json 148bdc553725130f600a1e5c262c23979d3375635a686f43882c20180590b6ed
```

## Attribution

Geocoding uses Geoapify (OpenStreetMap data). Addresses are sent to Geoapify. Powered by Geoapify.
