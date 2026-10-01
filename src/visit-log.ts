import { attemptLogAnchor } from './attempt-digest';
import { appendCompanionTaken } from './companions';
import { calendarDaysSinceStamp, formatDaysAgo, formatExactVisitStamp, stripStampAge } from './dates';
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
const VISIT_NOTES_HEADING = '### Visit Notes:';
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
 * `### Visit Notes:` is added once, above the first visit stamp. Notes
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
	'rv-archive': { icon: 'archive', tooltip: 'Archive' },
};

function faceLines(id: string): string[] {
	const face = VISIT_BUTTON_FACES[id];
	if (!face) return [];
	return ['label: ""', `icon: ${face.icon}`, `tooltip: ${face.tooltip}`];
}

const VISIT_BUTTON_BLOCKS: ReadonlyArray<{ id: string; block: string }> = [
	{
		id: 'rv-log-past',
		block: ['```meta-bind-button', ...faceLines('rv-log-past'), 'style: default', 'class: rv-visit-btn', 'id: rv-log-past', 'hidden: true', 'actions:', '  - type: command', '    command: rv-locator:log-past-visit', '```'].join('\n'),
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

/**
 * A note with the Home / Not home button line gets Log past visit and
 * Archive beside them, and their hidden button blocks at the end. Notes
 * without that line, or already on four buttons, are unchanged.
 */
export function ensureVisitButtons(body: string): string {
	const newline = body.includes('\r\n') ? '\r\n' : '\n';
	const lines = body.split(/\r?\n/);
	const at = lines.findIndex((line) => TWO_BUTTON_LINE.test(line));
	if (at < 0) return iconizeVisitButtons(body);
	const lead = TWO_BUTTON_LINE.exec(lines[at] ?? '')?.[1] ?? '> ';
	lines[at] = `${lead}\`BUTTON[rv-log-home, rv-log-miss, rv-log-past, rv-archive]\``;
	let next = lines.join(newline);
	const missing = VISIT_BUTTON_BLOCKS.filter(({ id }) => !new RegExp(`^id:\\s*${id}\\s*$`, 'm').test(next));
	if (missing.length === 0) return iconizeVisitButtons(next);
	const trailing = /\s*$/.exec(next)?.[0] ?? '';
	next = next.slice(0, next.length - trailing.length);
	const blocks = missing.map(({ block }) => block.split('\n').join(newline)).join(`${newline}${newline}`);
	return iconizeVisitButtons(`${next}${newline}${newline}${blocks}${newline}`);
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
 * `###` stamps are promoted to `#####`. `### Visit Notes:` is left alone.
 * The age is calendar days, not a Dataview query.
 */
export function refreshHomeStampAges(body: string, today: Date): string {
	const newline = body.includes('\r\n') ? '\r\n' : '\n';
	const lines = body.split(/\r?\n/);
	let changed = false;
	const next = lines.map((line) => {
		const updated = refreshStampLine(line, today);
		if (updated !== line) changed = true;
		return updated;
	});
	if (!changed) return body;
	const joined = next.join(newline);
	if (body.endsWith('\n') && !joined.endsWith('\n')) return `${joined}\n`;
	return joined;
}

function refreshStampLine(line: string, today: Date): string {
	const match = STAMP_HEADING.exec(line);
	if (!match) return line;
	const stamp = stripStampAge(match[1] ?? '');
	const days = calendarDaysSinceStamp(stamp, today);
	if (days == null) return line;
	return `##### ${stamp} <span class="rv-stamp-ago">${formatDaysAgo(days)}</span>`;
}

/** One `### Visit Notes:` above the first visit stamp. Notes with no stamp are left alone. */
export function ensureVisitNotesHeading(body: string): string {
	if (body.split(/\r?\n/).some((line) => line.trim() === VISIT_NOTES_HEADING)) return body;
	const newline = body.includes('\r\n') ? '\r\n' : '\n';
	const lines = body.split(/\r?\n/);
	const stampAt = lines.findIndex((line) => isVisitStampLine(line));
	if (stampAt < 0) return body;
	const next = [...lines.slice(0, stampAt), VISIT_NOTES_HEADING, ...lines.slice(stampAt)];
	const joined = next.join(newline);
	if (body.endsWith('\n') && !joined.endsWith('\n')) return `${joined}\n`;
	return joined;
}

export function isVisitStampLine(line: string): boolean {
	const match = STAMP_HEADING.exec(line);
	if (!match) return false;
	return calendarDaysSinceStamp(stripStampAge(match[1] ?? ''), new Date()) != null;
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

/** Stamp and notes box just above the Attempt Log region, after every existing stamp. */
export function insertHomeHeading(body: string, stamp: string, notesProperty?: string): string {
	const lines = body.split('\n');
	const found = findAttemptLog(lines);
	if (!found || found.kind !== 'callout') return body;
	const anchor = attemptLogAnchor(lines, found.index);
	const before = lines.slice(0, anchor);
	while (before.length > 0 && before[before.length - 1] === '') before.pop();
	const after = lines.slice(anchor);
	const heading = `${STAMP_LEVEL} ${stamp}`;
	const field = visitNotesField(notesProperty ?? nextVisitNotesProperty(body));
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
