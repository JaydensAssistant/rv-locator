# New RV note — prompt for Address, then geocode

Templater only. **Meta Bind and the JS Engine are not required.**

The script may write `Address` when that property is still empty. After that, **RV Locator never writes Address**. It fills `Location` (two quoted strings), `City`, and `Map Link`.

## Setup

1. Copy `geocodeNewRv.js` into your Templater **User Scripts** folder (Templater settings → User Script Functions).
2. Reload Templater (or restart Obsidian) so `tp.user.geocodeNewRv` appears.
3. Enable **RV Locator** and set the Geoapify key. The command id is `rv-locator:geocode-current-note` (**Geocode current note**).
4. Put this in the New RV template (after any frontmatter you want on every new note):

```markdown
<%* await tp.user.geocodeNewRv(tp) %>
```

If RV Locator’s Address property is not named `Address`, pass the same name:

```markdown
<%* await tp.user.geocodeNewRv(tp, "Street Address") %>
```

## What it does

1. Reads Address on the note being created.
2. If Address is missing, asks with `tp.system.prompt("Address")`. Cancel leaves Address alone.
3. Waits until Templater has finished writing the note (`tp.hooks.on_all_templates_executed`), then writes Address **only if it is still empty**.
4. Focuses that note and runs `rv-locator:geocode-current-note`.

Geocode current note reads the file from disk, so an Address Templater just saved is visible even when Obsidian’s metadata cache has not caught up.

Leave Address out of the template frontmatter if you want the prompt to be the source of the address. If the template already has a non-empty Address, the script does not ask and does not replace it.

## Without the script

Set Address yourself (template or by hand), open the note, and run **RV Locator: Geocode current note**. That command does not prompt and does not write Address.
