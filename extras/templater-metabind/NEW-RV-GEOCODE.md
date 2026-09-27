# New RV template — name, address, geocode

Drop-in replacement for Jayden’s New RV template. **Templater** is required. **Meta Bind** is required for the dashboard inputs and the Home / Not home buttons. The JS Engine is not required.

RV Locator never writes `Address`. The template writes Address from the prompt. Geocode then fills `Location` (two quoted strings), `City`, and `Map Link`. City is stored on the note and shown in Nearby. It is not a dashboard field.

There is one copy of this template in the repo: `extras/templater-metabind/New RV.md`. Copy that file into the vault Templates folder. There is no second vault copy in the repo to keep in sync.

## Setup

1. Copy `newRv.js` into the Templater **User Scripts** folder.
2. Copy `New RV.md` into the Templates folder. Point Templater’s “New RV” (or folder template) at that file. The Nearby and Glancable toolbars have a `+` button that calls Templater’s create-from-template on that file. It does not write the note itself. If Templater is off, or the file is missing, the button shows a notice.
3. Copy `rvLog.js` into the Templater user scripts folder, and copy `RV Log Home.md` and `RV Log Miss.md` into the vault `Templates/` folder. The New RV note’s buttons call `Templates/RV Log Home.md` and `Templates/RV Log Miss.md`. If your Templates folder has another path, change those two `templateFile` lines in `New RV.md`.
4. Reload Templater so `tp.user.newRv` and `tp.user.rvLog` exist.
5. Enable **RV Locator** and set the Geoapify key. The command id is `rv-locator:geocode-current-note`.
6. Phone CSS: the template sets cssclass `rv-dashboard`. Those rules ship in the plugin `styles.css`. If the plugin is disabled, copy `extras/templater-metabind/rv-dashboard.css` to `<vault>/.obsidian/snippets/rv-dashboard.css` and turn the snippet on under Settings → Appearance → CSS snippets. The snippet tightens the quote-strip and dashboard inputs, rounds callouts, blends the `[!rv]` dashboard with the theme, and paints Home with the accent color. It does not include hide-props rules. This pass does not add a multi-column layout.

## What the note does

1. Prompts **Householder name**, then **Address** (`tp.system.prompt`). Cancel leaves that field empty. The template still calls `tp.user.newRv(tp)` for the prompts, the rename, and the geocode schedule.
2. Renames the note to `{Name} on {Street}` when both are present. Examples: `Alex on Maple`, `Riley on Cypress`. The street is the first address line with the house number, a leading directional (`N`, `SW`), a trailing suffix (`St`, `Lane`), and an apartment tail removed. `10 Oak Hammock Lane` becomes `Oak Hammock`.
3. Writes **Address** in the template output (quoted). A later geocode does not replace it. If the prompt had an address and the property is still empty when the template finishes, `newRv.js` writes it once.
4. Seeds **Met**, **Last Spoke**, and **Last Attempted** with the note’s creation time, local `YYYY-MM-DDTHH:mm:ss`. Creating the note **is** the first successful visit, so **Visits** and **Successful Visits** start at `1`.
5. Writes one Glancable drive date for that visit as a `###` heading: `### Wed, 2pm — Sep 9, 2026` (weekday, hour rounded to the nearest hour, calendar date). A blank line under that heading is the place to type visit notes. A date-only value omits the hour.
6. Adds a collapsed Attempt Log with one success bullet for that same stamp:

```markdown
### Wed, 2pm — Sep 9, 2026

> [!note]- Attempt Log
> - Wed, 2pm — Sep 9, 2026 — success
```

7. After Templater finishes (`tp.hooks.on_all_templates_executed`), runs `rv-locator:geocode-current-note`. That command reads the file from disk, so the Address just written is visible. Geocode fills `Location` and sets `Map Link` to a Google Maps search of the stored Address: `https://www.google.com/maps/search/?api=1&query=<urlencoded Address>`. If that Address has no city (no comma-separated locality, and the City text is not already in the line), the link query appends `, ` plus the note’s `City`. Address itself is not rewritten. A full address such as `142 Maple Street, Orlando, FL` is searched as stored. It does not rewrite the 🗺️ link already in the body. On a new note that icon was built from the typed address before City exists, so it stays address-only until you edit the note.

`Visits` and `Successful Visits` are `1` on create. A Home tap in Templater (`rvLog.js`) still increments both and appends another success bullet. It adds a new `###` stamp only when that exact Glancable stamp is not already a `##` or `###` heading, so Home right after create does not repeat the create stamp. A later hour still gets its own `###` heading. The plugin priority tap uses the same rule.

## Quote strip

The first two body lines are markdown quotes, with no blank line between them. There is no `Map Link:` label and no Meta Bind view of the URL (a link view shows the raw URL text). The map icon is a normal markdown link. Templater fills it at create from the address just typed:

```markdown
> **Hubs:** `INPUT[inlineListSuggester(optionQuery("")):Hub]`
> **Address:** `INPUT[text:Address]` [🗺️](https://www.google.com/maps/search/?api=1&query=142%20Maple%20Street%2C%20Orlando%2C%20FL)
```

Both lines are also `font-weight: var(--font-semibold)` in `rv-dashboard.css`, so the map icon matches the bold labels.

The Hub property is still `Hub`. The icon URL is `https://www.google.com/maps/search/?api=1&query=` plus `encodeURIComponent` of the address (newlines and repeated spaces collapsed). The `Map Link` property uses that formula when geocode runs, and appends the note’s City when the stored Address has no city. Example: Address `123 S Main St` and City `Orlando` become `https://www.google.com/maps/search/?api=1&query=123%20S%20Main%20St%2C%20Orlando`. Empty City leaves the address as the whole query.

## Collapsed dashboard

`> [!rv]- 👤 RV Dashboard` (the `-` means collapsed until opened). The `[!rv]` type is styled in `rv-dashboard.css` with theme variables (`--background-primary`, `--background-secondary`, `--background-modifier-border`) so it stays grey against the page in light and dark, instead of the blue info callout. Inside, top to bottom:

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

The buttons sit directly under the quote strip and above the `---` divider. There is no caption above them. `` `BUTTON[rv-log-home, rv-log-miss]` `` renders both, and the hidden `runTemplaterFile` blocks from `RV-LOG-BUTTONS-TEMPLATER.md` stay at the bottom of the note so they do not add a gap. Both button blocks set `class: rv-visit-btn`. Meta Bind puts that class on `span.mb-button` and draws the control as `button.mb-button-inner`. The snippet sizes that inner button to `8.25rem` by `2rem`. Paths:

- `Templates/RV Log Home.md`
- `Templates/RV Log Miss.md`

Those files in the repo live at `extras/templater-metabind/RV Log Home.md` and `RV Log Miss.md` until you copy them into the vault `Templates/` folder.

## Layout

Reading order is the bold quote strip, then the two buttons, then the divider, then the collapsed dashboard with no blank line under `---`, then the `###` stamp on the next line after Taken, one blank notes line, and Attempt Log. The phone shows Hubs and Address first. There is no 4-column pipe table and no new multi-column CSS. `rv-dashboard` clips the note width so Meta Bind inputs cannot force horizontal scroll. Collapsed callouts stay within the note width. Callouts are modestly rounded. Home and Not home are the same size. Home uses `--text-accent`, the same accent as the Glancable visits chip.

## Address-only helper

`geocodeNewRv.js` still only prompts for Address (if empty) and runs the same command. Use `New RV.md` for a new return visit. Use **Geocode current note** on a note that already has an Address.
