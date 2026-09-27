# RV Locator 1.1.0 — install (fake vault / throwaway key only until Sentinel clears)

> **1.1.3:** Map Link searches the note’s Address (`https://www.google.com/maps/search/?api=1&query=…`), not lat/lon. New RV puts Hubs and Address in a quote strip with a 🗺️ icon link, a theme-blended collapsed `[!rv]` dashboard, a **Log visit** divider, a `###` stamp, and a blank line for notes. See `CHANGELOG.md`.
>
> **1.1.2:** New RV starts Visits and Successful Visits at 1 with one Attempt Log success, and puts Home / Not home on the note. Attempt Log is a collapsed `> [!note]- Attempt Log` callout (priority tap and `rvLog.js` migrate an old `## Attempt Log` on the next write). See `CHANGELOG.md`.
>
> **1.1.1:** Street-token auto-pick was removed. A hit is saved without the picker only when Geoapify `rank.confidence` is 1.00 and it is the only result in a configured home-base county. `Location` is a YAML list of quoted strings. New RV template: `extras/templater-metabind/NEW-RV-GEOCODE.md`. See `CHANGELOG.md`.

## SHA-256
- `manifest.json`: `f5bc8c683ae053f634f01d02da9f55722818180aa3292b088f8c6e04dba2af53`
- `main.js`: `dead81fc9acc8295987bf25bb5ca8f67af3044b4ed4b1f343f36e254337d6eb1` (77326 B)
- `styles.css`: `12158b2db6f2a839ce97e305e5ee34f7cd629880ad635697fbc00e04cb9decf5`

## What’s new
- **Never overwrites Address.** Location / Map Link / City only.
- Home-base counties + street-token auto-pick (empty list = always confirm). **Removed in 1.1.1** — confidence 1.00 and a single in-home hit, not street tokens.
- Priority-tap visit logging (Were they home?) + Attempt Log.
- Glancable: white name, purple Visits chip.
- Meta Bind notes in-repo / handoff snippet.

Cloud agent: https://cursor.com/agents/bc-1e5e2f66-9891-5d68-a9ec-852cf15669f4

## Accuracy (2026-09-26)
20-address FL harness (mirrored `Rt`/`Mr` from main.js): **100%** correct among auto-picks (11/11); **100%** safety (0 wrong autos; CA control forced modal). 9/20 opened modal (ambiguous in-home or token fail) — safe, not silent. See `accuracy/REPORT-1.1.0.md`. That harness described 1.1.0 street-token matching. 1.1.1 does not compare street tokens.
