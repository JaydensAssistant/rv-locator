# RV visit logging — Templater + Meta Bind (1.1.0 parity)

Jayden runs Templater. Use the Templater path for **full parity** with the plugin priority-tap logger.

| File | Role |
|------|------|
| `templater/rvLog.js` | User script (body + frontmatter; never writes Address) |
| `templater/RV Log Home.md` | Runs `tp.user.rvLog(tp, "home")` |
| `templater/RV Log Miss.md` | Runs `tp.user.rvLog(tp, "miss")` |
| `metabind/RV-LOG-BUTTONS-TEMPLATER.md` | Meta Bind buttons via `runTemplaterFile` |

## Parity table

| Behavior | Plugin | Templater `rvLog.js` | Meta Bind frontmatter-only |
|----------|--------|----------------------|----------------------------|
| Visits / Successful Visits / Last Spoke / Last Attempted | yes | yes | yes |
| Mid-note `## Weekday…` + blank notes (home) | yes | yes | **no** |
| Attempt Log bullet with display time | yes | yes | partial |
| Never write Address | yes | yes | yes |

See `metabind/RV-LOG-BUTTONS-TEMPLATER.md` for paste-ready buttons.
