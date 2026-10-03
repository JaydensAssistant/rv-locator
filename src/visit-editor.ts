import { appendCompanionTaken, companionDisplayName, companionKey, takenItems } from './companions';
import { formatGlancableStampFromRaw, stripStampAge } from './dates';
import { assignProperty, readProperty, removeProperty } from './frontmatter';
import { parseLogBullet, stampDateTime } from './schedule';
import {
	appendLogLine,
	ensureAttemptLog,
	ensureDashboardLeadBlank,
	ensureVisitNotesHeading,
	findAttemptLog,
	formatFrontmatterDateTime,
	formatLogBullet,
	formatVisitStamp,
	insertHomeHeading,
	nextVisitNotesProperty,
	refreshHomeStampAges,
	sectionEnd,
	unfoldDashboard,
	visitNotesField,
	visitPhrase,
} from './visit-log';

/** What one visit recorded: when, whether they were home, and who was taken. */
export interface VisitFacts {
	when: Date;
	home: boolean;
	companion: string;
}

/**
 * One visit on the note. Line numbers are 0-based into the body passed to
 * {@link listVisits}. A Home usually has both a `#####` stamp and an Attempt
 * Log bullet. Either can be missing on an older or hand-edited note.
 */
export interface VisitEntry extends VisitFacts {
	stamp: string;
	bulletLine: number | null;
	headingLine: number | null;
	notesProperty: string | null;
}

