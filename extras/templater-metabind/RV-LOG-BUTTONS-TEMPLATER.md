# RV log buttons — Templater full parity (plugin 1.1.3)

Requirements: **Templater** (user scripts enabled) + **Meta Bind**.

Does **not** change `Address`. Matches the plugin priority-tap logger:

- **Home:** Visits++, Successful Visits++, Last Spoke + Last Attempted (local ISO), then a callout bullet (`— success`, or `— success with Devin` when a companion is chosen). A Glancable `##### Wed, 2pm — Sep 9, 2026` heading (weekday, nearest hour, calendar date) is inserted under `### Visit Notes:` on every Home, including a second Home in the same rounded hour.
- **Not home:** Visits++, Last Attempted only, callout bullet `— not home`. No stamp. A second Not home immediately after the first still logs.

Attempt Log is a collapsed callout, nested under Return Suggestions after the plugin rewrites the note. The daypart table is the first block inside the log, then the dated bullets. The plugin writes that table and the suggestions callout. The note has no digest marker lines.

```markdown
> [!example] Return Suggestions
> Try: **Wed afternoon (1/1)**
>
> > [!note]- Attempt Log
> >
> >- Wed, 2pm — Sep 9, 2026 — success
```

The script also recognizes `> [!note]+ Attempt Log`, `> > [!note]- Attempt Log`, `> [!note] Attempt Log`, and tight forms such as `>[!note]+ Attempt Log`. A `+` or `-` already on the note stays. If the note still has the old `## Attempt Log` heading, the next Home or Not home write migrates that section into the collapsed callout and appends there. The plugin's first launch of 1.2.12 or later wraps the suggester and the log in Return Suggestions, nests the log, strips old `%%` and HTML digest markers, and collapses an opened Attempt Log once. Home and Not home also refresh the muted age (`Today` on the day) and promote a `###` visit stamp to `#####`. Home writes a Meta Bind `INPUT[textArea:sVisitNNotes]` line under the new stamp, numbered one past the highest `sVisitNNotes` already on the note. Plain-text notes under older stamps are left as they are. 1.3.0 also adds one empty line between the frontmatter and RV Dashboard.

`New RV.md` already includes these buttons. Paste the blocks below only when you are adding them to an older note.

## Setup

1. Copy `rvLog.js` into your Templater **User Scripts** folder (Templater settings → User Script Functions).
2. Copy `RV Log Home.md` and `RV Log Miss.md` into a Templates folder in the vault. The button paths below use `Templates/`.
3. Reload Templater (or restart Obsidian) so `tp.user.rvLog` appears.
4. Paste the button blocks into your RV template / notes, then add:

`BUTTON[rv-log-home, rv-log-miss, rv-log-past, rv-archive]`

(The `BUTTON[…]` line must be wrapped in backticks so Meta Bind renders real buttons instead of raw text.)

The script creates `> [!note]- Attempt Log` at the bottom when the note has neither that callout nor a legacy `## Attempt Log` heading. A home stamp is inserted above Return Suggestions, or above the suggester quote on an older note. A `---` that sits on that block stays under the new stamp.

## Meta Bind buttons (`runTemplaterFile`)

Adjust `templateFile` if your Templates path differs. `New RV.md` uses these same paths.

~~~meta-bind-button
label: ""
icon: door-open
tooltip: Home
style: primary
class: rv-visit-btn
id: rv-log-home
hidden: true
actions:
  - type: runTemplaterFile
    templateFile: Templates/RV Log Home.md
~~~

~~~meta-bind-button
label: ""
icon: door-closed
tooltip: Not home
style: default
class: rv-visit-btn
id: rv-log-miss
hidden: true
actions:
  - type: runTemplaterFile
    templateFile: Templates/RV Log Miss.md
~~~

Log past visit and Archive run RV Locator commands, so they need the plugin enabled:

~~~meta-bind-button
label: ""
icon: rotate-ccw-clock
tooltip: Log past visit
style: default
class: rv-visit-btn
id: rv-log-past
hidden: true
actions:
  - type: command
    command: rv-locator:log-past-visit
~~~

~~~meta-bind-button
label: ""
icon: archive
tooltip: Archive
style: default
class: rv-visit-btn
id: rv-archive
hidden: true
actions:
  - type: command
    command: rv-locator:archive-rv
~~~

Inline row:

`BUTTON[rv-log-home, rv-log-miss, rv-log-past, rv-archive]`

From 1.3.2 the plugin adds the two new buttons to older notes that still have `BUTTON[rv-log-home, rv-log-miss]`, once, on its first launch.

From 1.3.3 the four buttons are icons on one line: `door-open` (Home), `door-closed` (Not home), `rotate-ccw-clock` (Log past visit), and `archive` (Archive). The label is empty and `tooltip` names the button. With the plugin on, hovering shows that name on desktop and holding the button shows it on a phone without pressing it. The plugin rewrites these four blocks on older notes once, on its first launch. Other keys in the blocks, such as `templateFile`, are kept. When Obsidian's icon set has no `rotate-ccw-clock`, the plugin draws it from `history`, the same arrow around a clock.

## Standalone Templater (no Meta Bind)

Run template `RV Log Home` / `RV Log Miss` on the open note, or from any Templater script:

```
await tp.user.rvLog(tp, "home")
await tp.user.rvLog(tp, "miss")
```

## vs plugin

Use the plugin priority tap from Nearby Glancable/Vanilla. Use these buttons when you are already inside the note. Frontmatter and Attempt Log bullets match the plugin. Both Templater Home and the plugin priority tap insert a `###` stamp on every Home, including a second Home in the same rounded hour. Address is never written. No JS Engine.
