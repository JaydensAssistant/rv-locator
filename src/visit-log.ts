import { attemptLogAnchor } from './attempt-digest';
import { appendCompanionTaken } from './companions';
import { calendarDaysSinceStamp, formatDaysAgo, formatExactVisitStamp, formatGlancableVisitStamp, stripStampAge } from './dates';
import { stampDateTime } from './schedule';
import { assignProperty, readProperty, removeProperty } from './frontmatter';

export type VisitOutcome = 'home' | 'miss';

/**
 * Ask only on a Home, and only when Successful Visits is a positive multiple of N.
 * A miss never asks, even when the home count is already on a multiple of N.
 */
export function shouldNudgePriority(
	outcome: VisitOutcome | 'unknown',
	successfulVisits: number | null,
	every: number,
): boolean {
	if (outcome !== 'home') return false;
	if (!Number.isInteger(every) || every < 1) return false;
	if (successfulVisits == null || !Number.isInteger(successfulVisits) || successfulVisits < every) return false;
	return successfulVisits % every === 0;
}

/** `> [!note]-`, `> [!note]+`, an unmarked title, and the nested `> > [!note]` form all count. */
const ATTEMPT_LOG_CALLOUT = /^(?:>[\t ]*)+\[!note\][\t ]*([+-])?[\t ]*Attempt Log[\t ]*$/i;
const ATTEMPT_LOG_HEADING = /^## Attempt Log\s*$/;
const VISIT_NOTES_HEADING = '### Recent Notes:';
const LEGACY_VISIT_NOTES_HEADING = '### Visit Notes:';
const ADDRESS_KEY = 'Address';
/** Collapsed by default. An existing `+` or `-` on the note is left alone. */
const CALLOUT_HEADER = '> [!note]- Attempt Log';
const STAMP_LEVEL = '#####';
const VISIT_NOTES_FIELD = /\bsVisit(\d+)Notes\b/g;
const DASHBOARD_CALLOUT = /^>[\t ]*\[!quote\][+-]?[\t ]*RV Dashboard\b/i;
const FOLDABLE_DASHBOARD = /^>[\t ]*\[!quote\][+-][\t ]*RV Dashboard[\t ]*$/i;
/** No fold mark: RV Dashboard cannot be collapsed. */
const DASHBOARD_HEADER = '> [!quote] RV Dashboard';

