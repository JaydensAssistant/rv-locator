# Changelog

## 1.3.5

`main.js` SHA-256: `074b06fbe99fff3754259a3708264cae7a8070ff29e0c47a28c2e435ac48ac5b`

`styles.css` SHA-256: `edd4ce67b0f0f875c1ff04e1e08643fcc043a515d0dd32128d350f4f86d89556`

`manifest.json` SHA-256: `dbf47c2188d9abcdda12f0242dbffe93a835852e2cf21e9b476278e7fbd92591`

`extras/templater-metabind/rvLog.js` SHA-256 unchanged: `0fd68b7830811db052164b95a7a1696d113caba5d85c3b26881e9a38d3499152`

### Dogfood pack (claimed vs not)

Phone-first: Obsidian mobile around 390px, 40px touch targets on the hub bar, map controls, chevrons, disclosure rows, and suggester rows. The page itself does not scroll sideways. The sort bar sticks to the bottom of a stacked hub. Modals scroll inside the visible viewport, and suggesters stay above the on-screen keyboard.

1. **Claimed.** Hub and Address share one label column (`--rv-hub-label: 5.25em`) and a 0.22em gap, so the boxes share a left edge. Applied to the plugin note dashboard in `styles.css` (normal and wide hubs) and the vault snippet `extras/templater-metabind/rv-dashboard.css`. Not the Glancable card.
2. **Claimed.** Stacked hub (phone, or hub narrower than 600px) puts the list, then the drag handle, then the map. Handle is 40px tall. Applied to the in-view Glancable stage, standalone and embedded. Desktop side-by-side is item 6.
3. **Claimed** for the Glancable card list: the non-affiliation notice is the last list row, not a pinned footer. OSM and Geoapify stay in the map credit corner. The vanilla table footer and the settings-tab notice are unchanged.
4. **Claimed.** One fullscreen button on the in-view map. It swaps to Back to Hub in the same slot. Standalone and embedded, phone and desktop. There is no second split-leaf map button.
5. **Claimed.** Sort pills use a short label (Urgent, Near, Priority, Oldest, Tries, and the other presets) plus a direction arrow. Equal width, capped at 78px, 40px tall, scrolling inside the bar. Applied anywhere `paintSortPresets` runs (Glancable and the vanilla sort row). Filter pills stay their own width.
6. **Claimed.** Desktop opens the map inside the same view, to the right of the list, with a drag handle. No workspace leaf. Standalone and embedded.
7. **Claimed.** The map has no sort pills. The list pills drive the list and the map. Glancable only (the map is the in-view map).
8. **Claimed.** Map controls sit on the map, 40px squares, semi-transparent, no Map header row. The one in-view map, phone and desktop.
9. **Claimed** for Glancable, standalone and embedded, phone and desktop. Search is an icon. Tapping it replaces the pills and the other buttons with the field. X or Escape brings the pills back. AND facet parsing is unchanged. The vanilla table does not get this search slot.
10. **Claimed.** Tapping the map button again hides the map. `openMapSoon()` toggles. Standalone and embedded, phone and desktop.
11. **Claimed.** On a stacked hub the sort pills and the search, map, campaign, and New RV buttons sit in a bar stuck to the bottom of the view, with the home-indicator inset. With the map open, the map is just above that bar. Inside an embed the bar stays in the embed, not the whole window. Desktop keeps the bar at the top of the list column.
12. **Claimed.** Pins are 48px and clusters 53px, glyphs 21px: 15% over the original 42/18/46, not the later 50% enlargement. Popup badges stay 38px. Hub badges stay 28px. Ghost pins use the same diameter.
13. **Claimed.** The same in-view split uses the view root width, so items 2, 6, 7, 10, and 11 apply to a base opened on its own and to a base embedded in a note, including `cssclasses: wide-base-page`. Smoke note: `extras/smoke/Embedded Hub.md` (`![[Active RVs.base]]`). There is still no `.base` file in the repo.
14. **Claimed** for the startup polish and the accent check: they no longer rewrite markdown. Stamp ages already on a note are replaced on screen from the date. **Not removed:** saving a digest setting (orientation, day columns, suggestion callout) still rewrites the stored table. Logging, editing, or creating a visit still writes the note, and the age span is refreshed on that explicit write. Vaults that never received digest polish versions 1–11 do not get those structural migrations (markers, callout wrap, buttons, Status/Hub rename, bullet lines) on launch. `DIGEST_POLISH_VERSION` was not bumped.
15. **Claimed.** Deleted `dist/main.js`, `dist/styles.css`, and `dist/manifest.json`. The plugin files are the ones at the repo root.
16. **Claimed.** Reading view and Live Preview inline titles on an RV dashboard note get the same status icon as the cards (active, study, inactive), to the left of the name. Render only. Cards already had the icon. Quick Facts still has its status row.
17. **Claimed.** "Studied a lesson?" is a disclosure, collapsed by default, in New RV, Log visit (`LiteraturePromptModal`, card and urgency Home, with or without a campaign), in-note Home (`CompanionSuggestModal` via `rvLog.js` `logNoteHome`), log a past visit, and edit visit (`VisitEditModal`). A study starts expanded and prefills only when the lesson is empty. Collapsing still clears the lesson. `VisitConfirmModal` has no share fields. A miss does not ask. `askCampaignCovered` stays the coverage-only fallback when no decision was recorded.
18. **Claimed** on the same modals as item 17. Literature and media always show. On a study they sit in a collapsed "Literature and media" disclosure. On an active or inactive RV they stay visible. The "Literature on a study" setting no longer hides them. Its stored default is still off.
19. **Claimed.** Literature, media, and the lesson list are gone from Glancable cards and map popup cards. Last Studied stays. Quick Facts in the note still lists Literature, Media, and Lessons.
20. **Claimed** on every chevron suggester: literature, media, lesson, companion, address, and the other `mountAlwaysChevron` fields, in New RV, Log visit, campaign log, past visit, edit visit, and the in-note companion dialog. Focus or click opens the list under the field. Mount does not focus the field, so opening the modal does not open the companion list. A programmatic focus (the chevron already painted) does not toggle it shut.
21. **Claimed** on those same fields. `autocomplete=off`, and the native datalist is gone from New RV, the visit editor companion, and the in-note companion.
22. **Claimed.** The native calendar and list indicators are hidden on `.rv-suggest-host` inputs. The chevron beside the box stays visible, 40px.
23. **Claimed** in `.rv-locator-modal` for text, search, and date inputs: one control width (`min(16.5rem, 100%)`), a 40px chevron column, and fields without a chevron shortened by that same 40px so the boxes line up. On a phone the label stacks above the control. Sliders and the gender buttons are not in that column. New RV, Log visit, past visit, edit visit, and the in-note log.
24. **Claimed** on those same literature and media fields. Placeholders are "Tract or book (optional)" and "Video (optional)".
25. **Claimed** when Hide the Bases bar is on. `.bases-toolbar` and `.bases-header` collapse (no height, margin, padding, or border), standalone and embedded. The file tab (`.view-header`) stays. The stored default is still off, so the bar shows until the setting is turned on.
26. **Claimed.** A campaign does not remove literature, media, or the lesson disclosure. Log visit, the in-note log, and log a past visit still show them as items 17 and 18 define, and a home save writes Left Publications, Shared Media, and Lessons Studied. Covered by tests that read the share back through frontmatter and the visit stamp.
27. **Claimed** on every `mountAlwaysChevron` list (literature, media, lesson, companion, address, and the rest) in every modal from item 17, including the in-note path. The box is about five rows tall and scrolls inside itself. It is limited to the modal and to `visualViewport` (the space above the keyboard). If there is more room above the field, it opens above. Titles wrap to at most two lines.

