# RV Locator 1.1.0 — Obsidian Mobile (iOS) setup

Works with Obsidian for iPhone/iPad. Nearby Distance needs **location permission**. Prefer installing the plugin on desktop first and letting the vault sync, unless you are comfortable copying plugin files on device.

## Packages / hashes

Same as desktop. Plugin folder needs exactly:

- `manifest.json` — SHA-256 `f5bc8c683ae053f634f01d02da9f55722818180aa3292b088f8c6e04dba2af53`
- `main.js` — SHA-256 `dead81fc9acc8295987bf25bb5ca8f67af3044b4ed4b1f343f36e254337d6eb1`
- `styles.css` — SHA-256 `12158b2db6f2a839ce97e305e5ee34f7cd629880ad635697fbc00e04cb9decf5`

Repo (once published): https://github.com/JaydensAssistant/rv-locator  
Or use `rv-locator-1.1.0.tar.gz` from Cody.

## Recommended path: desktop install → sync to iPhone

1. On Mac/PC, finish [SETUP-REAL-HARDWARE-1.1.0.md](SETUP-REAL-HARDWARE-1.1.0.md) (plugin in `.obsidian/plugins/rv-locator/`, key in settings, counties empty for first tests).
2. Sync the vault to the phone with **Obsidian Sync**, **iCloud Drive**, or your usual Git/Working Copy flow. The folder `.obsidian/plugins/rv-locator/` must sync (do not exclude `.obsidian`).
3. Open the **same vault** in Obsidian Mobile.
4. Settings → Community plugins → turn off Restricted mode if needed → enable **RV Locator** (and Templater / Meta Bind if you use in-note buttons).
5. Confirm Geoapify key is present under RV Locator settings (synced via `plugins/rv-locator/data.json`). Prefer a restricted key; treat synced `data.json` as sensitive.
6. When Nearby asks for location, allow **While Using the App** (or Always if you want background-ish updates while the app is open). Distance is computed in memory and **not** written to notes.
7. Open your Active / Return Visits base → pick an RV Locator Nearby view (Glancable is built for phone).
8. First geocode: still safest from desktop or with **Home base counties empty** so you confirm every hit. Address is never overwritten; spot-check anyway.
9. Visit log: tap the **priority** control on a card → Were they home?

## Alternate path: install files only on iOS

Use this if the vault lives on the phone (iCloud/local) without a desktop copy.

1. On a computer, extract `rv-locator-1.1.0.tar.gz` (or download the three files from the GitHub repo release/dist).
2. Get them onto the iPhone (AirDrop, Files, Working Copy, etc.).
3. In the **Files** app, open your vault → `.obsidian` → `plugins` → create folder `rv-locator` → copy the three files inside.
4. Force-quit and reopen Obsidian (or reload the vault).
5. Enable **RV Locator** under Community plugins.
6. Paste the Geoapify key in RV Locator settings on the phone (do not put it in a note or chat).
7. Same location permission + Nearby steps as above.

You generally **cannot** verify SHA-256 easily on iOS; prefer copying files you already verified on desktop, or trust a sync from a verified desktop install.

## Templater + Meta Bind on iOS

1. Install **Templater** and **Meta Bind** from Community plugins on the phone (or sync them from desktop).
2. Sync `Scripts/rvLog.js` and `Templates/RV Log Home.md` / `RV Log Miss.md`.
3. Templater → User scripts folder = `Scripts`; **system commands OFF**.
4. In the RV template/note, keep Meta Bind button blocks and this line **in backticks**:

   `BUTTON[rv-log-home, rv-log-miss]`

5. Test Home / Not home on a throwaway note. No JS Engine required for `runTemplaterFile`.

## iOS-specific tips

- **Glancable** is the phone-friendly skin; Vanilla is fine but denser.
- Keep the phone awake / Obsidian foregrounded while sorting by Distance so GPS updates.
- Desktop “distance testing” mode is for layout on a computer — leave it **off** in the field.
- If Sync conflicts on `data.json`, re-check the API key and home counties after resolve.
- First field session: counties empty → confirm modals → then add your home counties once auto-picks look right. Reminder: `123 Main St` will not auto-accept `123 S Main St`.

## Quick checklist

- [ ] Plugin folder synced or copied to `.obsidian/plugins/rv-locator/`
- [ ] RV Locator enabled on iOS
- [ ] Location allowed for Obsidian
- [ ] API key present (restricted/throwaway for first pass)
- [ ] Home counties empty for first geocodes
- [ ] Nearby Glancable opens; Distance updates
- [ ] Priority-tap Home / Not home once each; Address unchanged