/** Local date-time stored on Last Spoke / Last Attempted. No UTC shift. */
export function formatFrontmatterDateTime(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Glancable drive date: weekday, hour rounded to the nearest hour, then the calendar date. */
export function formatVisitStamp(date: Date): string {
	return formatExactVisitStamp(date);
}

/**
 * Frontmatter for one logged visit. Address is never assigned.
 * Home bumps Visits and Successful Visits and sets Last Spoke and Last Attempted.
 * A miss bumps Visits and sets Last Attempted only.
 * A non-empty home companion is appended to Taken. Met With is left unchanged.
 * A blank companion, and every miss, leaves Met With and Taken alone.
 */
export function applyVisitFrontmatter(
	frontmatter: Record<string, unknown>,
	outcome: VisitOutcome,
	now: Date,
	companion?: string | null,
): void {
	const address = readProperty(frontmatter, ADDRESS_KEY);
	const hadAddress = Object.keys(frontmatter).some((key) => key.toLowerCase() === ADDRESS_KEY.toLowerCase());
	bumpCount(frontmatter, 'Visits');
	const stamp = formatFrontmatterDateTime(now);
	assignProperty(frontmatter, 'Last Attempted', stamp);
	if (outcome === 'home') {
		bumpCount(frontmatter, 'Successful Visits');
		assignProperty(frontmatter, 'Last Spoke', stamp);
		const stored = typeof companion === 'string' ? companion.trim() : '';
		if (stored) {
			assignProperty(frontmatter, 'Taken', appendCompanionTaken(readProperty(frontmatter, 'Taken'), stored));
		}
	}
	if (!hadAddress) {
		removeProperty(frontmatter, ADDRESS_KEY);
		return;
	}
	if (readProperty(frontmatter, ADDRESS_KEY) !== address) {
		assignProperty(frontmatter, ADDRESS_KEY, address);
	}
}

/**
 * Body text below the frontmatter.
 * A home visit inserts `##### <stamp>` just above Attempt Log, with a Meta Bind
 * textArea bound to the next `sVisitNNotes` property on the line below it.
 * A second Home in the same rounded hour still inserts another stamp.
 * `### Recent Notes:` is added once, above the first visit stamp. An older
 * `### Visit Notes:` line is renamed. Notes
 * already written as plain text are left alone.
 * Both outcomes append a bullet inside the Attempt Log callout. A nested log
 * (`> > [!note]`) gets a nested bullet (`> >-`). A missing log is created
 * collapsed (`> [!note]-`). An existing `+` or `-` stays. An old `## Attempt Log`
 * heading is migrated to that collapsed callout on write. A home stamp is
 * inserted above Return Suggestions when that callout wraps the log, and
 * above the suggester quote on an older note. A rule that sits on that block
 * stays below the stamp, in the notes area.
 * Each visit stamp gets a muted age (`54 days ago`). A `###` stamp is promoted
 * to `#####`. Home and Not home refresh ages already on the note. Address is
 * not part of the body edit.
 */
export function applyVisitBody(body: string, outcome: VisitOutcome, now: Date, companion = ''): string {
	const stamp = formatVisitStamp(now);
	let next = ensureAttemptLog(body);
	if (outcome === 'home') next = insertHomeHeading(next, stamp);
	next = appendLogLine(next, `> - ${stamp} — ${visitPhrase(outcome === 'home', companion)}`);
	next = refreshHomeStampAges(next, now);
	next = ensureVisitNotesHeading(next);
	return ensureDashboardLeadBlank(unfoldDashboard(next));
}

/**
 * `> [!quote]+ RV Dashboard` and `> [!quote]- RV Dashboard` become
 * `> [!quote] RV Dashboard`, which Obsidian renders without a fold toggle.
 * Quick Facts and Attempt Log keep their marks.
 */
export function unfoldDashboard(body: string): string {
	const lines = body.split('\n');
	const at = lines.findIndex((line) => FOLDABLE_DASHBOARD.test(line.replace(/\r$/, '')));
	if (at < 0) return body;
	const carriage = lines[at]?.endsWith('\r') ? '\r' : '';
	lines[at] = `${DASHBOARD_HEADER}${carriage}`;
	return lines.join('\n');
}

const TWO_BUTTON_LINE = /^(>[\t ]*)`BUTTON\[\s*rv-log-home\s*,\s*rv-log-miss\s*\]`[\t ]*$/;
/** Icon-only visit buttons. The tooltip names the button on hover and on a long press. */
export const VISIT_BUTTON_FACES: Readonly<Record<string, { icon: string; tooltip: string }>> = {
	'rv-log-home': { icon: 'door-open', tooltip: 'Home' },
	'rv-log-miss': { icon: 'door-closed', tooltip: 'Not home' },
	'rv-log-past': { icon: 'rotate-ccw-clock', tooltip: 'Log past visit' },
	'rv-log-housemate': { icon: 'user-plus', tooltip: 'Add a housemate' },
	'rv-archive': { icon: 'archive', tooltip: 'Archive' },
};

function faceLines(id: string): string[] {
	const face = VISIT_BUTTON_FACES[id];
	if (!face) return [];
	return ['label: ""', `icon: ${face.icon}`, `tooltip: ${face.tooltip}`];
}

const VISIT_BUTTON_LINE = 'BUTTON[rv-log-home, rv-log-miss, rv-log-past, rv-log-housemate, rv-archive]';
const VISIT_BUTTON_ROW = /^(>[\t ]*)`BUTTON\[[^\]]*rv-log-home[^\]]*rv-log-miss[^\]]*\]`[\t ]*$/;

const VISIT_BUTTON_BLOCKS: ReadonlyArray<{ id: string; block: string }> = [
	{
		id: 'rv-log-past',
		block: ['```meta-bind-button', ...faceLines('rv-log-past'), 'style: default', 'class: rv-visit-btn', 'id: rv-log-past', 'hidden: true', 'actions:', '  - type: command', '    command: rv-locator:log-past-visit', '```'].join('\n'),
	},
	{
		id: 'rv-log-housemate',
		block: ['```meta-bind-button', ...faceLines('rv-log-housemate'), 'style: default', 'class: rv-visit-btn', 'id: rv-log-housemate', 'hidden: true', 'actions:', '  - type: command', '    command: rv-locator:add-housemate', '```'].join('\n'),
	},
	{
		id: 'rv-archive',
		block: ['```meta-bind-button', ...faceLines('rv-archive'), 'style: default', 'class: rv-visit-btn', 'id: rv-archive', 'hidden: true', 'actions:', '  - type: command', '    command: rv-locator:archive-rv', '```'].join('\n'),
	},
];

const BUTTON_FENCE = /^```meta-bind-button[\t ]*$/;
const BUTTON_FACE_KEY = /^(?:label|icon|tooltip):/;

/**
 * The four visit button blocks get an empty label, their icon, and a
 * tooltip, in place of the old text label. Other button blocks and every
 * other key are left alone.
 */
export function iconizeVisitButtons(body: string): string {
	const newline = body.includes('\r\n') ? '\r\n' : '\n';
	const lines = body.split(/\r?\n/);
	const out: string[] = [];
	let changed = false;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		if (!BUTTON_FENCE.test(line)) {
			out.push(line);
			continue;
		}
		let end = index + 1;
		while (end < lines.length && !/^```[\t ]*$/.test(lines[end] ?? '')) end += 1;
		const inner = lines.slice(index + 1, end);
		const id = inner.map((item) => /^id:\s*(\S+)\s*$/.exec(item)?.[1]).find((value) => value != null) ?? '';
		const face = faceLines(id);
		if (face.length === 0) {
			out.push(line, ...inner);
		} else {
			const labelAt = inner.findIndex((item) => /^label:/.test(item));
			const kept = inner.filter((item, at) => at === labelAt || !BUTTON_FACE_KEY.test(item));
			const insertAt = labelAt < 0 ? 0 : kept.indexOf(inner[labelAt] ?? '');
			const rebuilt = [...kept.slice(0, insertAt), ...face, ...kept.slice(labelAt < 0 ? 0 : insertAt + 1)];
			if (rebuilt.join('\n') !== inner.join('\n')) changed = true;
			out.push(line, ...rebuilt);
		}
		if (end < lines.length) out.push(lines[end] ?? '');
		index = end;
	}
	return changed ? out.join(newline) : body;
}