Left for a decision, not done silently: digest-table shape still rewrites notes when those settings change. Structural digest migrations 1–11 are not applied on launch to a vault that never had them.

- A collapsed visit heading hides its Meta Bind text areas in Live Preview and Reading view, including older visits and the latest visit. Live Preview draws Older Visits with CodeMirror decorations only, so opening the note does not write that heading into the file. Folding the latest visit in Reading view no longer locks the renderer: an unchanged class notification is ignored, fold work is disconnected from its observer, and a pass that finds nothing changed writes nothing. Expanding the heading shows the text areas again.
- Every visit dialog keeps the collapsed "Studied a lesson?" section. The first Home stamp on a note keeps the lesson tail.
- Tapping a pin in the desktop split scrolls `.rv-locator-scroll` to that RV's card and flashes it.
- Fullscreen map popup badges are 38px. Card text stays at the Glancable font scale.
- The map opens inside the hub view. A phone, or a hub narrower than 600px, stacks the list above the map. A wide desktop pane puts the map on the right. Tapping the map button again hides it. There is no separate workspace leaf.
- Fullscreen is one button on that map. Back to Hub replaces it in the same slot.
- Map pins and clusters are opaque. They use the card color as `background-color` and a linear-gradient of the badge's 13% accent over transparent on top, so light and dark match the Glancable badge. Ghost pins are the theme background with no transparency. Pin glyphs are 21px on the 48px pin. Clusters are 53px. Popup badges stay 38px.
- Hub chips are wikilinks, in note chrome, in the surrounding font, with every hub shown. Move Left and Remove are a right-click or long-press menu. There is no X.
- The Quick Facts route badge opens the Google Maps link. The earth icon still opens the coming-soon map.
- Quick Facts dates stay on one line, with a smaller calendar date and age. Labels are Spoke and Attempted. The priority slider sits next to the priority number. Status is Active, then Study, then Inactive. Rows are grouped with horizontal rules. Quick Facts labels stay left aligned when the dashboard is centered.
- Taken scrolls the middle names. Met With and the latest Taken person stay visible. Met With is a box, not a link.
- The card earth icon is muted, the same size as the row icons, and lines up with those rows. It scales with the card. Status icons stay their own color and share that icon column. One tooltip on the status icon.
- Changing sort keeps the chip scroller where it was.
- Wide visit buttons, wide hubs and address, wide Quick Facts, and Center RV Dashboard default on. Attempt Log width stays wide when the digest swaps rows and columns.
- Cards side by side redraw and rescale when the window changes and the fit count is not the single-column default.
- New RV is one dialog: Man/Woman, name, address, Met companion, and a priority slider prefilled from the default.
- Page Preview stays off on the RV Dashboard and Glancable cards unless the setting is turned on.
- Each settings tab has a reset button for that tab only. The Geoapify API key is not cleared.
- Visit notes display newest first. Only the latest 3 stay open. The rest sit under a collapsed `## Older Visits` heading. The file is not rewritten.
- Geoapify defaults to the global endpoint. EU is a setting.
- A card can show the current return bucket. Off by default.
- Quick Facts badge toggles repaint an open note.
- Street suffixes stay in the note title (`Lake Dr`, `Maple Street`).
- Glancable adds a map button and a Campaign button to the left of New RV. One campaign at a time. An at-home visit asks whether this RV was covered. Covered cards use book-check. Uncovered cards use book-alert.
- The Attempt Log can mark a daypart Try or Avoid. Return suggestion lines are bullets, one bucket per line.
- Extras sync is pinned to tag `v1.3.5`. This build does not create that git tag.

## 1.3.4

`main.js` SHA-256: `28fe4ee5e9b9f11854e1825e24a9e38af3bfbe0fd9b60c83bacc47e28f0b5cbb`

`styles.css` SHA-256: `3760fdda66b943d05e9274682dc2e2173f5f0dbf78e00a1e220125cce6e2dd18`

`manifest.json` SHA-256: `82646b287f2db542d40567e44215a97ba8d441d79ce2a256acea758c6a41b71c`

- Archive becomes Unarchive when the note is Inactive (Priority 0). Unarchive sets Active and Priority 1. The command id stays `archive-rv`.
- Attempt Log time is exact (`4:32pm`). On the hour it stays `4pm`. Only the calendar date is small. The weekday, time, and dash stay normal size.
- Attempt Log width defaults to Full.
- Settings: wide Quick Facts, wide Hubs and Address, and wide visit buttons. All off by default.
- Visit buttons are fully rounded, including the Home and Archive ends. By default they share the dashboard column so their right edge lines up with Hub + and the map button. Wide visit buttons span the RV Dashboard.
- Button colors pull a very light or very dark accent toward the middle, then step down. The lightest is a bit darker than the raw accent. The darkest is lighter than a hard mix toward black.
- The control beside Address is a Lucide earth icon. It opens a Map page that says Coming soon. The card’s external map icon is a Lucide route and still opens the maps link.
- Creating an RV focuses the first visit notes box.
- Quick Facts shows Visits as successful/total, human-readable Last Spoke, Last Attempted, and Met (that order), and no Met With line. The companion who was Met With is accented inside Taken. Every row has a Lucide icon. The value column shares one right edge.
- The Quick Facts header has urgency, priority, and route badges, on by default and each toggleable. Urgency opens Home, Not home, Log past visit, Archive or Unarchive, and snooze today / 7 days / 14 days. Priority opens a 0–5 slider.
- Quick Facts includes Status: Study, Active, or Inactive. New notes start Active. Inactive forces Priority 0. Priority 0 forces Inactive. Inactive to Active sets Priority 1. A priority above 0 on an Inactive note makes it Active.
- Cards show a status icon left of the title: `user-round-check`, `user-round-x`, or `book-user`. The address line starts with an earth icon, and tapping that line opens the coming-soon map.
- Sort chips add City after Met (nearest city when a position exists, otherwise alphabetical). After the sorts, a status cycle (Active, RVs Only, Studies, Archive) and a gender cycle (Men+Women, Men, Women). Notes with no gender stay in Men+Women only.
- The only registered Bases view is Return Visits. The older vanilla view and the separate Active and Inactive glancable views are no longer registered.
- Settings can set a default folder for new RVs. Advanced can append the Met date (`YYYY-MM-DD`) to new filenames. Off by default.
- Return-suggester settings explain Try soft rate, Try homes, Avoid soft rate, and Avoid trials, and show a graph of those boundaries. Every settings graph has stepped, labeled X and Y axes.
- Cards side by side (0–8) is off at 0. From 2 up it scales the current density so that many cards fit.
- Met is the earliest logged visit that is not in the future, including after an edit or delete. Met With is unchanged. A future visit does not move Met.
- New RV is one dialog: Man or Woman, and an optional name that is not prefilled. A blank name uses the gender in the title (`Man on Maple`).
- Hub is singular. One row of equal-width chips shares the field. Adding a hub uses a vault file suggester, not a Dataview query. The first launch of 1.3.4 fills a missing Status from Priority and renames `**Hubs:**` to `**Hub:**`. It does not guess Gender or overwrite Study.
- Extras sync is pinned to tag `v1.3.4` on `raw.githubusercontent.com`. This build does not create that git tag and does not retarget the download to `v1.3.3` or any older tag, `main`, or `unstable`.

