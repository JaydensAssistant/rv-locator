# Changelog

## 1.1.5

`main.js` SHA-256: `e22722a439a316e9bfbabdb6319c2b95cb77c6d2352a9d11255b3e7775229652`

`styles.css` SHA-256: `f8fa6cc778342acdd47a90e8a26e12381495fd7b3961b394e7bfcc0849192ede`

`manifest.json` SHA-256: `148bdc553725130f600a1e5c262c23979d3375635a686f43882c20180590b6ed`

- Map Link still searches Google Maps by address, not lat/lon. When Address has no city, the query appends the note’s City (`123 S Main St` + `Orlando` → `123%20S%20Main%20St%2C%20Orlando`). Address is never rewritten. An address that already names a city stays as stored.
- New RV spacing matches the edited note: no blank line between `---` and the `[!rv]` dashboard, and the `###` stamp sits on the line after Taken. One blank line remains before Attempt Log.
- Nearby sort chips invert when tapped again. Defaults: Nearest, Priority · high, Spoke · oldest, Attempted · oldest. The flipped labels are Furthest, Priority · low, Spoke · newest, and Attempted · newest. The choice is still saved.
- The Nearby and Glancable toolbars have a `+` button (label **New RV**) beside the sort chips. It calls Templater’s create-from-template on `New RV.md` (the Templater templates folder, or `Templates/New RV.md`). The template still prompts and schedules geocode. A missing Templater plugin or template shows a notice and does not create a note.
- Glancable cards are six lines: name, street + city + distance, Last Spoke, Last Attempted, Met, then Met With with `# successful/visits`. Each date is its own line.
- Settings → **Update Templater / Meta Bind extras from GitHub** confirms before any write. Downloads are pinned to release tag `v1.1.5` on `raw.githubusercontent.com/JaydensAssistant/rv-locator` (not `main` or `unstable`). The dialog lists each path as create, overwrite, or skip, plus the SHA-256 of the downloaded file. Existing files are skipped unless overwrite is checked. Redirects off that host and ref are refused. It does not touch notes, Address, plugin `data.json`, or the Geoapify key.

## 1.1.4

`main.js` SHA-256: `23b723c93026c8d2d46dae3ccd042379bf1e24f28bfe46d7a04bfa2b4d90b40c` (unchanged)

`styles.css` SHA-256: `3fa9eb1486db7534a13879e8feaa632f1707a5f934039925003a5b8a5cc3b5d1`

`manifest.json` SHA-256: `a4464257ed02c0e2908387c26fa19147ee59301a0f57d55fc4678e5233d885d9`

- New RV body order: bold quote strip (Hubs, then Address plus the 🗺️ link), then equal-size Home / Not home buttons, then `---`, then the collapsed `[!rv]` dashboard, then the `###` stamp, a blank notes line, and the Attempt Log. The **Log visit** label is gone. Attempt Log stays its own callout. Visits and Successful Visits still start at 1.
- `styles.css` / `rv-dashboard.css` give both Meta Bind buttons the same width and height (`8.25rem` by `2rem`). Home stays `--text-accent`. The quote strip uses `--font-semibold`. The size rule targets `span.mb-button.rv-visit-btn > button.mb-button-inner` (Meta Bind’s real control). `button.mb-button` does not match. The rule does not depend on cssclass `rv-dashboard`.

## 1.1.3

`main.js` SHA-256: `23b723c93026c8d2d46dae3ccd042379bf1e24f28bfe46d7a04bfa2b4d90b40c`

- Map Link is a Google Maps **address search**, not a lat/lon pin. Single-note and bulk geocode set `Map Link` to `https://www.google.com/maps/search/?api=1&query=<urlencoded Address>`. The stored Address is the query (the geocoder’s formatted line is used only when Address is empty). `Location` is still two quoted coordinate strings. Address is never overwritten. The plugin does not rewrite a map icon already in the note body.
- New RV body: a two-line quote strip (Hubs, then Address plus a 🗺️ link built from the typed address). No `Map Link:` label and no Meta Bind `VIEW` of the URL. The dashboard is a collapsed `> [!rv]- 👤 RV Dashboard` that blends with the theme (`--background-primary` / `--background-secondary`). Field order is unchanged. A short **Log visit** divider sits above the Home / Not home buttons. The Glancable stamp is `###`, with a blank line under it for visit notes, then the collapsed Attempt Log with one success bullet. Visits and Successful Visits still start at 1.
- Home (Templater `rvLog.js` and the plugin priority tap) inserts a `###` stamp only when that stamp is not already a `##` or `###` heading. A later hour still gets its own `###` heading. An older `##` stamp is left in place.
- `extras/templater-metabind/rv-dashboard.css` (also in the plugin `styles.css`) tightens Meta Bind inputs in the strip and dashboard, rounds callouts, and paints the Home button with `--text-accent` (the same accent as the Glancable visits chip). Copy the file to `.obsidian/snippets/` and enable **rv-dashboard** only if the plugin is off.

