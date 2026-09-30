/**
 * RV Locator visit-log parity for Templater (plugin 1.1.3).
 * Never writes Address.
 *
 * Attempt Log is a collapsed callout, nested under Return Suggestions on
 * notes this plugin has rewritten. An existing + or - is left alone.
 * An old `## Attempt Log` heading is migrated to the collapsed callout on
 * the next Home / Not home write. A home stamp is inserted above Return
 * Suggestions, or above the suggester quote on an older note. The daypart
 * table stays inside the log. Each visit stamp is `#####` with a muted
 * "N days ago" age ("Today" on the day). An older `###` stamp is promoted on the next write.
 * Home inserts that stamp above the log, including a second Home in the
 * same rounded hour, and adds `### Visit Notes:` once. The line under each
 * new stamp is a Meta Bind textArea bound to the next `sVisitNNotes`
 * property, so notes stay editable in Reading view.
 *
 * Home also asks who they brought (one person). That name is appended to
 * Taken and does not change Met With. Not home does not ask, and a skipped
 * name leaves Met With and Taken unchanged. The name is also written on the
 * bullet (`— success with Devin`) so deleting or editing that visit can
 * take it back out of Taken.
 *
 * Call: await tp.user.rvLog(tp, "home")  or  await tp.user.rvLog(tp, "miss")
 */
function pad2(n) {
  return String(n).padStart(2, "0");
}

function isoLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Glancable visit stamp. Mirrors src/dates.ts formatGlancableVisitStamp:
 * nearest hour, then `Wed, 2pm — Sep 9, 2026`.
 */
function displayWhen(d) {
  let year = d.getFullYear();
  let month = d.getMonth();
  let day = d.getDate();
  let hour = d.getHours();
  if (d.getMinutes() >= 30) hour += 1;
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
  const suffix = hour >= 12 ? "pm" : "am";
  const onClock = hour % 12 === 0 ? 12 : hour % 12;
  return `${dow}, ${onClock}${suffix} — ${rest}`;
}

function asNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Flat and nested `> [!note]` / `> > [!note]` Attempt Log titles all count. */
const ATTEMPT_LOG_CALLOUT = /^(?:>[\t ]*)+\[!note\][\t ]*([+-])?[\t ]*Attempt Log[\t ]*$/i;
const RETURN_SUGGESTIONS = /^(?:>[\t ]*)+\[![A-Za-z0-9-]+\][\t ]*([+-])?[\t ]*Return Suggestions[\t ]*$/i;
const ATTEMPT_LOG_HEADING = /^## Attempt Log\s*$/;
const CALLOUT_HEADER = "> [!note]- Attempt Log";
const DIGEST_STARTS = ["%% rv-locator-digest %%", "<!-- rv-locator-digest -->"];
const DIGEST_ENDS = ["%% /rv-locator-digest %%", "<!-- /rv-locator-digest -->"];
const ADDRESS_KEY = "Address";
const STAMP_AGE_SUFFIX = /\s*<span class="rv-stamp-ago">[^<]*<\/span>\s*$/i;
const MONTH_INDEX = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function isDigestStartLine(line) {
  return DIGEST_STARTS.some((mark) => String(line || "").includes(mark));
}

function isDigestEndLine(line) {
  return DIGEST_ENDS.some((mark) => String(line || "").includes(mark));
}

/** Calendar days for `Wed, 2pm — Sep 9, 2026`. Mirrors src/dates.ts. */
function stampCalendarDays(stamp, today) {
  const text = String(stamp || "").replace(STAMP_AGE_SUFFIX, "").trim();
  const match = /[—–-]\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\s*$/.exec(text);
  if (!match) return null;
  const dateMatch = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(String(match[1] || "").trim());
  if (!dateMatch) return null;
  const month = MONTH_INDEX[String(dateMatch[1] || "").toLowerCase().slice(0, 3)];
  const day = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  if (!month || !Number.isInteger(day) || !Number.isInteger(year)) return null;
  const then = Date.UTC(year, month - 1, day);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((now - then) / 86400000);
  if (!Number.isFinite(days)) return null;
  return days < 0 ? 0 : days;
}

