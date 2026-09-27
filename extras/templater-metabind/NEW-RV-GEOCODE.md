# New RV template — name, address, geocode

Drop-in replacement for Jayden’s New RV template. **Templater** is required. **Meta Bind** is required for the dashboard inputs and the Home / Not home buttons. The JS Engine is not required.

RV Locator never writes `Address`. The template writes Address from the prompt. Geocode then fills `Location` (two quoted strings), `City`, and `Map Link`. City is stored on the note and shown in Nearby. It is not a dashboard field.

There is one copy of this template in the repo: `extras/templater-metabind/New RV.md`. Copy that file into the vault Templates folder. There is no second vault copy in the repo to keep in sync.

## Setup

1. Copy `newRv.js` into the Templater **User Scripts** folder.
2. Copy `New RV.md` into the Templates folder. Point Templater’s “New RV” (or folder template) at that file.
3. Copy `rvLog.js` into the Templater user scripts folder, and copy `RV Log Home.md` and `RV Log Miss.md` into the vault `Templates/` folder. The New RV note’s buttons call `Templates/RV Log Home.md` and `Templates/RV Log Miss.md`. If your Templates folder has another path, change those two `templateFile` lines in `New RV.md`.
4. Reload Templater so `tp.user.newRv` and `tp.user.rvLog` exist.
5. Enable **RV Locator** and set the Geoapify key. The command id is `rv-locator:geocode-current-note`.
6. Optional phone CSS: the template sets cssclass `rv-dashboard`. Those rules are in the plugin `styles.css`. If the plugin is disabled, enable `extras/templater-metabind/rv-dashboard.css` as a vault snippet. This pass does not add a multi-column layout.

## What the note does

1. Prompts **Householder name**, then **Address** (`tp.system.prompt`). Cancel leaves that field empty. The template still calls `tp.user.newRv(tp)` for the prompts, the rename, and the geocode schedule.
2. Renames the note to `{Name} on {Street}` when both are present. Examples: `Alex on Maple`, `Riley on Cypress`. The street is the first address line with the house number, a leading directional (`N`, `SW`), a trailing suffix (`St`, `Lane`), and an apartment tail removed. `10 Oak Hammock Lane` becomes `Oak Hammock`.
3. Writes **Address** in the template output (quoted). A later geocode does not replace it. If the prompt had an address and the property is still empty when the template finishes, `newRv.js` writes it once.
4. Seeds **Met**, **Last Spoke**, and **Last Attempted** with the note’s creation time, local `YYYY-MM-DDTHH:mm:ss`. Seeds **Visits** and **Successful Visits** at `0`. The first success bullet records the Met moment; it does not increment either count. Later Home taps increment both.
5. Replaces the old `## YYYY-MM-DD` line with a Glancable drive date: `## Wed, 2pm — Sep 9, 2026` (weekday, hour rounded to the nearest hour, calendar date). A date-only value omits the hour.
6. Adds a collapsed Attempt Log callout and the first bullet, the same stamp the priority-tap Home logger uses:

```markdown
> [!note]- Attempt Log
> - Wed, 2pm — Sep 9, 2026 — success
```

7. After Templater finishes (`tp.hooks.on_all_templates_executed`), runs `rv-locator:geocode-current-note`. That command reads the file from disk, so the Address just written is visible. Geocode fills Map Link, which the always-visible Map Link view then shows as a link.

`Visits` and `Successful Visits` stay `0` on create.

## Always visible

These three sit outside every callout, in this order:

1. `Hubs: ` + `INPUT[inlineListSuggester(optionQuery("")):Hub]` (the property is still `Hub`)
2. Address text input bound to `Address`
3. Map Link, read-only: `` `VIEW[{Map Link}][link]` ``. A URL becomes a clickable link. Before geocode the property is empty, so the view is blank.

## Collapsed dashboard

`> [!info]- 👤 RV Dashboard` (the `-` means collapsed until opened). Inside, top to bottom:

- Priority (slider + `VIEW[{Priority}]`)
- Visits
- Successful Visits
- Met
- Last Spoke
- Last Attempted
- Met With
- Taken

Frontmatter still has Hub, Address, Priority, Met, Last Spoke, Last Attempted, Met With, Taken, Visits, Successful Visits, cssclasses `hide-props` and `rv-dashboard`, plus `icon` / `color`.

## Home / Not home

The note includes `` `BUTTON[rv-log-home, rv-log-miss]` `` and the hidden `runTemplaterFile` blocks from `RV-LOG-BUTTONS-TEMPLATER.md`. Paths:

- `Templates/RV Log Home.md`
- `Templates/RV Log Miss.md`

Those files in the repo live at `extras/templater-metabind/RV Log Home.md` and `RV Log Miss.md` until you copy them into the vault `Templates/` folder.

## Layout

Fields outside the callout are a vertical stack. The dashboard callout is collapsed, so the phone shows Hubs, Address, and Map Link first. There is no 4-column pipe table and no new multi-column CSS. `rv-dashboard` clips the note width so Meta Bind inputs, including the ones outside the callout, cannot force horizontal scroll. Collapsed callouts are width-capped the same way.

## Address-only helper

`geocodeNewRv.js` still only prompts for Address (if empty) and runs the same command. Use `New RV.md` for a new return visit. Use **Geocode current note** on a note that already has an Address.
