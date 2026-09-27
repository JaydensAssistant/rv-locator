# RV log buttons — Templater full parity (plugin 1.1.0)

Requirements: **Templater** (user scripts enabled) + **Meta Bind**.

Does **not** change `Address`. Matches the plugin priority-tap logger:
- **Home:** Visits++, Successful Visits++, Last Spoke + Last Attempted (local ISO), `## Wed, 2pm — Sep 9, 2026` (Glancable: weekday, nearest hour, calendar date) with a blank notes line above `## Attempt Log`, bullet `- … — success`
- **Not home:** Visits++, Last Attempted only, bullet `- … — not home`

## Setup

1. Copy `rvLog.js` into your Templater **User Scripts** folder (Templater settings → User Script Functions).
2. Copy `RV Log Home.md` and `RV Log Miss.md` into a Templates folder in the vault (example paths below use `Templates/`).
3. Reload Templater (or restart Obsidian) so `tp.user.rvLog` appears.
4. Paste the button blocks into your RV template / notes, then add:

`BUTTON[rv-log-home, rv-log-miss]`

(The `BUTTON[…]` line must be wrapped in backticks so Meta Bind renders real buttons instead of raw text.)

Keep one `## Attempt Log` heading near the bottom (the script creates it if missing).

## Meta Bind buttons (`runTemplaterFile`)

Adjust `templateFile` if your Templates path differs.

~~~meta-bind-button
label: Home
style: primary
id: rv-log-home
hidden: true
actions:
  - type: runTemplaterFile
    templateFile: Templates/RV Log Home.md
~~~

~~~meta-bind-button
label: Not home
style: default
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

Use the plugin priority tap from Nearby Glancable/Vanilla. Use these buttons when you are already inside the note. Body + frontmatter layout matches 1.1.0.