## 1.3.3

`main.js` SHA-256: `e936d328ffd42f8b268b6f05e336cf5c1ecfda8a5ca07b65841d6f1528debd86`

`styles.css` SHA-256: `6a457a14b431ea5ff0830769320307e89b50dd9e127643e6e917440e24f9750e`

`manifest.json` SHA-256: `b9217f012e9b6d04c3d68504b3ceae63d0ba75c20c35b11cb9b721cebdc916c4`

- The four visit buttons are icons on one line: `door-open` (Home), `door-closed` (Not home), `rotate-ccw-clock` (Log past visit), and `archive` (Archive). Hovering shows the name on desktop. Holding a button on a phone shows the name and does not press it. When Obsidian's icon set has no `rotate-ccw-clock`, it is drawn from `history`, the same arrow around a clock. The first launch of 1.3.3 rewrites the four button blocks on existing notes and keeps their other keys.
- The buttons start at the theme accent and get darker in three equal steps of apparent brightness (mixed toward black in OKLab).
- The map pin sits exactly under the Hub plus button. The plus button uses the same dark grey as the Hub item and the Address box.
- Urgency colors can be changed in Settings → Urgency and in a new setup wizard step: Traffic light (the default, unchanged), Pastel traffic light, Pastel purple, Pastel green, Pastel blue, Pastel pink, Color-blind safe, Sunset, and Theme accent. A strip beside the dropdown previews the four levels. Each level has its own color picker. Changing one switches to Custom.
- Settings → Everyday → RV note layout has three center-align toggles, one each for the RV Dashboard, the visit notes, and Return Suggestions.
- The Attempt Log table reads Mor, Aft, and Eve by default. **Short daypart names** turns the full names back on and rewrites every digest.
- **Attempt Log width** is Automatic, Full width, or Dashboard column. Automatic is full width when the digest table has days as columns. A table wider than its box now scrolls instead of being cut off.
- The date on each Attempt Log line is set small, like a `#####` stamp.
- Log past visit starts at 10am, or 10am yesterday when it is still before 10am.
- Extras sync is pinned to tag `v1.3.3` on `raw.githubusercontent.com`. This build does not create that git tag and does not retarget the download to `v1.3.2` or any older tag, `main`, or `unstable`.

## 1.3.2

`main.js` SHA-256: `17336eea02d19406e9971583c7d82f63295610740cbf23fd87df1cc857414dbc`

`styles.css` SHA-256: `2f36443d9d9711f4821583b74202a0aba56c99339767a536b11cf792927e57f2`

`manifest.json` SHA-256: `9a5814fd7cd25d6d80fa7beb536e8aa48988881826046e115d1d688761a985d5`

- Log past visit backfills a visit you forgot to log. It is a button in the note, a choice on the card's priority badge, and a command. It asks Home or Not home, the day, and the approximate hour, and for a Home who was taken. The `#####` stamp and the Attempt Log line are placed by time, so an older visit sits above a newer one. Visits and Successful Visits go up, Last Attempted and Last Spoke move only when the visit is newer, and the companion is added to Taken. A time later than now is refused.
- Each `#####` stamp and each Attempt Log line (including Not home) has an ellipsis in Reading view with Edit visit and Delete visit. Delete removes the stamp, its notes box and its `sVisitNNotes` property, the log line, and what the visit added: Visits, Successful Visits, Last Attempted and Last Spoke (moved back to the latest remaining visit), and its companion on Taken (kept while another visit records them or they are Met With). Edit changes the outcome, day, hour, or companion the same way, and keeps the notes box when a Home stays a Home. Met and Met With are never changed. The command *Edit or delete a visit* lists the note's visits, for Live Preview.
- Home log lines now record the companion: `— success with Devin`. New RV, the priority badge, and `rvLog.js` all write it. Older lines without a name still count.
- Archive sets Priority to 0 after a confirmation. It is a button in the note, a choice on the priority badge, and a command.
- After Home or a past Home is logged, the note opens when you started from the card, and the caret is put at the end of the new notes box. Logging from the note's buttons does the same. On iOS the keyboard may stay down, because the focus does not come straight from a tap.
- Visit notes boxes are one line tall when empty, grow while you type up to five lines, and then scroll. Every open refits each box, so a box left tall on a phone shrinks on a wider screen.
- The note has four buttons, two per row, spanning the dashboard column. Log past visit and Archive use the Not home style for now. The first launch of 1.3.2 adds the two new buttons to existing notes.
- The 🗺️ link beside Address is drawn as a map-pin button with the same size and box as the Hub plus button, directly under it. The note still stores the 🗺️ link, so it works without the plugin.
- Extras sync is pinned to tag `v1.3.2` on `raw.githubusercontent.com`. This build does not create that git tag and does not retarget the download to `v1.3.1` or any older tag, `main`, or `unstable`.

## 1.3.1

`main.js` SHA-256: `7c9abe40c2458366bbf0d86b95ae0bac0ccfcab226378c9f89677bc692a709bb`

`styles.css` SHA-256: `32a0f80cc10711aba17f155428f3f688c8bcdfd3726b978aa0c77f58a287828d`

`manifest.json` SHA-256: `f5ff8c489e17228ee78684b09f606f9550c607ef04a0e7730436b5f6ddde74d5`

