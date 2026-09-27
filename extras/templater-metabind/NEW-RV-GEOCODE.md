# New RV template — name, address, geocode

Drop-in replacement for Jayden’s New RV template. **Templater** is required. **Meta Bind** is required only for the dashboard inputs (Hub, Address, Priority, Met, Met With, Last Spoke, Taken, Visits). The JS Engine is not required.

RV Locator never writes `Address`. The template writes Address from the prompt. Geocode then fills `Location` (two quoted strings), `City`, and `Map Link`.

## Setup

1. Copy `newRv.js` into the Templater **User Scripts** folder.
2. Copy `New RV.md` into the Templates folder. Point Templater’s “New RV” (or folder template) at that file.
3. Reload Templater so `tp.user.newRv` exists.
4. Enable **RV Locator** and set the Geoapify key. The command id is `rv-locator:geocode-current-note`.
5. Optional phone CSS: the template sets cssclass `rv-dashboard`. Those rules are in the plugin `styles.css`. If the plugin is disabled, enable `extras/templater-metabind/rv-dashboard.css` as a vault snippet.

## What the note does

1. Prompts **Householder name**, then **Address** (`tp.system.prompt`). Cancel leaves that field empty.
2. Renames the note to `{Name} on {Street}` when both are present. Examples: `Alex on Maple`, `Riley on Cypress`. The street is the first address line with the house number, a leading directional (`N`, `SW`), a trailing suffix (`St`, `Lane`), and an apartment tail removed. `10 Oak Hammock Lane` becomes `Oak Hammock`.
3. Writes **Address** in the template output (quoted). A later geocode does not replace it. If the prompt had an address and the property is still empty when the template finishes, `newRv.js` writes it once.
4. Seeds **Met**, **Last Spoke**, and **Last Attempted** with the note’s creation time, local `YYYY-MM-DDTHH:mm:ss`.
5. Replaces the old `## YYYY-MM-DD` line with a Glancable drive date: `## Wed, 2pm — Sep 9, 2026` (weekday, hour rounded to the nearest hour, calendar date). A date-only value omits the hour.
6. Adds `## Attempt Log` and the first bullet `- {stamp} — success`, the same stamp the priority-tap Home logger uses.
7. After Templater finishes (`tp.hooks.on_all_templates_executed`), runs `rv-locator:geocode-current-note`. That command reads the file from disk, so the Address just written is visible.

`Visits` stays `0`, matching the previous template. The success bullet records the Met moment; it does not increment Visits.

## Dashboard

Fields are stacked inside the info callout. There is no 4-column pipe table, which is what forced horizontal scroll on a phone. `rv-dashboard` clips the callout to the note width so Meta Bind inputs cannot widen the page. At about 390px the dashboard is a vertical list: Hub, Address, Priority, Met, Met With, Last Spoke, Taken, Visits.

## Address-only helper

`geocodeNewRv.js` still only prompts for Address (if empty) and runs the same command. Use `New RV.md` for a new return visit. Use **Geocode current note** on a note that already has an Address.