## 1.1.2

`main.js` SHA-256: `703d2901abc09161116cdb3be2b9f5179d294342bb0a5d4e7ede64c346158b76`

- New RV template (`extras/templater-metabind/New RV.md`): **Hubs**, **Address**, and **Map Link** stay outside any callout, in that order. Map Link is a read-only Meta Bind link view (`VIEW[{["Map Link"]}][link]`) on the same line as Address, with no blank line under Hubs. The Home / Not home button block sits directly against the Glancable `##` stamp. The bracket form is required because the property name contains a space; `{Map Link}` makes Meta Bind expect `#`. City is not on the dashboard. The rest of the dashboard is collapsed by default (`> [!info]- 👤 RV Dashboard`): Priority, Visits, Successful Visits, Met, Last Spoke, Last Attempted, Met With, Taken. Successful Visits is seeded at 0. Home / Not home buttons are on the note (`BUTTON[rv-log-home, rv-log-miss]`, `Templates/RV Log Home.md` and `Templates/RV Log Miss.md`). Creating the note is the first successful visit: Visits and Successful Visits start at 1, one Glancable `##` stamp is written, and Attempt Log starts with one `> - {stamp} — success` bullet. Templater Home (`rvLog.js`) still updates the counters, dates, and Attempt Log, and it inserts a `##` stamp only when that exact heading is not already in the note, so Home after create does not duplicate it. `main.js` is unchanged from the hash above.
- Attempt Log is `> [!note]- Attempt Log` with callout bullets (`> - stamp — success` or `> - stamp — not home`). Priority-tap and `rvLog.js` create that callout when it is missing, append inside `[!note]-`, `[!note]+`, and unmarked `[!note]` variants, and migrate an old `## Attempt Log` heading to the callout on the next write. Home still inserts the Glancable `##` stamp and a blank line above the log. Address is still never written.
- No multi-column dashboard CSS. `.rv-dashboard` still clips overflow, including Meta Bind fields that now sit outside the callout, and collapsed callouts stay within the note width.

## 1.1.1

`main.js` SHA-256: `bf8c26e60f39c11291f2238879ab19e3257bc906db9fde963aaae5f033b828ed`

- `Location` is written as a YAML list of quoted strings (`"lat"`, `"lon"`), which list/text properties and Bases accept. Map Link and City still update. Address is never written. Older numeric locations still count as coordinates when read back.
- Auto-pick no longer compares street words. A hit is saved without the picker only when Geoapify `rank.confidence` is 1.00, the hit is inside a configured home-base county (`Orange` and `Orange County` still match), and it is the only result in that home region. An empty home-county list still always asks. A missing confidence never auto-picks.
- Bulk geocode: choosing a result saves that note (Location, City, Map Link). Closing the picker still skips it. The summary counts follow what was written.
- Templater: `extras/templater-metabind/New RV.md` prompts for householder name and Address, renames to `{Name} on {Street}`, seeds Met / Last Spoke / Last Attempted, writes a Glancable visit heading and the first Attempt Log success line, then runs **Geocode current note**. The dashboard is a vertical stack (`rv-dashboard`) so the phone layout does not scroll sideways. The plugin still does not write Address.
- Visit headings and Attempt Log stamps (priority tap and `rvLog.js`) use the same Glancable stamp: `Wed, 2pm — Sep 9, 2026` (nearest hour; a date-only value omits the hour).

## 1.1.0

- Geoapify geocode for return-visit notes, Nearby Bases views, and visit logging. Address is never overwritten.
