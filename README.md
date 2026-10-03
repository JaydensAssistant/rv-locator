# RV Locator 1.3.5

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

Copy `extras/templater-metabind/newRv.js` into Templater’s user scripts folder and use `99 New RV.md` from Templater’s template folder (the file in this repo is `extras/templater-metabind/New RV.md`). The + button asks Man or Woman, an optional name, the address, a Met companion, and a priority in one dialog. Running the template without that dialog still asks. A blank name titles the note Man on Street or Woman on Street. The companion is a suggester of recent Met With / Taken names plus a free-text name. That name is Met With (who was there when first meeting this householder) and the first Taken entry. Skipping it leaves both blank. Priority defaults to 4 (`defaultNewRvPriority`, 0–5). The note renames to `{Name} on {Street}`, seeds Met / Last Spoke / Last Attempted, and starts Visits and Successful Visits at 1, then runs `rv-locator:geocode-current-note`. The top of the note is a `> [!quote] RV Dashboard` callout with no fold mark, so it cannot be collapsed: Hubs, then Address with a 🗺️ link to `https://www.google.com/maps/search/?api=1&query=<urlencoded address>`, then the Home, Not home, Log past visit, and Archive buttons (icons on one line, `door-open`, `door-closed`, `rotate-ccw-clock`, and `archive`, named by a tooltip on hover or a long press, colored from the accent in four equal steps darker), then a collapsed `> [!rv]- Quick Facts` callout. CSS lays the dashboard out as one column: the Hub item and Address box share one width, the plugin draws the 🗺️ link as a map-pin button the size of the Hub plus button, directly under it, and Quick Facts and Attempt Log end at that same right edge. It darkens only the Address box, Hub items and Hub plus button, and hides callout icons on notes with `rv-dashboard`. Geocode writes `Map Link` from the stored Address (coordinates stay on `Location` only) and always writes `City`. A street with no city gets the note’s City added to that search query only. An empty City-property setting only skips an optional alias. A rule, `### Visit Notes:`, the `#####` stamp with its age (`Today`, `1 day ago`, `20 days ago`), a Meta Bind `INPUT[textArea:sVisit1Notes]` box for that visit's notes, and another rule come next. The frontmatter is followed by one empty line before RV Dashboard. RV notes open in Reading view, where the notes boxes stay editable. The age is recomputed on screen whenever a note is opened; the file is not rewritten for it. Return Suggestions is its own callout. With Automatic color it follows the accent, and an accent change recolors it on every RV note. Attempt Log is nested inside that callout, with the seven-day table above the bullets. All-weekdays cells are `0/0` or the real count. Em dashes stay only in May-go-out-only mode. Home asks for the companion again and appends that name to Taken only. Met With is never changed after create. Each Home adds a `#####` stamp and the next `sVisitNNotes` box. A second Home in the same rounded hour still inserts another `#####` stamp, bumps the counts, and appends another Attempt Log line. Not home does the same for its own counts and log line, and it does not ask. Skip leaves Met With and Taken unchanged. Companions are stored as plain text on Taken. A matching note name does not turn that name into a wikilink, and an older `linkCompanionsToNotes` value in plugin data is ignored. The Home button and Meta Bind / Templater `rvLog.js` use the same plain-text write. It does not write Met With. A wikilink already stored on Taken or Met With is still quoted if Obsidian flattens it. Settings can refresh templates and scripts from the pinned tag `v1.3.5` (not a moving branch, and not retargeted to `v1.3.3`, `v1.3.2`, `v1.3.1`, `v1.3.0`, `v1.2.12`, `v1.2.11`, `v1.2.10`, `v1.2.9`, `v1.2.8`, `v1.2.7`, `v1.2.6`, `v1.2.5`, `v1.2.4`, `v1.2.3`, `v1.2.2`, `v1.2.1`, `v1.2.0`, or `v1.1.5`) into Templater’s `templates_folder` and `user_scripts_folder`. That download works after the `v1.3.5` tag exists; this plugin does not create the tag. Documentation and the CSS snippet are not part of that download. Existing files are skipped unless overwrite is checked. Template file names are basenames only. Changing New RV, Home log, or Not home log in settings renames that note inside Templater’s template folder. An existing file at the new name is left in place and the setting stays. Home and Not home renames also update `templateFile:` paths that still use the old name. A half-typed name does not rename. The + button uses the saved New RV name. The setup wizard asks for home counties first (the same Home counties list; skip leaves that list unchanged, and an empty list still always confirms a geocode match), then urgency colors, then checks that Templater and Meta Bind are enabled. It does not open again on its own after it has been closed. Settings can open it again, including the home-region step. Opening Glancable or a Nearby view shows one notice while a required setup gap is still open. The notice uses the same required rows as setup wizard page 3, including the Geoapify API key. A blank Templater folder is not a gap when the template or script files are already in the fallback folder (`Templates/` or `Scripts/`). Empty home counties are not a required gap. Once those required gaps are empty, the notice stays down even if `setupWizardCompleted` was still false, and that flag is saved as complete. Closing the wizard with Done also saves the flag. Don't remind me again stores `setupIncompleteNudgeDismissed` and does not mark setup complete while a gap remains. The notice stops once setup is complete. It does not install or enable them, and it does not turn on the Meta Bind JS Engine or Templater system commands. `cssclass: rv-dashboard` keeps the phone from scrolling sideways. See `extras/templater-metabind/NEW-RV-GEOCODE.md`.