- Return Suggestions voice agrees with the table. Before, the voice read only May-go-out slots, so attempts in an Off slot (such as Tue evening at 2/3) were ignored and the rest of that day was listed as `Untried: Tue`. Every slot with an attempt is now classified as Try, Unsure, or Avoid. Untried lists only May-go-out slots with no attempts (`Untried: Sun · Tue morning/afternoon · …`). With no May-go-out days, attempted slots are still voiced above `No May-go-out days`. May-go-out-only tables also show those attempted slots. The first launch of 1.3.1 rewrites every digest.
- The companion chosen on New RV create is Met With (who was there when first meeting the householder) and the first Taken entry. Later Home visits append to Taken only and never change Met With, even when it is blank. Met is unchanged.
- RV Dashboard is `> [!quote] RV Dashboard` with no fold mark, so it cannot be collapsed. The first launch of 1.3.1 drops a `+` or `-` from existing notes, and Home / Not home writes keep it off. Quick Facts and Attempt Log stay collapsible and collapsed by default. Return Suggestions stays without a fold mark.
- The dashboard reads as one column. The Hub item and the Address box share one width (long hub names are cut with an ellipsis), the 🗺️ link sits under the Hub plus button, and Quick Facts and the Attempt Log callout (with its table) end at that same right edge.
- Extras sync is pinned to tag `v1.3.1` on `raw.githubusercontent.com`. This build does not create that git tag and does not retarget the download to `v1.3.0`, `v1.2.12`, or any older tag, `main`, or `unstable`.

## 1.3.0

`main.js` SHA-256: `e52cb49955626de282e1d89cbcc8b328279bc2b09a9bc6264412880020253874`

`styles.css` SHA-256: `5aee4419910777bc813da0cfc5faa5a48db7d48aba2788fbcbe34bce77734b16`

`manifest.json` SHA-256: `07aba24956d964737ffd532d3b6243e26b8373a871ee9634171c55535ba8ab45`

- The `x days ago` label beside each visit stamp is recomputed on screen whenever a note is opened, when the active pane changes, and every few seconds while a note is open, in Reading view and Live Preview. The file is not rewritten for it. Home and Not home still write the current age into the file.
- An age of zero days reads `Today`, in the plugin, `newRv.js`, and `rvLog.js`.
- With Return Suggestions color on Automatic, an accent change recolors Return Suggestions on every RV note to the nearest callout type. Open notes change at once. The vault rewrite waits until the accent reads the same twice in a row, a few seconds apart, so a half-loaded theme does not trigger it. The last type written is saved, so an accent changed while Obsidian was closed is caught on the next launch.
- Visit notes are Meta Bind textAreas. The new RV template puts `INPUT[textArea:sVisit1Notes]` under the first `#####` stamp, and each Home adds the next `sVisitNNotes` box under its stamp (one past the highest number already on the note). Plain-text notes under older stamps are left alone.
- RV notes (cssclass `rv-dashboard`) open in Reading view. Everyday → Open RV notes in Reading view turns that off. Only the first open of a file in a pane is switched, so choosing editing afterwards is kept until the note is opened again. A new note switches once Templater has finished writing it. Because notes are typed into Meta Bind boxes in Reading view, tapping a callout no longer reveals its source.
- One empty line sits between the frontmatter and RV Dashboard. The first launch of 1.3.0 adds it to existing RV notes, and later writes keep it.
- The dark box around Hubs and Address is gone. Only the Address text box, the Hub list items, and the Hub plus button are darkened. The map link sits next to the Address box again.
- Hubs and Address still line up, closer to their labels (a 4.3em label width instead of a 5.6em column).
- Not home is a dark shade of the theme accent (about a third of its lightness; a blue accent gives dark navy) with light text. Home and Not home share the same border and box so they are the same size.
- Extras sync is pinned to tag `v1.3.0` on `raw.githubusercontent.com`. This build does not create that git tag and does not retarget the download to `v1.2.12`, `v1.2.11`, `v1.2.10`, `v1.2.9`, `v1.2.8`, `v1.2.7`, `v1.2.6`, `v1.2.5`, `v1.2.4`, `v1.2.3`, `v1.2.2`, `v1.2.1`, `v1.2.0`, `v1.1.5`, `main`, or `unstable`.

## 1.2.12

`main.js` SHA-256: `be1a3534cf6525ed5c618b4113e587d822b4419fb192be217d91ea15d0372641`

`styles.css` SHA-256: `bfd29df9678802b039f73a2be133c9e8d563c385845cf8741c2aa900893c6cb9`

`manifest.json` SHA-256: `4748980aa201eeb4a9bbcca1b1b3e52e0de2a6669cdd6f625f4c15cb58b7bfac`

- The all-weekdays digest table (the default) shows `homes/trials` or `0/0` in every cell, including days that are not May go out. An em dash remains only when Show every weekday is off, and only for a daypart that is not May go out. Voice lines still name May-go-out slots only.
- A new RV note matches the created-note layout. The outer callout is an expanded `> [!quote]+ RV Dashboard`. Hubs, Address, and the Home / Not home buttons sit in it. Quick Facts is a nested collapsed `> [!rv]-` callout. `### Visit Notes:` and a `#####` stamp follow, then Return Suggestions with Attempt Log nested inside it (table, then bullets). Meta Bind button blocks stay at the bottom. Home and Not home write `#####` stamps and nested bullets, and the first launch of 1.2.12 rewrites existing suggester / Attempt Log regions into that shape.
- Return Suggestions color follows the theme accent by default (blue info, green success, yellow/orange warning, red failure, dark red danger, red/purple bug, purple example, grey quote). Everyday → Return Suggestions color is a list of those color names, plus Automatic. Changing it, or the accent while Automatic is on, rewrites `> [!TYPE] Return Suggestions` on every RV note.
- The Not home button and the Address / Hub inputs inside the dashboard quote callout are darker than the quote background. Hub and Address inputs share a label column so they left-align. Callout icons are hidden on notes with `rv-dashboard`, and the titles shift left.
- Live Preview still reveals callout source when the caret enters that block. Obsidian does not expose an API to keep a callout rendered while it is being edited, so this build does not pretend to lock it. Visit notes stay outside the callouts.
- Extras sync is pinned to tag `v1.2.12` on `raw.githubusercontent.com`. This build does not create that git tag and does not retarget the download to `v1.2.11`, `v1.2.10`, `v1.2.9`, `v1.2.8`, `v1.2.7`, `v1.2.6`, `v1.2.5`, `v1.2.4`, `v1.2.3`, `v1.2.2`, `v1.2.1`, `v1.2.0`, `v1.1.5`, `main`, or `unstable`.

## 1.2.11

`main.js` SHA-256: `710258228234998c4341b7b3e19eee69eb20e0b4543456b3bc4383a80e534435`

`styles.css` SHA-256: `3d9383c34dabf50aa914e2b2150aabedbd8149ad12010a3fa9301f68287c71f8`

`manifest.json` SHA-256: `e9f9549c2eaf03ebbc99b429f814f73a9fab3d1fd2d396885c3dcdf801d4cae1`

