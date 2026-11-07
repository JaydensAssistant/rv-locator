/**
 * New RV note: prompt for Address when it is missing, then geocode.
 *
 * Templater user script. Does not need Meta Bind or the JS Engine.
 * This script may write Address once, when that property is still empty.
 * RV Locator itself never writes Address.
 *
 * From a New RV template:
 *   <%* await tp.user.geocodeNewRv(tp) %>
 *
 * If the Address property in RV Locator settings is not "Address":
 *   <%* await tp.user.geocodeNewRv(tp, "Street Address") %>
 *
 * After the template finishes, this runs Obsidian command
 * rv-locator:geocode-current-note on the active note.
 */
const COMMAND_ID = "rv-locator:geocode-current-note";

function resolveFile(tp) {
  if (tp?.config?.target_file) return tp.config.target_file;
  if (tp?.file?.path) {
    const found = app.vault.getAbstractFileByPath(tp.file.path);
    if (found) return found;
  }
  return app.workspace.getActiveFile();
}

function unquote(value) {
  const text = value.trim();
  if (text.length >= 2) {
    const open = text[0];
    const close = text[text.length - 1];
    if ((open === '"' && close === '"') || (open === "'" && close === "'")) {
      return text.slice(1, -1).trim();
    }
  }
  return text;
}

function readAddressText(markdown, property) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return "";
  const wanted = property.trim().toLowerCase();
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    if (/^\s/.test(line)) continue;
    const found = /^([^:#][^:]*?)\s*:(.*)$/.exec(line);
    if (!found) continue;
    if (found[1].trim().toLowerCase() !== wanted) continue;
    return unquote(found[2] || "");
  }
  return "";
}

async function readAddress(file, property) {
  if (!file) return "";
  try {
    return readAddressText(await app.vault.read(file), property);
  } catch {
    return "";
  }
}

function assignIfEmpty(fm, property, value) {
  const wanted = property.trim().toLowerCase();
  const key = Object.keys(fm).find((name) => name.toLowerCase() === wanted);
  const current = key ? fm[key] : undefined;
  const text = typeof current === "string" ? current.trim() : "";
  if (text) return false;
  fm[key || property] = value;
  return true;
}

async function focusNote(file) {
  const active = app.workspace.getActiveFile();
  if (active && active.path === file.path) return;
  await app.workspace.getLeaf(false).openFile(file);
}

async function geocodeNewRv(tp, property) {
  const addressProperty = typeof property === "string" && property.trim() ? property.trim() : "Address";
  const initialFile = resolveFile(tp);
  const existing = await readAddress(initialFile, addressProperty);
  let entered = "";
  if (!existing) {
    try {
      const answer = await tp.system.prompt("Address");
      entered = typeof answer === "string" ? answer.trim() : "";
    } catch {
      entered = "";
    }
  }

  const applyAndGeocode = async () => {
    const file = resolveFile(tp) || app.workspace.getActiveFile();
    if (!file) {
      new Notice("RV Locator: no note to geocode.");
      return;
    }
    let address = await readAddress(file, addressProperty);
    if (!address && entered) {
      await app.fileManager.processFrontMatter(file, (fm) => {
        assignIfEmpty(fm, addressProperty, entered);
      });
      address = await readAddress(file, addressProperty);
    }
    if (!address) {
      new Notice("RV Locator: no address, geocode skipped.");
      return;
    }
    if (!app.commands.commands[COMMAND_ID]) {
      new Notice("Enable RV Locator, then run Geocode current note on this note.");
      return;
    }
    await focusNote(file);
    app.commands.executeCommandById(COMMAND_ID);
  };

  if (tp?.hooks && typeof tp.hooks.on_all_templates_executed === "function") {
    tp.hooks.on_all_templates_executed(() => {
      void applyAndGeocode();
    });
    return;
  }
  await applyAndGeocode();
}

module.exports = geocodeNewRv;