## Visits

- **Log past visit** (in-note button, priority badge, or command) asks Home or Not home, the day, the approximate hour, and for a Home who was taken. The `#####` stamp and the Attempt Log line go where they belong by time, and Visits, Successful Visits, Last Attempted, Last Spoke, and Taken are updated. A time later than now is refused.
- Every `#####` stamp and every Attempt Log line has an ellipsis (Reading view) with **Edit visit** and **Delete visit**. Delete removes the stamp, its notes box and notes, the log line, and what that visit added to the counts, dates, and Taken. Met and Met With are never changed. The command *Edit or delete a visit* does the same from a list, including in Live Preview.
- Home bullets record the companion (`— success with Devin`), so a delete or edit can take that name back out of Taken. A name stays on Taken while another visit records it or it is Met With.
- **Archive** (in-note button, priority badge, or command) sets Priority to 0 after a confirmation.
- After Home or a past Home is logged, the note opens (from the card) and the caret is put at the end of the new notes box. On iOS the keyboard may not open, because the focus does not come straight from a tap.
- Visit notes boxes are one line tall when empty, grow while typing up to five lines, then scroll. Each open refits every box to its text.

## Look

- **Urgency colors** (Settings → Urgency, and the setup wizard) pick a palette for Nearby cards: Traffic light (default), Pastel traffic light, Pastel purple, Pastel green, Pastel blue, Pastel pink, Color-blind safe, Sunset, or Theme accent. A strip beside the dropdown previews the four levels. Each level also has its own color picker, and changing one switches to Custom.
- **RV note layout** (Settings → Everyday):
  - **Short daypart names** writes Mor, Aft, and Eve in the Attempt Log table. It is on by default.
  - **Attempt Log width** is Automatic, Full width, or Dashboard column. Automatic is full width when the digest table has days as columns.
  - **Center RV Dashboard**, **Center visit notes**, and **Center Return Suggestions** each center their titles and content.
- On an Attempt Log line, only the calendar date is small. The weekday, the exact time, and the dash stay normal size. On the hour the time stays `4pm`. Log past visit starts at 10am, or at 10am yesterday before 10am.

## Verify

```bash
shasum -a 256 main.js styles.css manifest.json
# main.js       28fe4ee5e9b9f11854e1825e24a9e38af3bfbe0fd9b60c83bacc47e28f0b5cbb
# styles.css    3760fdda66b943d05e9274682dc2e2173f5f0dbf78e00a1e220125cce6e2dd18
# manifest.json 82646b287f2db542d40567e44215a97ba8d441d79ce2a256acea758c6a41b71c
```

## Attribution

Geocoding uses Geoapify (OpenStreetMap data). Addresses are sent to Geoapify. Powered by Geoapify.