const STAMP_HEADING = /^(?:###|#####)\s+(.+?)\s*$/;
const NOTES_FIELD = /`INPUT\[textArea:([A-Za-z0-9_-]+)\]`/;

function logRegion(lines: string[]): { start: number; end: number; header: string } | null {
	const found = findAttemptLog(lines);
	if (!found) return null;
	return { start: found.index, end: sectionEnd(lines, found.index, found.kind), header: lines[found.index] ?? '' };
}

function headingWhen(line: string): Date | null {
	const match = STAMP_HEADING.exec(line.replace(/\r$/, ''));
	if (!match) return null;
	return stampDateTime(stripStampAge(match[1] ?? ''));
}

function inRegion(index: number, region: { start: number; end: number } | null): boolean {
	return region != null && index >= region.start && index < region.end;
}

/**
 * Every visit on the note, oldest first. Bullets are read from the Attempt
 * Log only. The nth `#####` stamp for an hour is paired with the nth Home
 * bullet for that hour. An unpaired stamp is listed as a Home with no bullet.
 */
export function listVisits(body: string): VisitEntry[] {
	const lines = body.split('\n');
	const region = logRegion(lines);
	const entries: VisitEntry[] = [];
	if (region) {
		for (let index = region.start + 1; index < region.end; index += 1) {
			const bullet = parseLogBullet((lines[index] ?? '').replace(/\r$/, ''));
			if (!bullet) continue;
			entries.push({
				when: bullet.when,
				home: bullet.home,
				companion: bullet.companion,
				stamp: formatVisitStamp(bullet.when),
				bulletLine: index,
				headingLine: null,
				notesProperty: null,
			});
		}
	}
	for (let index = 0; index < lines.length; index += 1) {
		if (inRegion(index, region)) continue;
		const when = headingWhen(lines[index] ?? '');
		if (!when) continue;
		const notesProperty = NOTES_FIELD.exec(lines[index + 1] ?? '')?.[1] ?? null;
		const partner = entries.find((entry) => entry.home && entry.headingLine == null && entry.bulletLine != null && entry.when.getTime() === when.getTime());
		if (partner) {
			partner.headingLine = index;
			partner.notesProperty = notesProperty;
			continue;
		}
		entries.push({
			when,
			home: true,
			companion: '',
			stamp: formatVisitStamp(when),
			bulletLine: null,
			headingLine: index,
			notesProperty,
		});
	}
	return entries
		.map((entry, order) => ({ entry, order }))
		.sort((left, right) => left.entry.when.getTime() - right.entry.when.getTime() || left.order - right.order)
		.map(({ entry }) => entry);
}

/** End (exclusive) of a stamp's notes: the next stamp, heading, rule, callout, or EOF. */
function notesBlockEnd(lines: string[], heading: number): number {
	for (let index = heading + 1; index < lines.length; index += 1) {
		const line = (lines[index] ?? '').replace(/\r$/, '');
		if (/^#{1,6}\s/.test(line)) return index;
		if (/^([-*_])\1{2,}\s*$/.test(line.trim())) return index;
		if (line.startsWith('>')) return index;
		if (/^```/.test(line)) return index;
	}
	return lines.length;
}

/** The stamp line and everything written under it, without trailing blank lines. */
export function visitNotesBlock(body: string, entry: VisitEntry): string[] {
	if (entry.headingLine == null) return [];
	const lines = body.split('\n');
	const block = lines.slice(entry.headingLine, notesBlockEnd(lines, entry.headingLine));
	while (block.length > 1 && (block[block.length - 1] ?? '').trim() === '') block.pop();
	return block;
}

/**
 * Drop one visit from the body: its Attempt Log bullet, and for a Home its
 * `#####` stamp with the notes box and anything written under it.
 */
export function removeVisit(body: string, entry: VisitEntry): string {
	const lines = body.split('\n');
	const drop = new Set<number>();
	if (entry.bulletLine != null) drop.add(entry.bulletLine);
	if (entry.headingLine != null) {
		const end = notesBlockEnd(lines, entry.headingLine);
		for (let index = entry.headingLine; index < end; index += 1) drop.add(index);
	}
	return lines.filter((_, index) => !drop.has(index)).join('\n');
}

export interface InsertVisitOptions {
	now?: Date;
	/** Reuse this `sVisitNNotes` property instead of the next free one. */
	notesProperty?: string | null;
	/** Lines kept under the stamp on an edit. The first line is replaced by the new stamp. */
	notesBlock?: readonly string[];
}

/**
 * Insert a visit where it belongs by time. A Home stamp goes above the first
 * later stamp, or after the last one. The bullet goes above the first later
 * bullet, or at the end of the Attempt Log.
 */
export function insertVisit(body: string, facts: VisitFacts, options: InsertVisitOptions = {}): string {
	const stamp = formatVisitStamp(facts.when);
	const at = facts.when.getTime();
	let next = ensureAttemptLog(body);
	if (facts.home) {
		const property = options.notesProperty || nextVisitNotesProperty(next);
		const heading = `##### ${stamp}`;
		const block = options.notesBlock && options.notesBlock.length > 0
			? [heading, ...options.notesBlock.slice(1)]
			: [heading, visitNotesField(property)];
		const lines = next.split('\n');
		const region = logRegion(lines);
		const headings: Array<{ index: number; when: number }> = [];
		for (let index = 0; index < lines.length; index += 1) {
			if (inRegion(index, region)) continue;
			const when = headingWhen(lines[index] ?? '');
			if (!when) continue;
			headings.push({ index, when: when.getTime() });
		}
		const newer = headings.filter((item) => item.when >= at).length;
		if (headings.length === 0) {
			const placeholder = insertHomeHeading(next, stamp, property);
			next = options.notesBlock && options.notesBlock.length > 0
				? replaceInsertedBlock(placeholder, heading, visitNotesField(property), block)
				: placeholder;
		} else if (newer >= headings.length) {
			const last = headings[headings.length - 1];
			const end = last ? notesBlockEnd(lines, last.index) : lines.length;
			const gap = end < lines.length && (lines[end] ?? '') !== '' ? [''] : [];
			next = [...lines.slice(0, end), ...block, '', ...gap, ...lines.slice(end)].join('\n');
		} else {
			const atLine = headings[newer]?.index ?? lines.length;
			next = [...lines.slice(0, atLine), ...block, '', ...lines.slice(atLine)].join('\n');
		}
	}
	const text = `${stamp} — ${visitPhrase(facts.home, facts.companion)}`;
	const lines = next.split('\n');
	const region = logRegion(lines);
	let laterBullet = -1;
	if (region) {
		for (let index = region.start + 1; index < region.end; index += 1) {
			const bullet = parseLogBullet((lines[index] ?? '').replace(/\r$/, ''));
			if (bullet && bullet.when.getTime() > at) {
				laterBullet = index;
				break;
			}
		}
	}
	if (region && laterBullet >= 0) {
		next = [...lines.slice(0, laterBullet), formatLogBullet(region.header, text), ...lines.slice(laterBullet)].join('\n');
	} else {
		next = appendLogLine(next, `> - ${text}`);
	}
	next = refreshHomeStampAges(next, options.now ?? new Date());
	next = ensureVisitNotesHeading(next);
	return ensureDashboardLeadBlank(unfoldDashboard(next));
}

function replaceInsertedBlock(body: string, heading: string, field: string, block: readonly string[]): string {
	const lines = body.split('\n');
	for (let index = lines.length - 2; index >= 0; index -= 1) {
		if (lines[index] === heading && lines[index + 1] === field) {
			return [...lines.slice(0, index), ...block, ...lines.slice(index + 2)].join('\n');
		}
	}
	return body;
}

/**
 * Move or change one visit. A Home that stays a Home keeps its notes box and
 * what was written under the stamp.
 */
export function editVisit(body: string, entry: VisitEntry, facts: VisitFacts, now: Date = new Date()): string {
	const keep = entry.home && facts.home;
	const notesBlock = keep ? visitNotesBlock(body, entry) : [];
	const removed = removeVisit(body, entry);
	return insertVisit(removed, facts, {
		now,
		notesProperty: keep ? entry.notesProperty : null,
		notesBlock,
	});
}

export interface VisitChange {
	removed?: VisitFacts | null;
	added?: VisitFacts | null;
	/** Every other visit still on the note, not counting `added`. */
	remaining: readonly VisitFacts[];
	/** Notes property of the removed Home. Dropped unless the visit stays a Home. */
	removedNotesProperty?: string | null;
}

/**
 * Frontmatter after a visit is deleted, backfilled, or edited.
 * Visits and Successful Visits move by the difference and never go below 0.
 * Last Attempted and Last Spoke move to the latest remaining visit when they
 * were set by the removed one, or forward when an added visit is later.
 * A companion leaves Taken only when no other visit records them and they
 * are not Met With. Met With is not changed. Met becomes the earliest
 * logged visit that is not in the future.
 */
export function applyVisitChangeFrontmatter(frontmatter: Record<string, unknown>, change: VisitChange): void {
	const removed = change.removed ?? null;
	const added = change.added ?? null;
	const after = [...change.remaining, ...(added ? [added] : [])];
	shiftCount(frontmatter, 'Visits', (added ? 1 : 0) - (removed ? 1 : 0));
	shiftCount(frontmatter, 'Successful Visits', (added?.home ? 1 : 0) - (removed?.home ? 1 : 0));
	moveLatest(frontmatter, 'Last Attempted', removed, after);
	moveLatest(frontmatter, 'Last Spoke', removed?.home ? removed : null, after.filter((visit) => visit.home));
	updateTaken(frontmatter, removed, added, after);
	syncMet(frontmatter, after, new Date());
	const property = change.removedNotesProperty?.trim();
	if (removed?.home && property && !added?.home) removeProperty(frontmatter, property);
}

function shiftCount(frontmatter: Record<string, unknown>, name: string, delta: number): void {
	if (delta === 0) return;
	const current = countValue(readProperty(frontmatter, name));
	assignProperty(frontmatter, name, Math.max(0, (current ?? 0) + delta));
}

function countValue(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return Number(value.trim());
	return null;
}

function rawDate(value: unknown): string {
	if (value instanceof Date && !Number.isNaN(value.getTime())) return formatFrontmatterDateTime(value);
	return typeof value === 'string' ? value.trim() : '';
}

/** Local date-time from a stored `2026-09-29T17:20:00`. A zone suffix is ignored. */
export function parseFrontmatterDateTime(raw: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(raw.trim());
	if (!match) return null;
	const date = new Date(
		Number(match[1]),
		Number(match[2]) - 1,
		Number(match[3]),
		Number(match[4] ?? 0),
		Number(match[5] ?? 0),
		Number(match[6] ?? 0),
	);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** Earliest logged visit that is not later than `now`. Future visits do not move Met. */
export function earliestNonFutureVisit(visits: readonly { when: Date }[], now: Date): Date | null {
	let earliest: Date | null = null;
	for (const visit of visits) {
		if (visit.when.getTime() > now.getTime()) continue;
		if (!earliest || visit.when.getTime() < earliest.getTime()) earliest = visit.when;
	}
	return earliest;
}

export function syncMet(frontmatter: Record<string, unknown>, visits: readonly { when: Date }[], now: Date): void {
	const earliest = earliestNonFutureVisit(visits, now);
	if (!earliest) return;
	const next = formatFrontmatterDateTime(earliest);
	const current = rawDate(readProperty(frontmatter, 'Met'));
	if (current === next) return;
	assignProperty(frontmatter, 'Met', next);
}

function latestOf(visits: readonly VisitFacts[]): Date | null {
	let latest: Date | null = null;
	for (const visit of visits) {
		if (!latest || visit.when.getTime() > latest.getTime()) latest = visit.when;
	}
	return latest;
}

function moveLatest(frontmatter: Record<string, unknown>, name: string, removed: VisitFacts | null, after: readonly VisitFacts[]): void {
	const raw = rawDate(readProperty(frontmatter, name));
	const current = parseFrontmatterDateTime(raw);
	const latest = latestOf(after);
	if (removed && current) {
		const removedStamp = formatVisitStamp(removed.when);
		const setByRemoved = formatGlancableStampFromRaw(raw) === removedStamp;
		const stillThere = after.some((visit) => formatVisitStamp(visit.when) === removedStamp);
		if (setByRemoved && !stillThere) {
			assignProperty(frontmatter, name, latest ? formatFrontmatterDateTime(latest) : '');
			return;
		}
	}
	if (!latest) return;
	if (!current || latest.getTime() > current.getTime()) {
		if (current && formatGlancableStampFromRaw(raw) === formatVisitStamp(latest)) return;
		assignProperty(frontmatter, name, formatFrontmatterDateTime(latest));
	}
}

function updateTaken(frontmatter: Record<string, unknown>, removed: VisitFacts | null, added: VisitFacts | null, after: readonly VisitFacts[]): void {
	const original = takenItems(readProperty(frontmatter, 'Taken'));
	let items = original;
	const gone = removed?.home ? companionKey(removed.companion) : '';
	if (gone) {
		const metWith = companionKey(companionDisplayName(readProperty(frontmatter, 'Met With')));
		const recorded = after.some((visit) => visit.home && companionKey(visit.companion) === gone);
		if (!recorded && metWith !== gone) items = items.filter((item) => companionKey(item) !== gone);
	}
	if (added?.home && added.companion.trim()) items = appendCompanionTaken(items, added.companion.trim());
	const same = items.length === original.length && items.every((item, index) => item === original[index]);
	if (!same) assignProperty(frontmatter, 'Taken', items);
}

/** `Tue, 5pm — Sep 29, 2026 · Home with Devin` for menus and confirmations. */
export function describeVisit(entry: VisitFacts): string {
	const outcome = entry.home ? 'Home' : 'Not home';
	const name = entry.home ? entry.companion.trim() : '';
	return `${formatVisitStamp(entry.when)} · ${outcome}${name ? ` with ${name}` : ''}`;
}

/** Visit facts without the line bookkeeping. */
export function visitFacts(entry: VisitFacts): VisitFacts {
	return { when: entry.when, home: entry.home, companion: entry.companion };
}

export interface VisitHint {
	when: Date;
	home: boolean;
	ordinal?: number;
	headingLine?: number | null;
	bulletLine?: number | null;
}

/** Find a visit again on a fresh read. An exact stamp or bullet line wins over the ordinal. */
export function resolveVisit(list: readonly VisitEntry[], hint: VisitHint): VisitEntry | null {
	const at = hint.when.getTime();
	const same = (entry: VisitEntry) => entry.when.getTime() === at && entry.home === hint.home;
	if (hint.headingLine != null) {
		const hit = list.find((entry) => entry.headingLine === hint.headingLine && same(entry));
		if (hit) return hit;
	}
	if (hint.bulletLine != null) {
		const hit = list.find((entry) => entry.bulletLine === hint.bulletLine && same(entry));
		if (hit) return hit;
	}
	const matches = list.filter(same);
	return matches[hint.ordinal ?? 0] ?? matches[0] ?? null;
}

export function hintFor(list: readonly VisitEntry[], entry: VisitEntry): VisitHint {
	const matches = list.filter((other) => other.when.getTime() === entry.when.getTime() && other.home === entry.home);
	return {
		when: entry.when,
		home: entry.home,
		ordinal: Math.max(0, matches.indexOf(entry)),
		headingLine: entry.headingLine,
		bulletLine: entry.bulletLine,
	};
}

/** `2026-09-29` for an `<input type="date">`. */
export function dateInputValue(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local date from `2026-09-29` at `hour` o'clock. Null for a blank or invalid date. */
export function visitWhenFrom(dateText: string, hour: number): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText.trim());
	if (!match || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const day = Number(match[3]);
	const date = new Date(year, month, day, hour, 0, 0, 0);
	if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
	return date;
}

/** `12am` … `11pm`. */
export function hourLabel(hour: number): string {
	const onClock = hour % 12 === 0 ? 12 : hour % 12;
	return `${onClock}${hour >= 12 ? 'pm' : 'am'}`;
}

/** The hour a stamp would round `date` to, for the time picker. */
export function roundedHour(date: Date): { date: Date; hour: number } {
	const shifted = new Date(date.getTime());
	if (shifted.getMinutes() >= 30) shifted.setHours(shifted.getHours() + 1);
	shifted.setMinutes(0, 0, 0);
	return { date: shifted, hour: shifted.getHours() };
}

export const PAST_VISIT_DEFAULT_HOUR = 10;

/** 10am today, or 10am yesterday while it is still before 10am. */
export function defaultPastVisitTime(now: Date): { date: Date; hour: number } {
	const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), PAST_VISIT_DEFAULT_HOUR, 0, 0, 0);
	if (date.getTime() > now.getTime()) date.setDate(date.getDate() - 1);
	return { date, hour: PAST_VISIT_DEFAULT_HOUR };
}

/** A past visit may not be later than `now`, rounded to the hour. */
export function isFutureVisit(when: Date, now: Date): boolean {
	return formatVisitStamp(when) !== formatVisitStamp(now) && when.getTime() > now.getTime();
}
