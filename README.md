# RV Locator 1.2.0

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

Copy `extras/templater-metabind/newRv.js` into Templater’s user scripts folder and use `99 New RV.md` from Templater’s template folder (the file in this repo is `extras/templater-metabind/New RV.md`). It prompts for householder name, Address, then one companion. The companion is a suggester of recent Met With / Taken names plus a free-text name. That name is written to Met With and appended to Taken. Skipping it leaves both blank. Priority defaults to 3 (`defaultNewRvPriority`, 0–5). The note renames to `{Name} on {Street}`, seeds Met / Last Spoke / Last Attempted, and starts Visits and Successful Visits at 1, then runs `rv-locator:geocode-current-note`. The top of the note is a bold two-line quote strip: Hubs, then Address with a 🗺️ link to `https://www.google.com/maps/search/?api=1&query=<urlencoded address>`. Geocode writes `Map Link` from the stored Address (coordinates stay on `Location` only) and always writes `City`. A street with no city gets the note’s City added to that search query only. An empty City-property setting only skips an optional alias. Equal-size Home / Not home buttons sit under that strip and above a divider. The collapsed `> [!rv]-` dashboard starts on the next line. The `###` stamp follows Taken, then two blank lines (padding for notes) and the Attempt Log. Home asks for the companion again and does not repeat a `##` or `###` stamp that is already there. Not home does not ask. `linkCompanionsToNotes` (default off) stores `[[Note Name]]` when a note basename matches. Settings can refresh templates and scripts from the pinned tag `v1.2.0` (not a moving branch, and not retargeted to `v1.1.5`) into Templater’s `templates_folder` and `user_scripts_folder`. That download works after the `v1.2.0` tag exists; this plugin does not create the tag. Documentation and the CSS snippet are not part of that download. Existing files are skipped unless overwrite is checked. Template file names are basenames only. The setup wizard checks that Templater and Meta Bind are enabled. It does not install or enable them, and it does not turn on the Meta Bind JS Engine or Templater system commands. `cssclass: rv-dashboard` keeps the phone from scrolling sideways. See `extras/templater-metabind/NEW-RV-GEOCODE.md`.

## Verify

```bash
shasum -a 256 main.js styles.css manifest.json
# main.js       b4ce00b7ec35becce569b067cfd1740f076a68859a0c3d8228a9772b6901ac32
# styles.css    01b4eeb6d6ce8cd574f04addcce67588097a173f129482156ded49c33df852de
# manifest.json 093f36e876f0798394a59f21f8afc9846e35aa9185bdda69be347a0e626cbc25
```

## Attribution

Geocoding uses Geoapify (OpenStreetMap data). Addresses are sent to Geoapify. Powered by Geoapify.