function formatDaysAgo(days) {
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function refreshStampAges(body, today) {
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  const next = lines.map((line) => {
    const match = /^(?:###|#####)\s+(.+?)\s*$/.exec(line);
    if (!match) return line;
    const stamp = String(match[1] || "").replace(STAMP_AGE_SUFFIX, "").trim();
    const days = stampCalendarDays(stamp, today);
    if (days == null) return line;
    return `##### ${stamp} <span class="rv-stamp-ago">${formatDaysAgo(days)}</span>`;
  });
  return next.join(newline);
}

function findAttemptLog(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (ATTEMPT_LOG_CALLOUT.test(line)) return { index, kind: "callout" };
    if (ATTEMPT_LOG_HEADING.test(line)) return { index, kind: "heading" };
  }
  return null;
}

function sectionEnd(lines, start, kind) {
  if (kind === "callout") {
    let end = start + 1;
    while (end < lines.length && /^>/.test(lines[end] ?? "")) end += 1;
    return end;
  }
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,2}\s+/.test(lines[index] ?? "")) return index;
  }
  return lines.length;
}

function toCalloutBodyLine(line) {
  if (line.startsWith(">")) return line;
  if (line.trim() === "") return ">";
  return `> ${line}`;
}

function migrateHeadingToCallout(lines, start) {
  const end = sectionEnd(lines, start, "heading");
  const section = lines.slice(start + 1, end);
  while (section.length > 0 && (section[section.length - 1] ?? "").trim() === "") section.pop();
  const callout = [CALLOUT_HEADER, ...section.map(toCalloutBodyLine)];
  return [...lines.slice(0, start), ...callout, ...lines.slice(end)];
}

function ensureAttemptLog(body) {
  const normalized = body.replace(/\s*$/, "");
  const lines = normalized.split("\n");
  const found = findAttemptLog(lines);
  if (!found) {
    const gap = normalized.length > 0 ? "\n\n" : "";
    return `${normalized}${gap}${CALLOUT_HEADER}`;
  }
  if (found.kind === "heading") return migrateHeadingToCallout(lines, found.index).join("\n");
  return normalized;
}