- Attempt Log order is notes and the `###` stamp, then the suggester quote alone, then the collapsed Attempt Log. The daypart table is the first block inside the callout, above the bullets. It is not left outside the callout.
- Visible digest markers are gone. `%% rv-locator-digest %%` still showed in Live Preview, and HTML comments made Obsidian treat the table as raw source. The callout is the rewrite boundary: the voice quote is the blockquote on the callout, and the table is the leading `|` rows inside it. The first launch of 1.2.11 strips old `%%` and HTML markers and rewrites existing notes into that shape. New notes, `newRv.js`, and `rvLog.js` match. An opened Attempt Log is collapsed once. A later Home or Not home leaves a `+` or `-` the note already has.
- The digest table lists all seven weekdays by default. A day that is Off shows an em dash. Everyday → Show every weekday turns that off and lists only May-go-out days, which is the previous table. The suggester still names May-go-out slots only.
- A new RV note matches the created-note layout. Home and Not home buttons sit above the collapsed `[!rv]-` dashboard. A rule, the `###` stamp, a blank notes line, and another rule follow. The suggester quote is under that second rule. The seven-day table starts inside the collapsed Attempt Log, above the first bullet. A later Home stamp stays above the notes rule. Existing notes are not rewritten just to add those rules.
- Extras sync is pinned to tag `v1.2.11` on `raw.githubusercontent.com`. This build does not create that git tag and does not retarget the download to `v1.2.10`, `v1.2.9`, `v1.2.8`, `v1.2.7`, `v1.2.6`, `v1.2.5`, `v1.2.4`, `v1.2.3`, `v1.2.2`, `v1.2.1`, `v1.2.0`, `v1.1.5`, `main`, or `unstable`.

## 1.2.10

`main.js` SHA-256: `ea9ee85d832e81fb918fc6239f129d7678d0debb79180f3d77b8a40a06d20ee9`

`styles.css` SHA-256: `3d9383c34dabf50aa914e2b2150aabedbd8149ad12010a3fa9301f68287c71f8`

`manifest.json` SHA-256: `9ed6a846b80f5dd66803bdbfc76c8a49ac7bc9fbb332354c9114c55e8a6a1a24`

- Glancable urgency marks are heavy again, the same visual weight as the priority digit. `!`, `!!`, and `!!!` are thick stems with a round dot, sized from `--rv-control-size` (0.7 of the circle) so they scale with general density. The map pin uses the same stroke weight as that digit (`0.08` of the control size). Band 0 (urgency at least 0 and under 1, priority at least 1) is still the green circle, and it now draws an inner ring in place of the bangs. That ring uses the same stroke weight. Priority 0 stays a faint grey stack with no inner mark.
- The Attempt Log digest renders as a live table and a blockquote. HTML comments were the problem: Obsidian treats `<!-- rv-locator-digest -->` … `<!-- /rv-locator-digest -->` as one HTML block and shows the table and the quote as raw source. Markers are now same-line `%% rv-locator-digest %%` comments, with a blank line before the table, so Live Preview and Reading view render the table and the suggester quote. The order is unchanged: table, then the quote, then the Attempt Log callout. The first launch of 1.2.10 rewrites old HTML-comment digests into that shape.
- New Attempt Logs stay collapsed (`> [!note]-`). The Glancable priority pill and the note's Home / Not home buttons (`rvLog.js`) both create that `-` form. The 1.2.10 polish collapses an opened or unmarked Attempt Log once. A later Home or Not home leaves a `+` or `-` the note already has.
- Each `###` visit stamp gets a small muted age, such as `54 days ago` or `0 days ago`, from calendar days since that stamp. It is plugin text in `<span class="rv-stamp-ago">`, not Dataview. Creating a note, logging Home, and the polish pass all write or refresh it. Not home refreshes ages already on the note.
- The Glancable sort row scrolls horizontally while the Bases top bar is still on, both in a hub note that embeds the `.base` and when the `.base` file is open. The toolbar was widening the host past the visible width and clipping the chip scrollbar. The host is constrained so the chip row is the visible width. Hiding the whole bar is not required.
- Extras sync is pinned to tag `v1.2.10` on `raw.githubusercontent.com`. This build does not create that git tag and does not retarget the download to `v1.2.9`, `v1.2.8`, `v1.2.7`, `v1.2.6`, `v1.2.5`, `v1.2.4`, `v1.2.3`, `v1.2.2`, `v1.2.1`, `v1.2.0`, `v1.1.5`, `main`, or `unstable`.

## 1.2.9

`main.js` SHA-256: `4534c97700c56d7e9053759ea01ebb5051422d7e8efd8dcd6e2ee4e33e616e43`

`styles.css` SHA-256: `02eea5dbbd5f0fbc3bce1c647fb258a8a4a8306a4bc54725f1c8b004800bad9a`

`manifest.json` SHA-256: `9e0b1a269fdf7579fef7fcc5694df24beff9e73d7c8372fcfe543820ca215466`

- Glancable urgency marks render again. Bands 1–3 are real SVG nodes in the card's document (`createSvg`, or `createElementNS` on that document). Each bar and dot sets `fill: currentColor` inline, and the glyph has a definite size from `--rv-control-size` (not a percentage of a viewBox-only flex item). Band 0 stays the circle border. The same DOM checks accept either `instanceof` or Obsidian's cross-window `instanceOf`.
- Urgency, priority, and map circles use a thin stroke (`1.25px` times the card scale) and a light same-hue tint. `!`, `!!`, `!!!`, the priority digit, and the map pin sit inset inside the ring. Band 0 is that same ring, with no second inner circle. Priority 0 stays a faint grey stack. Circle size, glyph, pin, slot icons, and the Glancable New button follow the general scale.
- The Attempt Log note order is the daypart table, then the suggester as a blockquote (`Avoid`, `Try`, `Unsure`, `Untried`), then the callout. The callout holds only the dated bullets and starts collapsed (`> [!note]-`). A rewrite leaves an existing `+` or `-` alone. Home and Not home still update the table and the buckets and append the bullet inside the callout. A home stamp is inserted above the digest block. The first launch of 1.2.9 moves an older in-callout digest out. The Attempt Log callout is styled with the same muted surfaces as the RV Dashboard.
- Bucket math is unchanged at the defaults (Try at soft rate 0.42 with at least one home, Avoid at soft rate 0.30 with at least 3 trials, empty Try omitted, worst Avoid and best Try bold). Those four knobs are sliders under Advanced → Attempt Log suggester. The copy says the defaults are a baseline for an individual return style, not a perfect method. Changing them rewrites RV digests.
- Sort chips stay on one row. Only the chip row scrolls; the plugin New button stays put. Enabled chips show in this order: Ideality (beta), Urgency, Nearest, Priority, Spoke, Attempted, Met. Ideality's sort label and settings heading carry a beta tag. Ideality still starts off.
- Advanced → Glancable Bases bar can hide the Bases top bar, and separately the view switcher, sort, filter, properties, search, New, and code (`</>`). The master bar toggle is off. Bases New is hidden while Glancable is the active view. The rules apply only on that leaf or embed, and they come off when Glancable unloads.
- Extras sync is pinned to tag `v1.2.9` on `raw.githubusercontent.com`. This build does not create that git tag and does not retarget the download to `v1.2.8`, `v1.2.7`, `v1.2.6`, `v1.2.5`, `v1.2.4`, `v1.2.3`, `v1.2.2`, `v1.2.1`, `v1.2.0`, `v1.1.5`, `main`, or `unstable`.

