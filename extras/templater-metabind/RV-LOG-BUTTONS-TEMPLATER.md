# RV log buttons — Templater full parity (plugin 1.1.3)

Requirements: **Templater** (user scripts enabled) + **Meta Bind**.

Does **not** change `Address`. Matches the plugin priority-tap logger:

- **Home:** Visits++, Successful Visits++, Last Spoke + Last Attempted (local ISO), then a callout bullet `> - … — success`. A Glancable `### Wed, 2pm — Sep 9, 2026` heading (weekday, nearest hour, calendar date) and a blank notes line are inserted **above** the Attempt Log on every Home, including a second Home in the same rounded hour.
- **Not home:** Visits++, Last Attempted only, callout bullet `> - … — not home`. No stamp. A second Not home immediately after the first still logs.

Attempt Log is a collapsed callout, not a `##` heading. The dated bullets are the only lines inside it. The daypart table and the suggester quote are written above the callout by the plugin.

```markdown
> [!note]- Attempt Log
> - Wed, 2pm — Sep 9, 2026 — success
```

The script also recognizes `> [!note]+ Attempt Log`, `> [!note] Attempt Log`, and tight forms such as `>[!note]+ Attempt Log`. A `+` or `-` already on the note stays. If the note still has the old `## Attempt Log` heading, the next Home or Not home write migrates that section into the collapsed callout and appends there. Existing notes are not bulk-migrated by the script. The plugin's first launch of this layout moves an older in-callout digest above the callout and leaves the fold as written.

`New RV.md` already includes these buttons. Paste the blocks below only when you are adding them to an older note.

## Setup

1. Copy `rvLog.js` into your Templater **User Scripts** folder (Templater settings → User Script Functions).
2. Copy `RV Log Home.md` and `RV Log Miss.md` into a Templates folder in the vault. The button paths below use `Templates/`.
3. Reload Templater (or restart Obsidian) so `tp.user.rvLog` appears.
4. Paste the button blocks into your RV template / notes, then add:

`BUTTON[rv-log-home, rv-log-miss]`

(The `BUTTON[…]` line must be wrapped in backticks so Meta Bind renders real buttons instead of raw text.)

The script creates `> [!note]- Attempt Log` at the bottom when the note has neither that callout nor a legacy `## Attempt Log` heading. A home stamp is inserted above the digest block when one already sits on the callout.

## Meta Bind buttons (`runTemplaterFile`)

Adjust `templateFile` if your Templates path differs. `New RV.md` uses these same paths.

~~~meta-bind-button
label: Home
style: primary
class: rv-visit-btn
id: rv-log-home
hidden: true
actions:
  - type: runTemplaterFile
    templateFile: Templates/RV Log Home.md
~~~

~~~meta-bind-button
label: Not home
style: default
class: rv-visit-btn
id: rv-log-miss
hidden: true
actions:
  - type: runTemplaterFile
    templateFile: Templates/RV Log Miss.md
~~~

Inline row:

`BUTTON[rv-log-home, rv-log-miss]`

## Standalone Templater (no Meta Bind)

Run template `RV Log Home` / `RV Log Miss` on the open note, or from any Templater script:

```
await tp.user.rvLog(tp, "home")
await tp.user.rvLog(tp, "miss")
```

## vs plugin

Use the plugin priority tap from Nearby Glancable/Vanilla. Use these buttons when you are already inside the note. Frontmatter and Attempt Log bullets match the plugin. Both Templater Home and the plugin priority tap insert a `###` stamp on every Home, including a second Home in the same rounded hour. Address is never written. No JS Engine.