function isVoiceQuoteLine(line) {
  if (!/^>/.test(line) || /\[!/.test(line)) return false;
  const text = String(line).replace(/^(?:>\s*)+/, "").trim();
  return /^(?:Avoid|Try|Unsure|Untried)\b/.test(text) || text === "No May-go-out days";
}

function isReturnSuggestionsLine(line) {
  return RETURN_SUGGESTIONS.test(line);
}

function isDigestFurniture(line) {
  if (!/^>/.test(line)) return false;
  if (isReturnSuggestionsLine(line) || ATTEMPT_LOG_CALLOUT.test(line) || isVoiceQuoteLine(line)) return false;
  if (isDigestStartLine(line) || isDigestEndLine(line)) return true;
  const text = String(line).replace(/^(?:>\s*)+/, "").trim();
  if (text === "") return true;
  return text.startsWith("|") && text.endsWith("|");
}

function suggestionsRegionStart(lines, logIndex) {
  let index = logIndex;
  while (index > 0) {
    const prev = lines[index - 1] ?? "";
    if (prev.trim() === "") {
      const earlier = index > 1 ? lines[index - 2] ?? "" : "";
      if (isReturnSuggestionsLine(earlier) || isVoiceQuoteLine(earlier) || isDigestFurniture(earlier)) {
        index -= 1;
        continue;
      }
      break;
    }
    if (isReturnSuggestionsLine(prev)) return index - 1;
    if (isVoiceQuoteLine(prev) || isDigestFurniture(prev)) {
      index -= 1;
      continue;
    }
    break;
  }
  return index;
}

function isThematicBreak(line) {
  return /^([-*_])\1{2,}\s*$/.test(String(line || "").trim());
}

function aboveThematicBreak(lines, index) {
  let cursor = index;
  while (cursor > 0 && (lines[cursor - 1] ?? "") === "") cursor -= 1;
  if (cursor > 0 && isThematicBreak(lines[cursor - 1] ?? "")) return cursor - 1;
  return index;
}

function attemptLogAnchor(lines, calloutIndex) {
  let anchor = suggestionsRegionStart(lines, calloutIndex);
  if (anchor === calloutIndex) {
    let index = calloutIndex;
    while (index > 0 && (lines[index - 1] ?? "") === "") index -= 1;
    const previous = lines[index - 1] ?? "";
    if (index > 0 && isDigestEndLine(previous)) {
      let start = index - 1;
      while (start > 0 && !isDigestStartLine(lines[start] ?? "")) start -= 1;
      if (isDigestStartLine(lines[start] ?? "")) anchor = start;
    }
  }
  return aboveThematicBreak(lines, anchor);
}

function quoteDepth(line) {
  const lead = /^(?:>\s*)+/.exec(line);
  const marks = lead ? lead[0].match(/>/g) : null;
  return Math.max(1, marks ? marks.length : 1);
}

function formatLogBullet(header, line) {
  const text = String(line).replace(/^(?:>\s*)+/, "").replace(/^[-*]\s+/, "").trim();
  const depth = quoteDepth(header);
  if (depth <= 1) return `> - ${text}`;
  return `${Array.from({ length: depth }, () => ">").join(" ")}- ${text}`;
}

function isVisitStampLine(line) {
  const match = /^(?:###|#####)\s+(.+?)\s*$/.exec(line);
  if (!match) return false;
  return stampCalendarDays(String(match[1] || ""), new Date()) != null;
}

function ensureVisitNotesHeading(body) {
  const lines = body.split(/\r?\n/);
  if (lines.some((line) => line.trim() === "### Visit Notes:")) return body;
  const stampAt = lines.findIndex((line) => isVisitStampLine(line));
  if (stampAt < 0) return body;
  lines.splice(stampAt, 0, "### Visit Notes:");
  return lines.join(body.includes("\r\n") ? "\r\n" : "\n");
}

function insertHomeHeading(body, whenLabel) {
  const lines = body.split("\n");
  const found = findAttemptLog(lines);
  if (!found || found.kind !== "callout") return body;
  const anchor = attemptLogAnchor(lines, found.index);
  const before = lines.slice(0, anchor);
  while (before.length > 0 && before[before.length - 1] === "") before.pop();
  const after = lines.slice(anchor);
  const heading = `##### ${whenLabel}`;
  const field = `\`INPUT[textArea:${nextVisitNotesProperty(body)}]\``;
  const last = before.length > 0 ? String(before[before.length - 1]).trim() : "";
  const lead = before.length === 0 || last === "### Visit Notes:" ? [] : [""];
  return [...before, ...lead, heading, field, "", ...after].join("\n");
}

/** Mirrors src/visit-log.ts nextVisitNotesProperty. */
function nextVisitNotesProperty(body) {
  let highest = 0;
  for (const match of String(body).matchAll(/\bsVisit(\d+)Notes\b/g)) {
    const index = Number(match[1]);
    if (Number.isInteger(index) && index > highest) highest = index;
  }
  return `sVisit${highest + 1}Notes`;
}

/** Mirrors src/visit-log.ts unfoldDashboard: RV Dashboard has no fold mark. */
function unfoldDashboard(body) {
  const lines = body.split("\n");
  const at = lines.findIndex((line) => /^>[\t ]*\[!quote\][+-][\t ]*RV Dashboard[\t ]*$/i.test(line.replace(/\r$/, "")));
  if (at < 0) return body;
  lines[at] = `> [!quote] RV Dashboard${lines[at].endsWith("\r") ? "\r" : ""}`;
  return lines.join("\n");
}

/** Mirrors src/visit-log.ts ensureDashboardLeadBlank. */
function ensureDashboardLeadBlank(body) {
  const first = (/^[^\r\n]*/.exec(body) || [""])[0];
  if (!/^>[\t ]*\[!quote\][+-]?[\t ]*RV Dashboard\b/i.test(first)) return body;
  return `${body.includes("\r\n") ? "\r\n" : "\n"}${body}`;
}

function appendLogBullet(body, bullet) {
  let lines = body.split("\n");
  let found = findAttemptLog(lines);
  if (!found) return body;
  if (found.kind === "heading") {
    lines = migrateHeadingToCallout(lines, found.index);
    found = findAttemptLog(lines);
    if (!found || found.kind !== "callout") return body;
  }
  const end = sectionEnd(lines, found.index, "callout");
  const block = lines.slice(found.index, end);
  while (block.length > 1 && /^>\s*$/.test(block[block.length - 1] ?? "")) block.pop();
  while (block.length > 0 && block[block.length - 1] === "") block.pop();
  const depth = quoteDepth(block[0] ?? "");
  if (block.length > 1 && /^(?:>\s*)+\|/.test(block[block.length - 1] ?? "")) {
    block.push(depth >= 2 ? "> >" : ">");
  }
  block.push(formatLogBullet(block[0] ?? "", bullet));
  const rest = lines.slice(end);
  const gap = rest.length > 0 && rest[0] !== "" ? [""] : [];
  return [...lines.slice(0, found.index), ...block, ...gap, ...rest].join("\n").replace(/\s*$/, "") + "\n";
}

function resolveFile(tp) {
  // Meta Bind runTemplaterFile (1.4+) targets the note containing the button.
  if (tp?.config?.target_file) return tp.config.target_file;
  if (tp?.file?.path) {
    const f = app.vault.getAbstractFileByPath(tp.file.path);
    if (f) return f;
  }
  return app.workspace.getActiveFile();
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

function looksLikeCompanionTarget(value) {
  if (!value || value.length > 120) return false;
  if (/[\[\]#:]/.test(value)) return false;
  return /[A-Za-z]/.test(value);
}

function wikilinkTarget(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\[\[[^\]]+\]\]$/.test(text)) return text;
  if (!looksLikeCompanionTarget(text)) return "";
  return `[[${text}]]`;
}

function wikilinkFromParsed(value) {
  if (typeof value === "string") {
    const text = value.trim();
    return /^\[\[[^\]]+\]\]$/.test(text) ? text : "";
  }
  if (!Array.isArray(value) || value.length !== 1) return "";
  const inner = value[0];
  if (Array.isArray(inner) && inner.length === 1 && typeof inner[0] === "string") return wikilinkTarget(inner[0]);
  if (typeof inner === "string") return wikilinkTarget(inner);
  return "";
}

function takenItems(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const link = wikilinkFromParsed(item);
      if (link) return [link];
      if (typeof item === "string" && item.trim()) return [item.trim()];
      return [];
    });
  }
  const link = wikilinkFromParsed(value);
  if (link) return [link];
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