## 1.2.8

`main.js` SHA-256: `2052fd682d2922669088feab2ca2dfa8e438e47c4927fda795037b702644b4e1`

`styles.css` SHA-256: `7e6c7a2ea9d0fecdadda79d55b0ab6409c20ebcc1c983f3ad1f4d3fecdf8f19a`

`manifest.json` SHA-256: `48d2b6f75a8bb0811233d6ea1b9dba47b79f27b740f8fd83600d0859125cc220`

- Glancable urgency, priority, and map controls (Active, All, and Inactive Nearby cards) use a thicker circle. The stroke, a soft same-hue fill, and the glyph share the urgency color. Priority 0 stays a grey outline with the same grey tint. Bang marks for urgency 3/2/1 are drawn as short heavy bars, not a thin system-font exclamation. The low-urgency mark stays a ring of the same stroke weight. The left accent stripe is unchanged.
- Attempt Log table and the four bucket lines stay inside the collapsible callout body. Collapsing the header hides them. The first time 1.2.8 loads, a header that still uses the old collapsed default (`> [!note]- Attempt Log`) is opened (`+`). A header collapsed after that stays collapsed. New logs and the New RV template start open. Home and Not home still append inside whatever fold sign is already on the note.
- The dated Home / Not home list under the Attempt Log table is no longer written. The visit bullets stay. The first launch rewrites each RV note's digest so that list is removed. Template notes are not given a schedule digest.
- Bucket lines under the table are Avoid, then Try, then Unsure, then Untried. Empty lines are still omitted, including an empty Try line. The worst Avoid slots are bold the same way the best Try slots are, and a tie bolds every slot at that soft rate. Membership rules are unchanged.
- The digest table still defaults to days of the week down the side and Morning, Afternoon, and Evening across. A saved Swap rows and columns choice (`columns`) is kept. That swap is the only way plugin data stores `columns`.
- Extras sync is pinned to tag `v1.2.8` on `raw.githubusercontent.com`. This build does not create that git tag and does not retarget the download to `v1.2.7`, `v1.2.6`, `v1.2.5`, `v1.2.4`, `v1.2.3`, `v1.2.2`, `v1.2.1`, `v1.2.0`, `v1.1.5`, `main`, or `unstable`.

## 1.2.7

`main.js` SHA-256: `8ce28f6b8358e3bf7e8674d02eaf3281929a6cf2be85334a6bc10f40565f5ff1`

`styles.css` SHA-256: `86a371ea59d1c17b519c485572b1e452b34509c4356cb57330bce5a845596a24`

`manifest.json` SHA-256: `6e978085c3d8df3478d849323689392ad127c146f6915f7ea8383be9a0ad82a2`

- Glancable urgency, priority, and map controls are thin outlined circles. The stroke and the glyph use the same urgency color. Priority 0 stays a grey outline. The left accent stripe is unchanged.
- The street on a card uses the small muted date type. The city is white and bold again. Distance stays urgency-tinted.
- Creating a New RV writes the May-go-out digest between `<!-- rv-locator-digest -->` markers from the current Everyday schedule, including its row/column orientation. The New RV template already carries those markers under Attempt Log. `newRv.js` asks the plugin to fill them after Templater finishes the note. Changing the schedule or the orientation still rewrites every RV note and still skips the templates folder.
- The digest counts Home and Not home from Attempt Log timestamps (weekday and daypart). A `###` stamp counts as Home only when its bullet is missing. Dated Home / Not home lines are listed under the table. A stale `0/0` table inside the markers is not treated as attempt history.
- Priority check asks on every Nth Home only (`priorityNudgeEvery`, default 3). Not home never asks. The first ask is Home number N, then every N Homes after that.
- The digest footer is four lines, and empty ones are left out: Try (soft rate at least 0.42 and at least one home, best ties in bold), Untried (trials 0, a whole weekday when every May-go-out daypart is still open), Unsure (1–2 trials, or 3+ trials with soft rate between 0.30 and 0.42), Avoid (3+ trials and soft rate at most 0.30). Soft rate is `(homes + 1) / (trials + 2)`.
- Extras sync is pinned to tag `v1.2.7` on `raw.githubusercontent.com`. This build does not create that git tag and does not retarget the download to `v1.2.6`, `v1.2.5`, `v1.2.4`, `v1.2.3`, `v1.2.2`, `v1.2.1`, `v1.2.0`, `v1.1.5`, `main`, or `unstable`.

## 1.2.6

`main.js` SHA-256: `34dde78319a01bbf620a5a6380f18a2cc03886c1d1dd7d35def7327e159eae07`

`styles.css` SHA-256: `88c24b63194e66bb519537f894e00f1c9a21a39d06af79af4d232ea8f5aac80f`

`manifest.json` SHA-256: `fe28b276046ba4d8418270ad5be1ce3f0a30148fdb8d1496f51626a2ae1f2f44`

- The ideality planner (view, toggle, command, and modal) is removed. It may return later. Ideality as a score, the hidden sort chip, home likelihood, territory span, and the priority floors stay.
- Re-geocoding a changed Address refreshes Location, Map Link, the body 🗺️ link, City, and the other derived place fields. A city or extra the new hit does not have is cleared. The map query uses the new hit’s city, not a previously stored City. Address is still never overwritten.
- Availability is Off or May go out. Dayparts are Morning (before 12pm), Afternoon (12pm–4:29pm), and Evening (after 4:30pm). A click toggles the cell. New installs start all Off. An untouched all-Willing grid from 1.2.4 becomes all Off. Any other Willing or Go out cell becomes May go out, and Morning is on when either old morning cell was on. Willing and Go out multipliers are gone.
- The Attempt Log digest is a compact table of only May-go-out days, stored under the callout title so it stays visible when the log is collapsed. Ratios are homes/trials for that daypart. Settings can swap rows and columns and edit the schedule. Changing the schedule or the orientation rewrites the digest on every existing RV note (files in the Templater templates folder are skipped) and on new notes. Avoid and try name dayparts, never a whole day. There is no Suggest button on the card.
- Urgency on the card is a circle the same size as priority and the map pin, stacked on the right. Below 1, with priority above 0, it is a green circle with ○. Then yellow `!`, orange `!!`, and red `!!!` (3 and above). Priority 0 stays grey. Card accents use that color. There is no separate colorblind mode. Under 3 days the score is the raw ratio times `(days / 3)` squared, so priority 5 at about 2 days stays well below 1. Tapping the circle snoozes urgency to 0 for today, 7 days, or 14 days.
- Every 3rd visit (configurable) asks whether to lower, keep, or raise priority. Stay is the primary button.
- The address line uses the same small muted type as the date lines. General scale (the old font-size multiplier) scales the card text and the three circles together.
- Settings are tabs: Everyday, Urgency, Nearby, Templates, and Advanced. Live graphs sit under the setting they describe, with labeled axes, and follow the theme.
- Extras sync is pinned to tag `v1.2.6` on `raw.githubusercontent.com`. This build does not create that git tag and does not retarget the download to `v1.2.5`, `v1.2.4`, `v1.2.3`, `v1.2.2`, `v1.2.1`, `v1.2.0`, `v1.1.5`, `main`, or `unstable`.

