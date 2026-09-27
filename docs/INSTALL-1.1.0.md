# RV Locator 1.1.0 — install (fake vault / throwaway key only until Sentinel clears)

## SHA-256
- `manifest.json`: `f5bc8c683ae053f634f01d02da9f55722818180aa3292b088f8c6e04dba2af53`
- `main.js`: `dead81fc9acc8295987bf25bb5ca8f67af3044b4ed4b1f343f36e254337d6eb1` (77326 B)
- `styles.css`: `12158b2db6f2a839ce97e305e5ee34f7cd629880ad635697fbc00e04cb9decf5`

## What’s new
- **Never overwrites Address.** Location / Map Link / City only.
- Home-base counties + street-token auto-pick (empty list = always confirm).
- Priority-tap visit logging (Were they home?) + Attempt Log.
- Glancable: white name, purple Visits chip.
- Meta Bind notes in-repo / handoff snippet.

Cloud agent: https://cursor.com/agents/bc-1e5e2f66-9891-5d68-a9ec-852cf15669f4

## Accuracy (2026-09-26)
20-address FL harness (mirrored `Rt`/`Mr` from main.js): **100%** correct among auto-picks (11/11); **100%** safety (0 wrong autos; CA control forced modal). 9/20 opened modal (ambiguous in-home or token fail) — safe, not silent. See `accuracy/REPORT-1.1.0.md`.
