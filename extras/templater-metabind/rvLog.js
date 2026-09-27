/**
 * RV Locator visit-log parity for Templater (plugin 1.1.2).
 * Never writes Address.
 *
 * Attempt Log is a collapsed callout. An old `## Attempt Log` heading is
 * migrated to that callout on the next Home / Not home write.
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

/** `> [!note]-`, `> [!note]+`, and an unmarked `> [!note]` title all count. */
const ATTEMPT_LOG_CALLOUT = /^>\s*\[!note\]\s*([+-])?\s*Attempt Log\s*$/i;
const ATTEMPT_LOG_HEADING = /^## Attempt Log\s*$/;
const CALLOUT_HEADER = "> [!note]- Attempt Log";
const ADDRESS_KEY = "Address";

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

function insertHomeHeading(body, whenLabel) {
  const lines = body.split("\n");
  const found = findAttemptLog(lines);
  if (!found || found.kind !== "callout") return body;
  const before = lines.slice(0, found.index);
  while (before.length > 0 && before[before.length - 1] === "") before.pop();
  const after = lines.slice(found.index);
  const mid = before.length > 0 ? ["", `## ${whenLabel}`, "", ...after] : [`## ${whenLabel}`, "", ...after];
  return [...before, ...mid].join("\n");
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
  const line = bullet.startsWith(">") ? bullet : `> ${bullet}`;
  block.push(line);
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

  await app.fileManager.processFrontMatter(file, (fm) => {
    const addr = fm[ADDRESS_KEY];
    const hadAddress = Object.keys(fm).some((k) => k.toLowerCase() === ADDRESS_KEY.toLowerCase());

    fm["Visits"] = (asNumber(fm["Visits"]) ?? 0) + 1;
    fm["Last Attempted"] = whenIso;
    if (mode === "home") {
      fm["Successful Visits"] = (asNumber(fm["Successful Visits"]) ?? 0) + 1;
      fm["Last Spoke"] = whenIso;
    }

    if (hadAddress) fm[ADDRESS_KEY] = addr;
    else if (ADDRESS_KEY in fm) delete fm[ADDRESS_KEY];
  });

  const full = await app.vault.read(file);
  const fmMatch = full.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const fmBlock = fmMatch ? fmMatch[0] : "";
  let content = fmMatch ? full.slice(fmBlock.length) : full;

  content = ensureAttemptLog(content);
  if (mode === "home") content = insertHomeHeading(content, whenLabel);
  content = appendLogBullet(content, `> - ${whenLabel} — ${outcome}`);

  await app.vault.modify(file, fmBlock + content);
  new Notice(`Logged ${outcome}`);
}

module.exports = rvLog;
