/**
 * New RV note: prompt for householder + Address, rename to "{Name} on {Street}",
 * then geocode after Templater finishes writing the note.
 *
 * Templater user script. Meta Bind is not required for this script.
 * This script may write Address once, when that property is still empty.
 * RV Locator never writes Address.
 *
 * The drop-in template is `99 New RV.md` (older vaults may still use `New RV.md`). It calls:
 *   const rv = await tp.user.newRv(tp)
 *
 * After the householder and Address, it asks who they brought. One person.
 * That name is appended to Taken. Met With stays blank. Cancel leaves both blank.
 * Priority comes from RV Locator `defaultNewRvPriority` (0–5, default 4).
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

/** Same formula as src/address.ts googleMapsAddressLink. */
/**
 * Google Maps search of the typed address.
 * Create-time has no City yet, so the icon is address-only. Geocode later writes
 * the Map Link property and, when Address has no comma-separated city, appends City.
 * This helper does the same append when a city string is passed. It does not rewrite Address.
 */
function mapsSearchUrl(address, city) {
  let query = String(address ?? "").replace(/\r?\n/g, " ").replace(/[ \t]{2,}/g, " ").trim();
  const extra = String(city ?? "").replace(/\r?\n/g, " ").replace(/[ \t]{2,}/g, " ").trim();
  if (query && extra && !query.includes(",") && !query.toLowerCase().includes(extra.toLowerCase())) {
    query = `${query}, ${extra}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
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

function refreshCreatedDigest(file) {
  const plugin = rvPlugin();
  const refresh = plugin && plugin.refreshAttemptDigest;
  if (!file || typeof refresh !== "function") return Promise.resolve();
  try {
    const result = refresh.call(plugin, file);
    return result && typeof result.then === "function" ? result : Promise.resolve();
  } catch {
    return Promise.resolve();
  }
}

function scheduleGeocode(tp, address) {
  const run = async () => {
    const file = resolveFile(tp) || app.workspace.getActiveFile();
    if (address && !file) {
      new Notice("RV Locator: no note to geocode.");
      return;
    }
    if (address && file) {
      let stored = await readAddress(file, "Address");
      if (!stored && address) {
        await app.fileManager.processFrontMatter(file, (fm) => {
          assignIfEmpty(fm, "Address", address);
        });
        stored = await readAddress(file, "Address");
      }
      if (!stored) {
        new Notice("RV Locator: no address, geocode skipped.");
      } else if (!app.commands.commands[COMMAND_ID]) {
        new Notice("Enable RV Locator, then run Geocode current note on this note.");
      } else {
        await focusNote(file);
        app.commands.executeCommandById(COMMAND_ID);
      }
    }
    await refreshCreatedDigest(file);
  };

  if (tp?.hooks && typeof tp.hooks.on_all_templates_executed === "function") {
    tp.hooks.on_all_templates_executed(() => run());
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

// Companion gather/store stays in step with src/companions.ts.
const COMPANION_LIMIT = 24;
const COMPANION_NEW = { kind: "new" };

function rvPlugin() {
  const plugins = app.plugins && app.plugins.plugins;
  return plugins ? plugins["rv-locator"] : null;
}

function companionDisplayName(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  const link = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]$/.exec(text);
  if (!link) return text;
  const alias = (link[2] || "").trim();
  if (alias) return alias;
  const target = (link[1] || "").trim();
  const base = target.split("/").pop() || target;
  return base.trim();
}

function takenItems(value) {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter((item) => item.length > 0);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function companionKey(value) {
  return companionDisplayName(value).trim().toLowerCase();
}

function parseCompanionStamp(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const local = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
  if (local) {
    const date = new Date(
      Number(local[1]),
      Number(local[2]) - 1,
      Number(local[3]),
      Number(local[4] || 0),
      Number(local[5] || 0),
      Number(local[6] || 0),
    );
    const time = date.getTime();
    return Number.isNaN(time) ? null : time;
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function companionRecency(fm, mtime) {
  const stamps = ["Last Spoke", "Last Attempted", "Met"]
    .map((key) => parseCompanionStamp(fm ? fm[key] : undefined))
    .filter((value) => value != null);
  const latest = stamps.length ? Math.max.apply(null, stamps) : 0;
  const modified = Number.isFinite(mtime) ? mtime : 0;
  return Math.max(latest, modified);
}

function recentCompanionNames(notes) {
  const sorted = notes.slice().sort((a, b) => b.recentAt - a.recentAt);
  const seen = new Set();
  const names = [];
  for (const note of sorted) {
    const values = [note.metWith].concat(takenItems(note.taken));
    for (const raw of values) {
      const label = companionDisplayName(raw);
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(label);
      if (names.length >= COMPANION_LIMIT) return names;
    }
  }
  return names;
}

function markdownFiles() {
  if (!app.vault || typeof app.vault.getMarkdownFiles !== "function") return [];
  const files = app.vault.getMarkdownFiles();
  return Array.isArray(files) ? files : [];
}

function fileFrontmatter(file) {
  if (!app.metadataCache || typeof app.metadataCache.getFileCache !== "function") return null;
  const cache = app.metadataCache.getFileCache(file);
  return cache && cache.frontmatter ? cache.frontmatter : null;
}

function recentNamesFromVault() {
  const notes = [];
  for (const file of markdownFiles()) {
    const fm = fileFrontmatter(file);
    if (!fm) continue;
    const mtime = file && file.stat && typeof file.stat.mtime === "number" ? file.stat.mtime : 0;
    notes.push({ metWith: fm["Met With"], taken: fm.Taken, recentAt: companionRecency(fm, mtime) });
  }
  return recentCompanionNames(notes);
}

function formatStoredCompanion(name) {
  return companionDisplayName(name) || String(name || "").trim();
}

function companionFrontmatterBlock(stored) {
  const name = String(stored || "").trim();
  if (!name) return "Met With:\nTaken:";
  const quoted = `"${yamlQuoted(name)}"`;
  return `Met With:\nTaken:\n  - ${quoted}`;
}

function newRvPriority() {
  const plugin = rvPlugin();
  const settings = plugin && plugin.settings;
  const raw = settings ? settings.defaultNewRvPriority : undefined;
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" && String(raw).trim() !== "" ? Number(raw) : NaN;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 5) return 4;
  return parsed;
}

async function askCompanionFallback(tp) {
  const recent = recentNamesFromVault();
  if (recent.length && tp && tp.system && typeof tp.system.suggester === "function") {
    let picked = null;
    try {
      const choices = recent.map((item) => ({ kind: "recent", name: item })).concat([COMPANION_NEW]);
      picked = await tp.system.suggester(
        (item) => (item && item.kind === "new" ? "Type a new name…" : item.name),
        choices,
        false,
        "Who did they bring?",
      );
    } catch {
      picked = null;
    }
    if (!picked) return "";
    if (picked.kind === "new") return promptText(tp, "Who did they bring?");
    return typeof picked.name === "string" ? picked.name.trim() : "";
  }
  return promptText(tp, "Who did they bring?");
}

async function askCompanion(tp) {
  const plugin = rvPlugin();
  if (plugin && typeof plugin.promptCompanion === "function") {
    try {
      const value = await plugin.promptCompanion();
      return typeof value === "string" ? value.trim() : "";
    } catch {
      return "";
    }
  }
  const picked = await askCompanionFallback(tp);
  return formatStoredCompanion(picked);
}

async function newRv(tp) {
  const name = sanitizeNoteName(await promptText(tp, "Householder name"));
  const address = (await promptText(tp, "Address")).replace(/\r?\n/g, " ").trim();
  const companion = await askCompanion(tp);
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

  scheduleGeocode(tp, address);

  return {
    addressYaml: yamlQuoted(address),
    mapUrl: mapsSearchUrl(address),
    created,
    stamp,
    title,
    priority: newRvPriority(),
    companionYaml: companionFrontmatterBlock(companion),
  };
}

module.exports = newRv;