## 1.2.4

`main.js` SHA-256: `881bbfa5d28bbc449d220edb4d3b7a48ef41d168f858d2af8711e7aebed5b68a`

`styles.css` SHA-256: `b93519debd051e50c64ea3b73c3e6257b41e1c6de10765d2f1a2fc9fec36f300`

`manifest.json` SHA-256: `a543a3f707e6b930878072646dcaeea5a8246145979e0d51e14ab0b9979b0e9f`

- Urgency is days since Last Spoke divided by a priority threshold (P5 4, P4 7, P3 21, P2 63, P1 189, all configurable). Under 3 days, every priority fades toward 0. The value keeps growing past 1. Glancable shows `!` marks above the priority pill and map pin (1–3 plain, 4 bold, 5 bold and underlined) and paints the left accent from urgency. The priority number stays on the pill.
- Ideality is urgency times `(territory span / miles) ^ 0.555`. Territory span defaults to 15 miles and is not in the setup wizard. Each priority has a soft floor (P5 3d, P4 4d, P3 7d, P2 14d, P1 42d). The Ideality sort chip is off until enabled. Optional home likelihood (off) uses only the current weekday and daypart, with a 50% prior. The ideality planner (off, and idle until likelihood is on) holds distance at the territory span.
- New RV priority defaults to 4.
- Glancable density settings cover vertical and horizontal padding, max line length, a font-size multiplier, and a toggle for each card line. Two columns turn on when the measured card fits twice. Defaults keep today’s spacing.
- Sort chips can be hidden one by one. Nearest, Priority, Spoke, Attempted, and Met stay on. Urgency starts on. Ideality stays off.
- Attempt Log times bucket into weekday × daypart (early morning through 9:30, late morning until noon, afternoon until 4:30, evening after 4:30). Suggest return times, on the card and as a command, lists times to avoid, untried go-out slots, and the strongest score, with soft rates and counts. An empty log says there is not enough data. The availability grid is Off / Willing / Go out, with multipliers 1.0 and 0.65.
- Settings graphs redraw from the live urgency, ideality, floor, and likelihood numbers.
- Address is still never overwritten. Companions stay plain text. Lookups stay on `api-eu.geoapify.com`.
- Extras sync is pinned to tag `v1.2.4` on `raw.githubusercontent.com`. This build does not create that git tag and does not retarget the download to `v1.2.3`, `v1.2.2`, `v1.2.1`, `v1.2.0`, `v1.1.5`, `main`, or `unstable`.

## 1.2.3

`main.js` SHA-256: `9ca43507243b97e7d8da814de410232c7ab5a8168d0bbb8bc38cf40a0bbec967`

`styles.css` SHA-256: `73ae6077410bbfcc90b028749d6c4731a47d7dc15352dc80f0b96e02a47217c1`

`manifest.json` SHA-256: `1bc452f7468acd6075b0ca101271c0c581590c38e4d82bbe3c2f7aabc19ba2c8`

- The Link companions to notes setting is removed. A companion chosen after Home, or while creating a new RV, is still appended to Taken only, as plain text. Met With is left unchanged. Skip and Esc still leave both unchanged. Not home still does not ask. New writes do not create wikilinks, including when an older `linkCompanionsToNotes` value is still in plugin data. A wikilink Obsidian flattens into an unquoted `[[Name]]` or a nested list is still written back as `"[[Name]]"` so an existing link stays on the note. The plugin Home button and Meta Bind / Templater `rvLog.js` and `newRv.js` use that same plain-text write.
- The unfinished-setup notice follows the same required rows as setup wizard page 2. Geoapify is on that page, so a missing key cannot say Ready on the wizard and still show the notice. A blank Templater `templates_folder` or `user_scripts_folder` is Ready when the template or script files are already in the fallback folder (`Templates/` or `Scripts/`). Once those required gaps are empty, the notice stays down even if `setupWizardCompleted` was still false, and that flag is saved. Closing the wizard with Done also saves the flag, including when a gap remains. Empty home counties are still not a required gap. Don't remind me again is unchanged.
- Setup wizard page 2 scrolls inside the modal. Community plugins, Templater settings, Meta Bind settings, Update from GitHub, Check again, and Done are stacked so they stay visible on a typical desktop modal.
- Nearby and Glancable have a Met sort chip beside Nearest, Priority, Spoke, and Attempted. The first tap is Met · newest. Tapping it again is Met · oldest. Spoke and Attempted still start at oldest. A missing Met stays last, the same as a missing Last Spoke or Last Attempted. The choice is saved with the other chips.
- Extras sync is pinned to tag `v1.2.3` on `raw.githubusercontent.com`. This build does not create that git tag and does not retarget the download to `v1.2.2`, `v1.2.1`, `v1.2.0`, `v1.1.5`, `main`, or `unstable`.

## 1.2.2

`main.js` SHA-256: `0c1a8a07a1ee7cd11f124cff6f1f8860dc0cd097254891dbda5ef5188fd2a3b3`

`styles.css` SHA-256: `297f4aea57459d6e94146f54b1f42fe2f6e9ce10eb26d3e156f797ecf5c2def4`

`manifest.json` SHA-256: `bc4fe874c3fbcb4bcad74e9d9c5312bdc201c30e9eff7533ab81d0d536083c4f`

