import { appendCompanionTaken } from './companions';
import { formatGlancableVisitStamp } from './dates';
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

/** `> [!note]-`, `> [!note]+`, and an unmarked `> [!note]` title all count. */
const ATTEMPT_LOG_CALLOUT = /^>\s*\[!note\]\s*([+-])?\s*Attempt Log\s*$/i;
const ATTEMPT_LOG_HEADING = /^## Attempt Log\s*$/;
const ADDRESS_KEY = 'Address';
const CALLOUT_HEADER = '> [!note]- Attempt Log';
const STAMP_LEVEL = '###';
/** Empty lines between a new `###` stamp and Attempt Log. The extra line is note padding. */
const STAMP_NOTE_BLANKS = 2;

/** Local date-time stored on Last Spoke / Last Attempted. No UTC shift. */
export function formatFrontmatterDateTime(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Glancable drive date: weekday, hour rounded to the nearest hour, then the calendar date. */
export function formatVisitStamp(date: Date): string {
	return formatGlancableVisitStamp(date);
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
 * A home visit inserts `### <stamp>` and two blank lines just above Attempt Log
 * (one extra line of padding for notes). A second Home in the same rounded
 * hour still inserts another stamp.
 * Both outcomes append `> - <stamp> — success|not home` inside a collapsed
 * `> [!note]- Attempt Log` callout. An old `## Attempt Log` heading is migrated
 * to that callout on write. Address is not part of the body edit.
 */
export function applyVisitBody(body: string, outcome: VisitOutcome, now: Date): string {
	const stamp = formatVisitStamp(now);
	const phrase = outcome === 'home' ? 'success' : 'not home';
	let next = ensureAttemptLog(body);
	if (outcome === 'home') next = insertHomeHeading(next, stamp);
	return appendLogLine(next, `> - ${stamp} — ${phrase}`);
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

type AttemptLogHit = { index: number; kind: 'callout' | 'heading' };

function findAttemptLog(lines: string[]): AttemptLogHit | null {
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		if (ATTEMPT_LOG_CALLOUT.test(line)) return { index, kind: 'callout' };
		if (ATTEMPT_LOG_HEADING.test(line)) return { index, kind: 'heading' };
	}
	return null;
}

function sectionEnd(lines: string[], start: number, kind: AttemptLogHit['kind']): number {
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

function ensureAttemptLog(body: string): string {
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

function insertHomeHeading(body: string, stamp: string): string {
	const lines = body.split('\n');
	const found = findAttemptLog(lines);
	if (!found || found.kind !== 'callout') return body;
	const before = lines.slice(0, found.index);
	while (before.length > 0 && before[before.length - 1] === '') before.pop();
	const after = lines.slice(found.index);
	const heading = `${STAMP_LEVEL} ${stamp}`;
	const padding = Array.from({ length: STAMP_NOTE_BLANKS }, () => '');
	const block = before.length > 0
		? ['', heading, ...padding, ...after]
		: [heading, ...padding, ...after];
	return [...before, ...block].join('\n');
}

function appendLogLine(body: string, line: string): string {
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
	section.push(line.startsWith('>') ? line : `> ${line}`);
	const rest = lines.slice(end);
	const gap = rest.length > 0 && rest[0] !== '' ? [''] : [];
	return [...lines.slice(0, found.index), ...section, ...gap, ...rest].join('\n').replace(/\s*$/, '') + '\n';
}
