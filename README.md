# RV Locator 1.2.12

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

Copy `extras/templater-metabind/newRv.js` into Templater’s user scripts folder and use `99 New RV.md` from Templater’s template folder (the file in this repo is `extras/templater-metabind/New RV.md`). It prompts for householder name, Address, then one companion. The companion is a suggester of recent Met With / Taken names plus a free-text name. That name is appended to Taken only. Met With stays blank. Skipping it leaves both blank. Priority defaults to 4 (`defaultNewRvPriority`, 0–5). The note renames to `{Name} on {Street}`, seeds Met / Last Spoke / Last Attempted, and starts Visits and Successful Visits at 1, then runs `rv-locator:geocode-current-note`. The top of the note is an expanded `> [!quote]+ RV Dashboard` callout: Hubs, then Address with a 🗺️ link to `https://www.google.com/maps/search/?api=1&query=<urlencoded address>`, then the Home / Not home buttons, then a collapsed `> [!rv]- Quick Facts` callout. CSS left-aligns the Hub and Address controls and hides callout icons on notes with `rv-dashboard`. Geocode writes `Map Link` from the stored Address (coordinates stay on `Location` only) and always writes `City`. A street with no city gets the note’s City added to that search query only. An empty City-property setting only skips an optional alias. A rule, `### Visit Notes:`, the `#####` stamp, the notes line, and another rule come next. Return Suggestions is its own callout (purple `example` until the accent setting rewrites it). Attempt Log is nested inside that callout, with the seven-day table above the bullets. All-weekdays cells are `0/0` or the real count. Em dashes stay only in May-go-out-only mode. Home asks for the companion again and appends that name to Taken. It does not change Met With. A second Home in the same rounded hour still inserts another `#####` stamp, bumps the counts, and appends another Attempt Log line. Not home does the same for its own counts and log line, and it does not ask. Skip leaves Met With and Taken unchanged. Companions are stored as plain text on Taken. A matching note name does not turn that name into a wikilink, and an older `linkCompanionsToNotes` value in plugin data is ignored. The Home button and Meta Bind / Templater `rvLog.js` use the same plain-text write. It does not write Met With. A wikilink already stored on Taken or Met With is still quoted if Obsidian flattens it. Settings can refresh templates and scripts from the pinned tag `v1.2.12` (not a moving branch, and not retargeted to `v1.2.11`, `v1.2.10`, `v1.2.9`, `v1.2.8`, `v1.2.7`, `v1.2.6`, `v1.2.5`, `v1.2.4`, `v1.2.3`, `v1.2.2`, `v1.2.1`, `v1.2.0`, or `v1.1.5`) into Templater’s `templates_folder` and `user_scripts_folder`. That download works after the `v1.2.12` tag exists; this plugin does not create the tag. Documentation and the CSS snippet are not part of that download. Existing files are skipped unless overwrite is checked. Template file names are basenames only. Changing New RV, Home log, or Not home log in settings renames that note inside Templater’s template folder. An existing file at the new name is left in place and the setting stays. Home and Not home renames also update `templateFile:` paths that still use the old name. A half-typed name does not rename. The + button uses the saved New RV name. The setup wizard asks for home counties first (the same Home counties list; skip leaves that list unchanged, and an empty list still always confirms a geocode match), then checks that Templater and Meta Bind are enabled. It does not open again on its own after it has been closed. Settings can open it again, including the home-region step. Opening Glancable or a Nearby view shows one notice while a required setup gap is still open. The notice uses the same required rows as setup wizard page 2, including the Geoapify API key. A blank Templater folder is not a gap when the template or script files are already in the fallback folder (`Templates/` or `Scripts/`). Empty home counties are not a required gap. Once those required gaps are empty, the notice stays down even if `setupWizardCompleted` was still false, and that flag is saved as complete. Closing the wizard with Done also saves the flag. Don't remind me again stores `setupIncompleteNudgeDismissed` and does not mark setup complete while a gap remains. The notice stops once setup is complete. It does not install or enable them, and it does not turn on the Meta Bind JS Engine or Templater system commands. `cssclass: rv-dashboard` keeps the phone from scrolling sideways. See `extras/templater-metabind/NEW-RV-GEOCODE.md`.

## Verify

```bash
shasum -a 256 main.js styles.css manifest.json
# main.js       be1a3534cf6525ed5c618b4113e587d822b4419fb192be217d91ea15d0372641
# styles.css    bfd29df9678802b039f73a2be133c9e8d563c385845cf8741c2aa900893c6cb9
# manifest.json 4748980aa201eeb4a9bbcca1b1b3e52e0de2a6669cdd6f625f4c15cb58b7bfac
```

## Attribution

Geocoding uses Geoapify (OpenStreetMap data). Addresses are sent to Geoapify. Powered by Geoapify.