function appendTaken(existing, companion) {
  const stored = String(companion || "").trim();
  const items = takenItems(existing);
  if (!stored) return items;
  const key = companionKey(stored);
  if (!key || items.some((item) => companionKey(item) === key)) return items;
  return items.concat([stored]);
}

async function promptText(tp, label) {
  try {
    const answer = await tp.system.prompt(label);
    return typeof answer === "string" ? answer.trim() : "";
  } catch {
    return "";
  }
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

function yamlQuote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function quoteLooseWikilink(value) {
  const text = String(value || "").trim();
  if (!text || text.startsWith('"') || text.startsWith("'")) return "";
  const match = /^\[\[([^\]]+)\]\]$/.exec(text);
  if (!match) return "";
  return yamlQuote(`[[${match[1]}]]`);
}

function stripYamlQuote(value) {
  const text = String(value || "").trim();
  if (text.length >= 2) {
    const open = text[0];
    const close = text[text.length - 1];
    if ((open === '"' && close === '"') || (open === "'" && close === "'")) return text.slice(1, -1);
  }
  return text;
}

function rewriteCompanionLinkLines(lines) {
  const keys = { taken: true, "met with": true };
  const out = [];
  let key = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    if (!/^\s/.test(line)) {
      const top = /^([^:#][^:]*?)\s*:(.*)$/.exec(line);
      key = top ? String(top[1] || "").trim().toLowerCase() : "";
      if (top && keys[key]) {
        const quoted = quoteLooseWikilink(String(top[2] || "").trim());
        if (quoted) {
          out.push(`${top[1]}: ${quoted}`);
          continue;
        }
      }
      out.push(line);
      continue;
    }
    if (!keys[key]) {
      out.push(line);
      continue;
    }
    const unquoted = /^(\s*)-\s+\[\[([^\]]+)\]\]\s*$/.exec(line);
    if (unquoted) {
      out.push(`${unquoted[1]}- ${yamlQuote(`[[${unquoted[2]}]]`)}`);
      continue;
    }
    const nested = /^(\s*)-\s+-\s+(.+?)\s*$/.exec(line);
    if (nested) {
      const wrapped = wikilinkTarget(stripYamlQuote(nested[2] || ""));
      if (wrapped) {
        out.push(`${nested[1]}- ${yamlQuote(wrapped)}`);
        continue;
      }
    }
    const empty = /^(\s*)-\s*$/.exec(line);
    const child = /^(\s*)-\s+(.+?)\s*$/.exec(lines[index + 1] || "");
    if (empty && child && String(child[1] || "").length > String(empty[1] || "").length) {
      const wrapped = wikilinkTarget(stripYamlQuote(child[2] || ""));
      if (wrapped) {
        out.push(`${empty[1]}- ${yamlQuote(wrapped)}`);
        index += 1;
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

function stabilizeCompanionFrontmatterLocal(markdown) {
  const text = String(markdown || "");
  const nl = text.startsWith("---\r\n") ? "\r\n" : text.startsWith("---\n") ? "\n" : "";
  if (!nl) return text;
  const start = 3 + nl.length;
  const close = `${nl}---`;
  const end = text.indexOf(close, start);
  if (end < 0) return text;
  const lines = text.slice(start, end).split(/\r?\n/);
  const rewritten = rewriteCompanionLinkLines(lines);
  if (rewritten.length === lines.length && rewritten.every((line, index) => line === lines[index])) return text;
  return text.slice(0, start) + rewritten.join(nl) + text.slice(end);
}

function stabilizeCompanionFrontmatter(markdown) {
  const plugin = rvPlugin();
  const remote = plugin && plugin.stabilizeCompanionFrontmatter;
  if (typeof remote === "function") {
    try {
      const next = remote.call(plugin, markdown);
      if (typeof next === "string") return next;
    } catch {
      /* The local rewriter still quotes Taken and Met With. */
    }
  }
  return stabilizeCompanionFrontmatterLocal(markdown);
}

async function rvLog(tp, kind) {
  const mode = kind === "home" || kind === "success" || kind === "yes" ? "home" : "miss";
  const file = resolveFile(tp);
  if (!file) {
    new Notice("RV log: no active note");
    return;
  }

  const now = new Date();
  const whenIso = isoLocal(now);
  const whenLabel = displayWhen(now);
  const outcome = mode === "home" ? "success" : "not home";
  const companion = mode === "home" ? await askCompanion(tp) : "";

  await app.fileManager.processFrontMatter(file, (fm) => {
    const addr = fm[ADDRESS_KEY];
    const hadAddress = Object.keys(fm).some((k) => k.toLowerCase() === ADDRESS_KEY.toLowerCase());

    fm["Visits"] = (asNumber(fm["Visits"]) ?? 0) + 1;
    fm["Last Attempted"] = whenIso;
    if (mode === "home") {
      fm["Successful Visits"] = (asNumber(fm["Successful Visits"]) ?? 0) + 1;
      fm["Last Spoke"] = whenIso;
      if (companion) {
        fm["Taken"] = appendTaken(fm["Taken"], companion);
      }
    }

    if (hadAddress) fm[ADDRESS_KEY] = addr;
    else if (ADDRESS_KEY in fm) delete fm[ADDRESS_KEY];
  });

  let full = await app.vault.read(file);
  const stabilized = stabilizeCompanionFrontmatter(full);
  if (stabilized !== full) {
    await app.vault.modify(file, stabilized);
    full = stabilized;
  }
  const fmMatch = full.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const fmBlock = fmMatch ? fmMatch[0] : "";
  let content = fmMatch ? full.slice(fmBlock.length) : full;

  content = ensureAttemptLog(content);
  if (mode === "home") content = insertHomeHeading(content, whenLabel);
  content = appendLogBullet(content, `> - ${whenLabel} — ${outcome}${companion ? ` with ${companion}` : ""}`);
  content = refreshStampAges(content, now);
  content = ensureVisitNotesHeading(content);
  content = ensureDashboardLeadBlank(unfoldDashboard(content));

  await app.vault.modify(file, fmBlock + content);
  const plugin = rvPlugin();
  const afterVisit = plugin && plugin.noteVisitLogged;
  if (typeof afterVisit === "function") {
    try {
      await afterVisit.call(plugin, file, mode);
    } catch {
      /* The visit is already on the note. */
    }
  }
  new Notice(`Logged ${outcome}`);
}

module.exports = rvLog;
