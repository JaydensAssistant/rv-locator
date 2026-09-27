# Changelog

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