const HOISTED_BUTTON_IDS = ['rv-log-home', 'rv-log-miss', 'rv-log-past', 'rv-log-housemate', 'rv-archive'] as const;

/**
 * A note with the Home / Not home button line gets Log past visit,
 * Add a housemate, and Archive beside them. Their hidden button blocks
 * sit at the top of the body so the ids exist before the button line renders.
 * A four-button line gains the housemate button. Notes without that line
 * are unchanged.
 */
export function ensureVisitButtons(body: string): string {
	const newline = body.includes('\r\n') ? '\r\n' : '\n';
	const lines = body.split(/\r?\n/);
	const at = lines.findIndex((line) => VISIT_BUTTON_ROW.test(line) || TWO_BUTTON_LINE.test(line));
	if (at < 0) return iconizeVisitButtons(body);
	const lead = (VISIT_BUTTON_ROW.exec(lines[at] ?? '') ?? TWO_BUTTON_LINE.exec(lines[at] ?? ''))?.[1] ?? '> ';
	lines[at] = `${lead}\`${VISIT_BUTTON_LINE}\``;
	const split = splitHoistedButtons(lines);
	const present = new Set(split.blocks.map(buttonBlockId));
	for (const spec of VISIT_BUTTON_BLOCKS) {
		if (!present.has(spec.id)) split.blocks.push(spec.block.split('\n'));
	}
	split.blocks.sort((left, right) => hoistRank(buttonBlockId(left)) - hoistRank(buttonBlockId(right)));
	const kept = trimEdgeBlanks(split.kept);
	const hoisted = split.blocks.flatMap((block, index) => (index === 0 ? block : ['', ...block]));
	const joined = [...hoisted, '', ...kept].join(newline);
	const trailing = body.endsWith('\n') || body.endsWith('\r\n') ? newline : '';
	return iconizeVisitButtons(joined.endsWith(newline) ? joined : `${joined}${trailing}`);
}

function hoistRank(id: string): number {
	const rank = HOISTED_BUTTON_IDS.indexOf(id as (typeof HOISTED_BUTTON_IDS)[number]);
	return rank < 0 ? HOISTED_BUTTON_IDS.length : rank;
}

function buttonBlockId(block: readonly string[]): string {
	return block.map((item) => /^id:\s*(\S+)\s*$/.exec(item)?.[1]).find((value) => value != null) ?? '';
}

