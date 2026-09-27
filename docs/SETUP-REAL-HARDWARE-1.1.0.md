# RV Locator 1.1.0 — first real-hardware setup

Fake-vault smoke and accuracy are done. This is the checklist for installing on **your** Obsidian vault / phone / desktop.

## Packages

- Plugin: `rv-locator-1.1.0.tar.gz` → `manifest.json`, `main.js`, `styles.css`
- Optional visit-log (Templater + Meta Bind): `rv-templater-log-1.1.0.tar.gz`

### SHA-256 (verify before enable)

| File | SHA-256 |
|------|---------|
| `manifest.json` | `f5bc8c683ae053f634f01d02da9f55722818180aa3292b088f8c6e04dba2af53` |
| `main.js` | `dead81fc9acc8295987bf25bb5ca8f67af3044b4ed4b1f343f36e254337d6eb1` |
| `styles.css` | `12158b2db6f2a839ce97e305e5ee34f7cd629880ad635697fbc00e04cb9decf5` |

## Before you start

1. **Backup** the vault (Obsidian Sync / Git / zip copy). First run should be reversible.
2. **API key:** Settings store the Geoapify key in local `data.json` only. Prefer a **new restricted Geoapify key** (or the throwaway you planned to revoke) for the first hardware pass. Do not paste keys into chat. `chmod 600` on `data.json` if the OS makes that easy.
3. **Address is never overwritten** by the plugin. Location / Map Link / City (and optional place fields you enable) may update. Still spot-check Address after the first few geocodes.
4. Start with **Home base counties empty** so every geocode shows the confirm modal. Turn on counties only after you trust auto-picks on your streets.

## A. Install RV Locator

1. Quit Obsidian (or at least close the vault).
2. Extract the plugin tarball.
3. Copy the three files into:
   `<YourVault>/.obsidian/plugins/rv-locator/`
   Create the folder if needed. You should have exactly:
   - `manifest.json`
   - `main.js`
   - `styles.css`
4. Optional verify (macOS/Linux):
   `shasum -a 256 .obsidian/plugins/rv-locator/main.js`
   Match the `main.js` hash above.
5. Open the vault → Settings → Community plugins → turn **Restricted mode off** if needed → enable **RV Locator**.
6. Settings → RV Locator:
   - Paste Geoapify API key (local only).
   - Confirm property names match your notes (`Address`, `Location`, `City`, `Visits`, `Successful Visits`, `Last Spoke`, `Last Attempted`, etc.). Leave defaults if your sample base already matched.
   - **Home base counties:** leave blank for first test.
   - Distance unit as you prefer.
   - Attribution / privacy: addresses are sent to Geoapify (OSM + Powered by Geoapify).

## B. First geocode (safe mode)

1. Pick **one** non-critical RV note (or a duplicate) with a good Address.
2. Command palette → **RV Locator: Geocode current note** (or the bulk command on a tiny folder).
3. With counties empty you **must** get a confirm modal — pick the correct hit.
4. Check the note:
   - `Address` text unchanged
   - `Location` / `Map Link` / `City` look right
5. Open your **Return Visits** / Active base → switch to an RV Locator Nearby view (Vanilla or Glancable).
6. On phone: allow location when prompted; Distance is live in-memory only (not written to the note).
7. On desktop without GPS: use **Desktop distance testing** in settings only if you want fake coords for layout checks — turn it off for real field use.

## C. Visit logging (plugin)

1. In Glancable or Vanilla Nearby, tap the **priority** control on a card.
2. Answer **Were they home?**
   - Home → Visits++, Successful Visits++, Last Spoke + Last Attempted, mid-note `## Weekday…` blank notes line, Attempt Log `— success`
   - Not home → Visits++, Last Attempted, Attempt Log `— not home`
3. Confirm Address still unchanged.

## D. Optional — Templater + Meta Bind (in-note buttons)

You already run Templater. Meta Bind JS Engine is **not** required for these buttons.

1. Install **Meta Bind** from Community plugins if missing (Templater you have).
2. From `rv-templater-log-1.1.0.tar.gz`:
   - Copy `templater/rvLog.js` → your Templater **User Scripts** folder
   - Copy `RV Log Home.md` and `RV Log Miss.md` → your Templates folder (e.g. `Templates/`)
3. Templater settings:
   - User scripts folder = that Scripts folder
   - **Enable system command functions: OFF**
   - Reload Templater
4. Paste the two `meta-bind-button` blocks from `metabind/RV-LOG-BUTTONS-TEMPLATER.md` into your RV template (or each note).
5. Add this line **in backticks** (required or Meta Bind shows raw text):

   `BUTTON[rv-log-home, rv-log-miss]`

6. Keep one `## Attempt Log` heading near the bottom of the note.
7. Adjust `templateFile:` paths if your Templates folder isn’t `Templates/`.
8. Test Home / Not home on a throwaway note first.

## E. When to turn on home-base counties

After a few manual confirms look right:

1. Settings → **Home base counties** — one county per line (e.g. `Orange` or `Orange County`).
2. Auto-pick only when **exactly one** Geoapify hit is in a listed county **and** street tokens match (house number + street words; trailing St/Ave/etc. ignored; directions normalized).
3. Reminder: `123 Main St` will **not** auto-accept a hit on `123 S Main St` — you’ll get a modal. That is intentional.

## F. First-session checklist

- [ ] Vault backed up
- [ ] Hashes match
- [ ] Plugin enabled; key in settings only
- [ ] Home counties empty for first geocodes
- [ ] One note geocoded; Address unchanged
- [ ] Nearby Glancable readable on phone
- [ ] Priority-tap Home + Not home once each
- [ ] (Optional) Templater/Meta Bind buttons on a test note
- [ ] Then add home counties if you want quieter bulk

## Rollback

Disable RV Locator or delete `.obsidian/plugins/rv-locator/`. Notes keep whatever Location/City/visits you already wrote; Address should be untouched by the plugin.
