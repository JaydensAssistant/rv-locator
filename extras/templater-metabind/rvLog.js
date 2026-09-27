/**
 * RV Locator visit-log parity for Templater (plugin 1.1.0).
 * Never writes Address.
 *
 * Call: await tp.user.rvLog(tp, "home")  or  await tp.user.rvLog(tp, "miss")
 */
function pad2(n) {
  return String(n).padStart(2, "0");
}

function isoLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function displayWhen(d) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const h24 = d.getHours();
  const ampm = h24 >= 12 ? "pm" : "am";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${h12}:${pad2(d.getMinutes())}${ampm}`;
}

function asNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const ATTEMPT_LOG = /^## Attempt Log\s*$/;
const ADDRESS_KEY = "Address";

function ensureAttemptLog(body) {
  const lines = body.split("\n");
  if (lines.some((l) => ATTEMPT_LOG.test(l))) return body.replace(/\s*$/, "");
  const trimmed = body.replace(/\s*$/, "");
  const gap = trimmed.length > 0 ? "\n\n" : "";
  return `${trimmed}${gap}## Attempt Log`;
}

function insertHomeHeading(body, whenLabel) {
  const lines = body.split("\n");
  const idx = lines.findIndex((l) => ATTEMPT_LOG.test(l));
  if (idx < 0) return body;
  const before = lines.slice(0, idx);
  while (before.length > 0 && before[before.length - 1] === "") before.pop();
  const after = lines.slice(idx);
  const mid = before.length > 0 ? ["", `## ${whenLabel}`, "", ...after] : [`## ${whenLabel}`, "", ...after];
  return [...before, ...mid].join("\n");
}

function appendLogBullet(body, bullet) {
  const lines = body.split("\n");
  const idx = lines.findIndex((l) => ATTEMPT_LOG.test(l));
  if (idx < 0) return body;
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i += 1) {
    if (/^#{1,2}\s+/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  const block = lines.slice(idx, end);
  while (block.length > 0 && block[block.length - 1] === "") block.pop();
  block.push(bullet);
  const rest = lines.slice(end);
  const gap = rest.length > 0 && rest[0] !== "" ? [""] : [];
  return [...lines.slice(0, idx), ...block, ...gap, ...rest].join("\n").replace(/\s*$/, "") + "\n";
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
  content = appendLogBullet(content, `- ${whenLabel} — ${outcome}`);

  await app.vault.modify(file, fmBlock + content);
  new Notice(`Logged ${outcome}`);
}

module.exports = rvLog;