- A companion chosen after Home, or while creating a new RV, is appended to Taken only. Met With is the person at the door and is left unchanged. The same rule applies to the plugin Home button, Meta Bind / Templater `rvLog.js`, and New RV (`newRv.js` / `plugin.promptCompanion()`).
- Skip and Esc still leave Met With and Taken unchanged. Not home still does not ask. A name already on Taken is not added again.
- `linkCompanionsToNotes` still applies only to the Taken write: off stores plain text, and on stores `[[Note Name]]` when a note name or alias matches. A missing note stays plain text. It does not write Met With. A wikilink Obsidian flattens into an unquoted `[[Name]]` or a nested list is written back as `"[[Name]]"` so the link stays on the note. The plugin Home button and Meta Bind / Templater `rvLog.js` use that same helper.
- Home no longer skips a `###` stamp when that rounded-hour heading is already on the note. A second Home or Not home applies immediately: counts, timestamps, Attempt Log, and (for Home) another stamp. The plugin button and Meta Bind / Templater `rvLog.js` use the same rule. There is no setting that turns a time lock back on.
- The setup wizard starts with a home region step: the counties where you normally work return visits. A fully confident geocode hit in one of them can be saved without asking, which avoids a wrong-city pick. You can enter one or more counties, the same list as Home counties, or skip. Skip leaves the saved list unchanged. An empty list still always asks you to confirm. The wizard does not open again on its own after it has been closed. Settings → Open setup wizard includes the home-region step.
- Settings, the setup wizard, notices, and the bulk and visit prompts use shorter copy. The rules are the same: Address is never overwritten, empty home counties always ask you to confirm, and lookups use Geoapify’s EU endpoint.
- Opening Glancable or a Nearby view shows one notice while setup is unfinished: the wizard has not been closed, or a required step is still missing (Geoapify key, Templater, Meta Bind, template folder, script folder, or the template and script files). Empty home counties do not keep that notice up after the wizard is closed. The notice stays up for 12 seconds and has Open setup wizard and Don't remind me again. Don't remind me again stores `setupIncompleteNudgeDismissed` for this vault and does not mark setup complete. The notice stops on its own once setup is complete.
- The New RV quote strip puts exactly six spaces after `**Hubs:**` and before the Meta Bind input, so that box lines up with the Address input. The Address line is unchanged. Extras sync ships this in `99 New RV.md`.
- Changing New RV, Home log, or Not home log file name renames that note inside Templater’s template folder. The + button uses the new New RV name. If the new name is already a file there, the old file stays and the setting stays on the old name. If the old file is missing and the new one is already there, the setting is kept. If neither file is there yet, the setting is saved and extras sync can create it later. A half-typed or unsafe name does not rename. Home and Not home renames also update Meta Bind `templateFile:` lines in the vault that still use the old path, including the New RV template and existing RV notes.
- Extras sync is pinned to tag `v1.2.2` on `raw.githubusercontent.com`. This build does not create that git tag and does not retarget the download to `v1.2.1`, `v1.2.0`, `v1.1.5`, `main`, or `unstable`.

## 1.2.1

`main.js` SHA-256: `ec450c11a15b2eafdb3591434a1faa6c8f9bb13b8495f68c58772364fa158fe9`

`styles.css` SHA-256: `01b4eeb6d6ce8cd574f04addcce67588097a173f129482156ded49c33df852de`

`manifest.json` SHA-256: `79d2acdeaefffa5d7e640c6ae1c88daddae8c59a725767b33bbf931087fc4c32`

- Choosing a companion on Home or New RV now writes Met With and appends that name to Taken. Obsidian closes the suggest modal before it reports the chosen row, and the companion prompt treated that close as Skip, so the visit logged with Met With and Taken left empty. A suggestion or a typed “Use …” name is kept. Skip and Esc still leave both unchanged. Not home still does not ask. Address is still never overwritten.
- `linkCompanionsToNotes` is unchanged: off stores plain text, and on stores `[[Note Name]]` when a note basename matches.
- Extras sync stays pinned to tag `v1.2.1` on `raw.githubusercontent.com`. This build does not create that git tag and does not retarget the download to `v1.2.0`, `v1.1.5`, `main`, or `unstable`.

## 1.2.0

`main.js` SHA-256: `b4ce00b7ec35becce569b067cfd1740f076a68859a0c3d8228a9772b6901ac32`

`styles.css` SHA-256: `01b4eeb6d6ce8cd574f04addcce67588097a173f129482156ded49c33df852de`

`manifest.json` SHA-256: `093f36e876f0798394a59f21f8afc9846e35aa9185bdda69be347a0e626cbc25`

- New RV asks for one companion after the householder and Address. The suggester lists recent companions and accepts a new name. That name is written to Met With and appended to Taken, deduped. Cancel or a blank answer leaves both blank. Home (Meta Bind → `rvLog.js`, and the Nearby / Glancable success tap) asks the same question. Not home does not ask.
- Recent names come from markdown notes’ Met With, then Taken. Wikilinks use the alias, otherwise the note basename. Notes are ordered by the latest of Last Spoke, Last Attempted, Met, and the file modification time. The same person is listed once (case-insensitive). The list is capped at 24.
- `linkCompanionsToNotes` (default off) stores `[[Note Name]]` when one vault note’s basename matches. Several matches use the path form. No match stays plain text. There is no prefix or suffix setting. The same form is used for Met With and the Taken append.
- New notes default to Priority 3. `defaultNewRvPriority` is an integer 0–5 (default 3) and is what New RV writes.
- Template file names are settings: `newRvTemplateFile` (`99 New RV.md`), `homeLogTemplateFile` (`99 RV Log Home.md`), `missLogTemplateFile` (`99 RV Log Miss.md`). Extras sync writes those names into Templater’s `templates_folder` and the scripts into `user_scripts_folder`. Empty Templater folders fall back to `Templates/` and `Scripts/`. The + button looks up the configured New RV name in the Templater folder, then `New RV.md`.
- Syncing New RV rewrites the Meta Bind `templateFile:` paths only inside the fetched `extras/templater-metabind/New RV.md` body, and only when those paths stay inside the templates folder. A body that still points outside that folder is not written. Documentation files and `rv-dashboard.css` are not in the download list. The pin stays tag `v1.2.0` on `raw.githubusercontent.com`. This build does not create that git tag and does not retarget the download to `v1.1.5`, `main`, or `unstable`. Update from GitHub works after the tag exists. Template names are basenames on an allowlist. Folder names are vault-relative allowlisted segments (`+/Templates` is accepted). `..`, backslash, and absolute paths fall back to `Templates/` and `Scripts/`.
- The setup wizard checks that Templater and Meta Bind are enabled, shows the Templater folders, and can place extras after you confirm. It opens Settings. It does not install or enable community plugins, and it does not turn on the Meta Bind JS Engine or Templater system commands. It runs once until dismissed; Settings can open it again.
- A new `###` visit stamp has two blank lines before Attempt Log, so there is a line of padding for notes.
- The City property helper text matches the writer: geocode always writes `City`. An empty City-property setting only skips the optional alias.
- `.lock-assemble/` is no longer in the tree. Address is still never overwritten. Map Link is still a Google Maps address search, and City is still appended to that query when Address has no city.

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