function splitHoistedButtons(lines: readonly string[]): { kept: string[]; blocks: string[][] } {
	const kept: string[] = [];
	const blocks: string[][] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		if (!BUTTON_FENCE.test(line)) {
			kept.push(line);
			continue;
		}
		let end = index + 1;
		while (end < lines.length && !/^```[\t ]*$/.test(lines[end] ?? '')) end += 1;
		const chunk = lines.slice(index, Math.min(end + 1, lines.length));
		if (HOISTED_BUTTON_IDS.includes(buttonBlockId(chunk) as (typeof HOISTED_BUTTON_IDS)[number])) blocks.push(chunk);
		else kept.push(...chunk);
		index = end;
	}
	return { kept, blocks };
}

function trimEdgeBlanks(lines: readonly string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && (lines[start] ?? '').trim() === '') start += 1;
	while (end > start && (lines[end - 1] ?? '').trim() === '') end -= 1;
	return lines.slice(start, end);
}

/** `success`, `success with Devin`, or `not home`. The companion is only kept on a Home. */
export function visitPhrase(home: boolean, companion = ''): string {
	if (!home) return 'not home';
	const name = companion.trim();
	return name ? `success with ${name}` : 'success';
}

export function visitNotesField(property: string): string {
	return `\`INPUT[textArea:${property}]\``;
}

/** `sVisit1Notes` on a note with none, otherwise one past the highest number already used. */
export function nextVisitNotesProperty(body: string): string {
	let highest = 0;
	for (const match of body.matchAll(VISIT_NOTES_FIELD)) {
		const index = Number(match[1]);
		if (Number.isInteger(index) && index > highest) highest = index;
	}
	return `sVisit${highest + 1}Notes`;
}

/**
 * One empty line between the frontmatter and the RV Dashboard callout, so
 * Reading view leaves a line of space under the title. `body` is the text
 * after the closing `---`. Other notes are unchanged.
 */
export function ensureDashboardLeadBlank(body: string): string {
	const first = /^[^\r\n]*/.exec(body)?.[0] ?? '';
	if (!DASHBOARD_CALLOUT.test(first)) return body;
	const newline = body.includes('\r\n') ? '\r\n' : '\n';
	return `${newline}${body}`;
}

const STAMP_HEADING = /^(?:###|#####)\s+(.+?)\s*$/;

/**
 * Rewrite every Glancable visit stamp so the inline age matches `today`.
 * `###` stamps are promoted to `#####`. `### Recent Notes:` is left alone.
 * The age is calendar days, not a Dataview query.
 */
export function refreshHomeStampAges(body: string, today: Date): string {
	const sourced = restoreExactVisitClocks(body);
	const newline = sourced.includes('\r\n') ? '\r\n' : '\n';
	const lines = sourced.split(/\r?\n/);
	let changed = false;
	const next = lines.map((line) => {
		const updated = refreshStampLine(line, today);
		if (updated !== line) changed = true;
		return updated;
	});
	if (!changed) return sourced;
	const joined = next.join(newline);
	if ((body.endsWith('\n') || sourced.endsWith('\n')) && !joined.endsWith('\n')) return `${joined}\n`;
	return joined;
}

const DATED_STAMP = /(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat),?\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\s+[—–-]\s+[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}/gi;

/**
 * Hour-only visit stamps (`Tue, 10am — Sep 29, 2026`) pick up the exact minute
 * when that clock is still stored. Sources are a paired heading or Attempt Log
 * line that already has minutes, and Last Spoke, Last Attempted, and Met.
 * Two different minutes that round to the same hour are left alone.
 * A stamp with no stored minute stays as written.
 */
export function restoreExactVisitClocks(markdown: string, frontmatter?: Record<string, unknown> | null): string {
	const replacements = new Map<string, string | null>();
	const remember = (when: Date): void => {
		const rounded = formatGlancableVisitStamp(when);
		const exact = formatExactVisitStamp(when);
		if (rounded === exact) return;
		if (!replacements.has(rounded)) {
			replacements.set(rounded, exact);
			return;
		}
		if (replacements.get(rounded) !== exact) replacements.set(rounded, null);
	};
	if (frontmatter) {
		for (const name of ['Last Spoke', 'Last Attempted', 'Met']) {
			const when = storedVisitDate(readProperty(frontmatter, name));
			if (when) remember(when);
		}
	}
	for (const match of markdown.matchAll(DATED_STAMP)) {
		const text = match[0] ?? '';
		if (!/\d:\d{2}/.test(text)) continue;
		const when = stampDateTime(text);
		if (when) remember(when);
	}
	let next = markdown;
	for (const [rounded, exact] of replacements) {
		if (!exact || !next.includes(rounded)) continue;
		next = next.replaceAll(rounded, exact);
	}
	return next;
}

function storedVisitDate(value: unknown): Date | null {
	const raw = value instanceof Date ? formatFrontmatterDateTime(value) : typeof value === 'string' ? value.trim() : '';
	const match = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(raw);
	if (!match) return null;
	const date = new Date(
		Number(match[1]),
		Number(match[2]) - 1,
		Number(match[3]),
		Number(match[4]),
		Number(match[5]),
		Number(match[6] ?? 0),
	);
	return Number.isNaN(date.getTime()) ? null : date;
}

function refreshStampLine(line: string, today: Date): string {
	const match = STAMP_HEADING.exec(line);
	if (!match) return line;
	const stamp = stripStampAge(match[1] ?? '');
	const days = calendarDaysSinceStamp(stamp, today);
	if (days == null) return line;
	return `##### ${stamp} <span class="rv-stamp-ago">${formatDaysAgo(days)}</span>`;
}

/** One `### Recent Notes:` above the first visit stamp. `### Visit Notes:` is renamed. Notes with no stamp are left alone. */
export function ensureVisitNotesHeading(body: string): string {
	const newline = body.includes('\r\n') ? '\r\n' : '\n';
	const lines = body.split(/\r?\n/);
	let changed = false;
	const renamed = lines.map((line) => {
		if (line.trim() !== LEGACY_VISIT_NOTES_HEADING) return line;
		changed = true;
		return line.replace(LEGACY_VISIT_NOTES_HEADING, VISIT_NOTES_HEADING);
	});
	if (renamed.some((line) => line.trim() === VISIT_NOTES_HEADING)) {
		if (!changed) return body;
		const joined = renamed.join(newline);
		if (body.endsWith('\n') && !joined.endsWith('\n')) return `${joined}\n`;
		return joined;
	}
	const stampAt = renamed.findIndex((line) => isVisitStampLine(line));
	if (stampAt < 0) return changed ? renamed.join(newline) : body;
	const next = [...renamed.slice(0, stampAt), VISIT_NOTES_HEADING, ...renamed.slice(stampAt)];
	const joined = next.join(newline);
	if (body.endsWith('\n') && !joined.endsWith('\n')) return `${joined}\n`;
	return joined;
}

export function isVisitStampLine(line: string): boolean {
	const match = STAMP_HEADING.exec(line);
	if (!match) return false;
	return calendarDaysSinceStamp(stripStampAge(match[1] ?? ''), new Date()) != null;
}

/** `##`, `###`, or `#####` visit stamps. Used to place a new visit above older ones. `##` is not promoted. */
function isStoredVisitLine(line: string): boolean {
	const match = /^(?:##|###|#####)\s+(.+?)\s*$/.exec(line.replace(/\r$/, ''));
	if (!match) return false;
	const text = stripStampAge(match[1] ?? '').trim();
	if (/^(?:visit|recent) notes:?$/i.test(text)) return false;
	return calendarDaysSinceStamp(text, new Date()) != null;
}

function bumpCount(frontmatter: Record<string, unknown>, name: string): void {
	const current = finiteCount(readProperty(frontmatter, name));
	assignProperty(frontmatter, name, (current ?? 0) + 1);
}

function finiteCount(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value !== 'string') return null;
	const text = value.trim();
	if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : null;
}

export type AttemptLogHit = { index: number; kind: 'callout' | 'heading' };

export function findAttemptLog(lines: string[]): AttemptLogHit | null {
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		if (ATTEMPT_LOG_CALLOUT.test(line)) return { index, kind: 'callout' };
		if (ATTEMPT_LOG_HEADING.test(line)) return { index, kind: 'heading' };
	}
	return null;
}

export function sectionEnd(lines: string[], start: number, kind: AttemptLogHit['kind']): number {
	if (kind === 'callout') {
		let end = start + 1;
		while (end < lines.length && /^>/.test(lines[end] ?? '')) end += 1;
		return end;
	}
	for (let index = start + 1; index < lines.length; index += 1) {
		if (/^#{1,2}\s+/.test(lines[index] ?? '')) return index;
	}
	return lines.length;
}

function toCalloutBodyLine(line: string): string {
	if (line.startsWith('>')) return line;
	if (line.trim() === '') return '>';
	return `> ${line}`;
}

function migrateHeadingToCallout(lines: string[], start: number): string[] {
	const end = sectionEnd(lines, start, 'heading');
	const section = lines.slice(start + 1, end);
	while (section.length > 0 && section[section.length - 1]?.trim() === '') section.pop();
	const callout = [CALLOUT_HEADER, ...section.map(toCalloutBodyLine)];
	return [...lines.slice(0, start), ...callout, ...lines.slice(end)];
}

export function ensureAttemptLog(body: string): string {
	const normalized = body.replace(/\s*$/, '');
	const lines = normalized.split('\n');
	const found = findAttemptLog(lines);
	if (!found) {
		const gap = normalized.length > 0 ? '\n\n' : '';
		return `${normalized}${gap}${CALLOUT_HEADER}`;
	}
	if (found.kind === 'heading') return migrateHeadingToCallout(lines, found.index).join('\n');
	return normalized;
}

/**
 * Stamp and notes box at the top of the visit list, under Recent Notes.
 * Older stamps stay below it in the file. A note with no stamp yet still
 * inserts just above Attempt Log, and the heading is added above that stamp.
 */
export function insertHomeHeading(body: string, stamp: string, notesProperty?: string): string {
	const lines = body.split('\n').map((line) => (
		line.trim() === LEGACY_VISIT_NOTES_HEADING ? line.replace(LEGACY_VISIT_NOTES_HEADING, VISIT_NOTES_HEADING) : line
	));
	const heading = `${STAMP_LEVEL} ${stamp}`;
	const field = visitNotesField(notesProperty ?? nextVisitNotesProperty(body));
	const notesAt = lines.findIndex((line) => line.trim() === VISIT_NOTES_HEADING);
	if (notesAt >= 0) {
		let at = notesAt + 1;
		if ((lines[at] ?? '').trim() === '') at += 1;
		return [...lines.slice(0, at), heading, field, '', ...lines.slice(at)].join('\n');
	}
	const stampAt = lines.findIndex((line) => isStoredVisitLine(line));
	if (stampAt >= 0) {
		return [...lines.slice(0, stampAt), VISIT_NOTES_HEADING, heading, field, '', ...lines.slice(stampAt)].join('\n');
	}
	const found = findAttemptLog(lines);
	if (!found || found.kind !== 'callout') return lines.join('\n');
	const anchor = attemptLogAnchor(lines, found.index);
	const before = lines.slice(0, anchor);
	while (before.length > 0 && before[before.length - 1] === '') before.pop();
	const after = lines.slice(anchor);
	const last = before[before.length - 1]?.trim() ?? '';
	const lead = before.length === 0 || last === VISIT_NOTES_HEADING ? [] : [''];
	return [...before, ...lead, heading, field, '', ...after].join('\n');
}

export function appendLogLine(body: string, line: string): string {
	let lines = body.split('\n');
	let found = findAttemptLog(lines);
	if (!found) return body;
	if (found.kind === 'heading') {
		lines = migrateHeadingToCallout(lines, found.index);
		found = findAttemptLog(lines);
		if (!found || found.kind !== 'callout') return body;
	}
	const end = sectionEnd(lines, found.index, 'callout');
	const section = lines.slice(found.index, end);
	while (section.length > 1 && /^>\s*$/.test(section[section.length - 1] ?? '')) section.pop();
	while (section.length > 0 && section[section.length - 1] === '') section.pop();
	const depth = quoteDepth(section[0] ?? '');
	if (section.length > 1 && /^(?:>\s*)+\|/.test(section[section.length - 1] ?? '')) {
		section.push(depth >= 2 ? '> >' : '>');
	}
	section.push(formatLogBullet(section[0] ?? '', line));
	const rest = lines.slice(end);
	const gap = rest.length > 0 && rest[0] !== '' ? [''] : [];
	return [...lines.slice(0, found.index), ...section, ...gap, ...rest].join('\n').replace(/\s*$/, '') + '\n';
}

function quoteDepth(line: string): number {
	const lead = /^(?:>\s*)+/.exec(line)?.[0] ?? '>';
	return Math.max(1, (lead.match(/>/g) ?? []).length);
}

export function formatLogBullet(header: string, line: string): string {
	const text = line.replace(/^(?:>\s*)+/, '').replace(/^[-*]\s+/, '').trim();
	const depth = quoteDepth(header);
	if (depth <= 1) return `> - ${text}`;
	const marks = Array.from({ length: depth }, () => '>').join(' ');
	return `${marks}- ${text}`;
}
