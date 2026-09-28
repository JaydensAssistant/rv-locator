# RV Locator 1.2.2

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

Copy `extras/templater-metabind/newRv.js` into Templater’s user scripts folder and use `99 New RV.md` from Templater’s template folder (the file in this repo is `extras/templater-metabind/New RV.md`). It prompts for householder name, Address, then one companion. The companion is a suggester of recent Met With / Taken names plus a free-text name. That name is appended to Taken only. Met With stays blank. Skipping it leaves both blank. Priority defaults to 3 (`defaultNewRvPriority`, 0–5). The note renames to `{Name} on {Street}`, seeds Met / Last Spoke / Last Attempted, and starts Visits and Successful Visits at 1, then runs `rv-locator:geocode-current-note`. The top of the note is a bold two-line quote strip: Hubs, then Address with a 🗺️ link to `https://www.google.com/maps/search/?api=1&query=<urlencoded address>`. Geocode writes `Map Link` from the stored Address (coordinates stay on `Location` only) and always writes `City`. A street with no city gets the note’s City added to that search query only. An empty City-property setting only skips an optional alias. Equal-size Home / Not home buttons sit under that strip and above a divider. The collapsed `> [!rv]-` dashboard starts on the next line. The `###` stamp follows Taken, then two blank lines (padding for notes) and the Attempt Log. Home asks for the companion again and appends that name to Taken. It does not change Met With. A second Home in the same rounded hour still inserts another `###` stamp, bumps the counts, and appends another Attempt Log line. Not home does the same for its own counts and log line, and it does not ask. Skip leaves Met With and Taken unchanged. `linkCompanionsToNotes` (default off) stores `[[Note Name]]` on Taken when a note name or alias matches, and plain text when it is off or no note matches. The same helper is used by the Home button and by Meta Bind / Templater `rvLog.js`. It does not write Met With. Settings can refresh templates and scripts from the pinned tag `v1.2.2` (not a moving branch, and not retargeted to `v1.2.1`, `v1.2.0`, or `v1.1.5`) into Templater’s `templates_folder` and `user_scripts_folder`. That download works after the `v1.2.2` tag exists; this plugin does not create the tag. Documentation and the CSS snippet are not part of that download. Existing files are skipped unless overwrite is checked. Template file names are basenames only. Changing New RV, Home log, or Not home log in settings renames that note inside Templater’s template folder. An existing file at the new name is left in place and the setting stays. Home and Not home renames also update `templateFile:` paths that still use the old name. A half-typed name does not rename. The + button uses the saved New RV name. The setup wizard asks for home counties first (the same Home counties list; skip leaves that list unchanged, and an empty list still always confirms a geocode match), then checks that Templater and Meta Bind are enabled. It does not open again on its own after it has been closed. Settings can open it again, including the home-region step. Opening Glancable or a Nearby view shows one notice while setup is unfinished (wizard never closed, or the Geoapify key, Templater, Meta Bind, folders, or template files are still missing). Empty home counties do not keep that notice up after the wizard is closed. Don't remind me again stores `setupIncompleteNudgeDismissed` and does not mark setup complete. The notice stops once setup is complete. It does not install or enable them, and it does not turn on the Meta Bind JS Engine or Templater system commands. `cssclass: rv-dashboard` keeps the phone from scrolling sideways. See `extras/templater-metabind/NEW-RV-GEOCODE.md`.

## Verify

```bash
shasum -a 256 main.js styles.css manifest.json
# main.js       0c1a8a07a1ee7cd11f124cff6f1f8860dc0cd097254891dbda5ef5188fd2a3b3
# styles.css    297f4aea57459d6e94146f54b1f42fe2f6e9ce10eb26d3e156f797ecf5c2def4
# manifest.json bc4fe874c3fbcb4bcad74e9d9c5312bdc201c30e9eff7533ab81d0d536083c4f
```

## Attribution

Geocoding uses Geoapify (OpenStreetMap data). Addresses are sent to Geoapify. Powered by Geoapify.
