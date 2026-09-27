/**
 * New RV note: prompt for householder + Address, rename to "{Name} on {Street}",
 * then geocode after Templater finishes writing the note.
 *
 * Templater user script. Meta Bind is not required for this script.
 * This script may write Address once, when that property is still empty.
 * RV Locator never writes Address.
 *
 * The drop-in template is `New RV.md`. It calls:
 *   const rv = await tp.user.newRv(tp)
 *
 * Street short names and the visit stamp mirror src/note-name.ts and
 * src/dates.ts formatGlancableVisitStamp (`Wed, 2pm — Sep 9, 2026`).
 */
const COMMAND_ID = "rv-locator:geocode-current-note";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STREET_SUFFIXES = new Set([
  "street", "st", "avenue", "ave", "road", "rd", "drive", "dr", "lane", "ln",
  "boulevard", "blvd", "court", "ct", "place", "pl", "circle", "cir", "way",
  "trail", "trl", "parkway", "pkwy", "highway", "hwy", "terrace", "ter",
  "loop", "alley", "aly", "plaza", "plz", "square", "sq", "run", "path",
  "pike", "route", "rte", "expressway", "expy", "crossing", "xing", "point", "pt",
]);
const DIRECTIONALS = new Set([
  "n", "north", "s", "south", "e", "east", "w", "west",
  "ne", "northeast", "nw", "northwest", "se", "southeast", "sw", "southwest",
]);
const UNIT_MARKERS = new Set(["apt", "apartment", "unit", "ste", "suite"]);

function tokenKey(token) {
  return token.toLowerCase().replace(/\./g, "");
}

function titleWord(token) {
  const bare = token.replace(/\.+$/g, "");
  if (/[a-z]/.test(bare) && /[A-Z]/.test(bare)) return bare;
  if (!bare) return bare;
  return bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase();
}

function dropTrailingSuffix(tokens) {
  if (tokens.length === 0) return [];
  const last = tokenKey(tokens[tokens.length - 1] || "");
  if (!STREET_SUFFIXES.has(last)) return tokens.slice();
  return tokens.slice(0, -1);
}

function isUnitMarker(token) {
  return UNIT_MARKERS.has(tokenKey(token)) || token.startsWith("#");
}

function dropUnit(tokens) {
  const unitAt = tokens.findIndex((token) => isUnitMarker(token));
  return unitAt >= 0 ? tokens.slice(0, unitAt) : tokens.slice();
}

function significantStreetTokens(raw) {
  let start = 0;
  while (start < raw.length && DIRECTIONALS.has(tokenKey(raw[start] || ""))) start += 1;
  let tokens = raw.slice(start);
  tokens = dropUnit(tokens);
  const trimmed = dropTrailingSuffix(tokens);
  if (trimmed.length > 0) return trimmed;
  return dropTrailingSuffix(dropUnit(raw));
}

function streetShortName(address) {
  const line = (address.split(",")[0] || address).trim();
  if (!line) return "";
  const remainder = line.replace(/^\s*\d+(?:-\d+)?[A-Za-z]?\s+/, "").trim();
  const source = remainder || line;
  const raw = source.split(/\s+/).filter((token) => token.length > 0);
  const named = significantStreetTokens(raw);
  const chosen = named.length > 0 ? named : raw;
  return chosen.map(titleWord).join(" ");
}

function sanitizeNoteName(value) {
  return value
    .replace(/[\\/:*?"<>|#^[\]\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim();
}

function yamlQuoted(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ").trim();
}

function hourLabel(hour) {
  const suffix = hour >= 12 ? "pm" : "am";
  const onClock = hour % 12 === 0 ? 12 : hour % 12;
  return `${onClock}${suffix}`;
}

function glancableStamp(date) {
  let year = date.getFullYear();
  let month = date.getMonth();
  let day = date.getDate();
  let hour = date.getHours();
  if (date.getMinutes() >= 30) hour += 1;
  if (hour >= 24) {
    const next = new Date(year, month, day + 1);
    year = next.getFullYear();
    month = next.getMonth();
    day = next.getDate();
    hour = 0;
  }
  const shown = new Date(year, month, day);
  const dow = WEEKDAYS[shown.getDay()];
  const rest = `${MONTHS[month]} ${day}, ${year}`;
  return `${dow}, ${hourLabel(hour)} — ${rest}`;
}

function parseLocalIso(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  if (!match) return new Date();
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isoLocal(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

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

function scheduleGeocode(tp, address) {
  const run = async () => {
    const file = resolveFile(tp) || app.workspace.getActiveFile();
    if (!file) {
      new Notice("RV Locator: no note to geocode.");
      return;
    }
    let stored = await readAddress(file, "Address");
    if (!stored && address) {
      await app.fileManager.processFrontMatter(file, (fm) => {
        assignIfEmpty(fm, "Address", address);
      });
      stored = await readAddress(file, "Address");
    }
    if (!stored) {
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
      void run();
    });
    return;
  }
  void run();
}

async function promptText(tp, label) {
  try {
    const answer = await tp.system.prompt(label);
    return typeof answer === "string" ? answer.trim() : "";
  } catch {
    return "";
  }
}

async function newRv(tp) {
  const name = sanitizeNoteName(await promptText(tp, "Householder name"));
  const address = (await promptText(tp, "Address")).replace(/\r?\n/g, " ").trim();
  const street = sanitizeNoteName(streetShortName(address));
  const title = name && street ? `${name} on ${street}` : "";

  let created = "";
  try {
    created = tp.file.creation_date("YYYY-MM-DDTHH:mm:ss");
  } catch {
    created = "";
  }
  if (!created) created = isoLocal(new Date());
  const stamp = glancableStamp(parseLocalIso(created));

  if (title && tp?.file?.rename) {
    try {
      await tp.file.rename(title);
    } catch {
      new Notice(`RV Locator: could not rename the note to “${title}”.`);
    }
  }

  if (address) scheduleGeocode(tp, address);

  return {
    addressYaml: yamlQuoted(address),
    created,
    stamp,
    title,
  };
}

module.exports = newRv;
