/**
 * Weekday × daypart buckets for Attempt Log history.
 * Wednesday morning never shares a bucket with Saturday morning.
 * Boundaries are local time. Evening starts at 4:30.
 */
import { DIGEST_END, DIGEST_START } from './attempt-digest';

export const DAYPARTS = ['morning', 'afternoon', 'evening'] as const;

export type Daypart = (typeof DAYPARTS)[number];

/** Off, or the one on-state: the person may go out. */
export type AvailabilityLevel = 'off' | 'may';

export interface BucketCount {
	homes: number;
	trials: number;
}

export type AttemptBuckets = Record<string, BucketCount>;

export type AvailabilityGrid = Record<string, AvailabilityLevel>;

/** Days down the side, or dayparts down the side. */
export type DigestOrientation = 'rows' | 'columns';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Minutes from midnight, inclusive start. */
const DAYPART_START: Record<Daypart, number> = {
	morning: 0,
	afternoon: 12 * 60,
	evening: 16 * 60 + 30,
};

const LEGACY_DAYPARTS = ['early-morning', 'late-morning', 'afternoon', 'evening'] as const;

const MONTH_INDEX: Record<string, number> = {
	jan: 0,
	feb: 1,
	mar: 2,
	apr: 3,
	may: 4,
	jun: 5,
	jul: 6,
	aug: 7,
	sep: 8,
	oct: 9,
	nov: 10,
	dec: 11,
};

export function availabilityKey(weekday: number, daypart: Daypart): string {
	return `${weekday}:${daypart}`;
}

/** Every cell starts Off. A click turns on May go out. */
export function defaultAvailabilityGrid(): AvailabilityGrid {
	const grid: AvailabilityGrid = {};
	for (let weekday = 0; weekday < 7; weekday += 1) {
		for (const daypart of DAYPARTS) {
			grid[availabilityKey(weekday, daypart)] = 'off';
		}
	}
	return grid;
}

/**
 * Old grids used early morning, late morning, Willing, and Go out.
 * An untouched all-Willing grid (the 1.2.4 default) becomes all Off.
 * Any real choice maps Willing and Go out to May go out. Morning is May go out
 * when either old morning cell was on.
 */
export function migrateAvailabilityGrid(value: unknown): AvailabilityGrid {
	const grid = defaultAvailabilityGrid();
	if (!value || typeof value !== 'object') return grid;
	const raw = value as Record<string, unknown>;
	if (isUntouchedWillingDefault(raw)) return grid;
	for (let weekday = 0; weekday < 7; weekday += 1) {
		grid[availabilityKey(weekday, 'morning')] = mergeMorning(raw, weekday);
		grid[availabilityKey(weekday, 'afternoon')] = mapLevel(raw[`${weekday}:afternoon`]);
		grid[availabilityKey(weekday, 'evening')] = mapLevel(raw[`${weekday}:evening`]);
	}
	return grid;
}

export function daypartAt(date: Date): Daypart {
	const minutes = date.getHours() * 60 + date.getMinutes();
	if (minutes < DAYPART_START.afternoon) return 'morning';
	if (minutes < DAYPART_START.evening) return 'afternoon';
	return 'evening';
}

/** Short name used in the digest. Settings use {@link daypartSettingLabel}. */
export function daypartLabel(daypart: Daypart): string {
	switch (daypart) {
		case 'morning': return 'morning';
		case 'afternoon': return 'afternoon';
		case 'evening': return 'evening';
	}
}

export function daypartTitle(daypart: Daypart): string {
	switch (daypart) {
		case 'morning': return 'Morning';
		case 'afternoon': return 'Afternoon';
		case 'evening': return 'Evening';
	}
}

export function daypartSettingLabel(daypart: Daypart): string {
	switch (daypart) {
		case 'morning': return 'Morning (Before 12pm)';
		case 'afternoon': return 'Afternoon (12pm–4:29pm)';
		case 'evening': return 'Evening (After 4:30pm)';
	}
}

export function weekdayShort(weekday: number): string {
	return WEEKDAY_SHORT[weekday] ?? '';
}

/** 50% Laplace prior. Empty history is 0.5. A real 50% home rate stays 0.5. */
export function laplaceRate(homes: number, trials: number): number {
	const n = Math.max(0, trials);
	const h = Math.min(Math.max(0, homes), n);
	return (h + 1) / (n + 2);
}

/** Grows with sample size. Zero visits contribute nothing. */
export function sampleConfidence(trials: number): number {
	const n = Math.max(0, trials);
	return n / (n + 3);
}

/** May-go-out slots score. Off slots score 0. There is no Willing multiplier. */
export function slotScore(homes: number, trials: number, availability: AvailabilityLevel): number {
	if (availability !== 'may') return 0;
	const n = Math.max(0, trials);
	const h = Math.min(Math.max(0, homes), n);
	return laplaceRate(h, n) * sampleConfidence(n);
}

export function availabilityAt(grid: AvailabilityGrid, weekday: number, daypart: Daypart): AvailabilityLevel {
	return grid[availabilityKey(weekday, daypart)] === 'may' ? 'may' : 'off';
}

export interface AttemptEntry {
	weekday: number;
	daypart: Daypart;
	home: boolean;
	/** Written stamp, such as `Wed, 2pm — Sep 9, 2026`. */
	stamp: string;
}

/**
 * Attempt Log bullets are the source of truth. `success` and `Home` count as home.
 * `not home` and `miss` count as a miss. A `###` stamp is the same home visit as its
 * bullet and is counted only when that bullet is missing.
 * The written hour is the rounded local hour. 4:30 in the raw clock is evening; a rounded `4pm` stamp is afternoon.
 * Lines inside the digest markers are not attempts.
 */
export function readAttemptLog(body: string): { buckets: AttemptBuckets; entries: AttemptEntry[] } {
	const bullets: AttemptEntry[] = [];
	const headings: AttemptEntry[] = [];
	let inDigest = false;
	for (const raw of body.split('\n')) {
		const line = raw.trim();
		if (line.includes(DIGEST_START)) {
			inDigest = true;
			continue;
		}
		if (line.includes(DIGEST_END)) {
			inDigest = false;
			continue;
		}
		if (inDigest) continue;
		const bullet = parseBulletLine(line);
		if (bullet) {
			bullets.push(bullet);
			continue;
		}
		const heading = parseHeadingLine(line);
		if (heading) headings.push(heading);
	}
	const entries = [...bullets];
	const homesByStamp = new Map<string, number>();
	for (const entry of bullets) {
		if (!entry.home) continue;
		homesByStamp.set(entry.stamp, (homesByStamp.get(entry.stamp) ?? 0) + 1);
	}
	const headingsByStamp = new Map<string, { count: number; entry: AttemptEntry }>();
	for (const entry of headings) {
		const current = headingsByStamp.get(entry.stamp);
		if (current) current.count += 1;
		else headingsByStamp.set(entry.stamp, { count: 1, entry });
	}
	for (const [stamp, info] of headingsByStamp) {
		const have = homesByStamp.get(stamp) ?? 0;
		for (let extra = have; extra < info.count; extra += 1) entries.push(info.entry);
	}
	const buckets: AttemptBuckets = {};
	for (const entry of entries) {
		const key = availabilityKey(entry.weekday, entry.daypart);
		const current = buckets[key] ?? { homes: 0, trials: 0 };
		buckets[key] = {
			homes: current.homes + (entry.home ? 1 : 0),
			trials: current.trials + 1,
		};
	}
	return { buckets, entries };
}

export function parseAttemptLog(body: string): AttemptBuckets {
	return readAttemptLog(body).buckets;
}

export function totalTrials(buckets: AttemptBuckets): number {
	let sum = 0;
	for (const count of Object.values(buckets)) sum += count.trials;
	return sum;
}

export interface SlotFact {
	weekday: number;
	daypart: Daypart;
	availability: AvailabilityLevel;
	homes: number;
	trials: number;
	rate: number;
	confidence: number;
	score: number;
}

export interface ReturnDigest {
	/** Voice lines, or the empty-schedule line. History is only in markdown. */
	text: string;
	sentences: string[];
	table: string;
	/** Table, dated history, and the four voice lines, ready to store under Attempt Log. */
	markdown: string;
}

const NO_SCHEDULE = 'No May-go-out days';

/** Soft home rate. Empty history is 0.5. */
const TRY_SOFT_MIN = 0.42;
const AVOID_SOFT_MAX = 0.30;

/**
 * Compact table of May-go-out days, then dated Home / Not home lines,
 * then Try / Untried / Unsure / Avoid. Empty voice lines are omitted.
 */
export function suggestReturnDigest(args: {
	buckets: AttemptBuckets;
	entries?: readonly AttemptEntry[];
	grid: AvailabilityGrid;
	orientation?: DigestOrientation;
	now?: Date;
}): ReturnDigest {
	const orientation = args.orientation === 'columns' ? 'columns' : 'rows';
	const days = mayGoOutDays(args.grid);
	const history = historyLines(args.entries ?? []);
	if (days.length === 0) {
		const markdown = history.length > 0 ? [NO_SCHEDULE, '', ...history].join('\n') : NO_SCHEDULE;
		return { text: NO_SCHEDULE, sentences: [NO_SCHEDULE], table: '', markdown };
	}
	const facts = daypartFacts(days, args.buckets, args.grid);
	const table = orientation === 'columns'
		? tableDaysAsColumns(days, facts)
		: tableDaysAsRows(days, facts);
	const sentences = voiceLines(facts);
	const blocks = [table];
	if (history.length > 0) blocks.push(history.join('\n'));
	if (sentences.length > 0) blocks.push(sentences.join('\n'));
	return {
		text: sentences.join('\n'),
		sentences,
		table,
		markdown: blocks.join('\n\n'),
	};
}

function mayGoOutDays(grid: AvailabilityGrid): number[] {
	const days: number[] = [];
	for (let weekday = 0; weekday < 7; weekday += 1) {
		if (DAYPARTS.some((daypart) => availabilityAt(grid, weekday, daypart) === 'may')) days.push(weekday);
	}
	return days;
}

function daypartFacts(days: readonly number[], buckets: AttemptBuckets, grid: AvailabilityGrid): SlotFact[] {
	const facts: SlotFact[] = [];
	for (const weekday of days) {
		for (const daypart of DAYPARTS) {
			const availability = availabilityAt(grid, weekday, daypart);
			if (availability !== 'may') continue;
			const count = buckets[availabilityKey(weekday, daypart)] ?? { homes: 0, trials: 0 };
			const trials = Math.max(0, count.trials);
			const homes = Math.min(Math.max(0, count.homes), trials);
			facts.push({
				weekday,
				daypart,
				availability,
				homes,
				trials,
				rate: trials > 0 ? homes / trials : 0,
				confidence: sampleConfidence(trials),
				score: slotScore(homes, trials, availability),
			});
		}
	}
	return facts;
}

function tableDaysAsRows(days: readonly number[], facts: readonly SlotFact[]): string {
	const columns = DAYPARTS.filter((daypart) => facts.some((slot) => slot.daypart === daypart));
	const header = ['| |', ...columns.map((daypart) => ` ${daypartTitle(daypart)} |`)].join('');
	const rule = ['| --- |', ...columns.map(() => ' --- |')].join('');
	const body = days.map((weekday) => {
		const cells = columns.map((daypart) => ` ${cellText(facts, weekday, daypart)} |`);
		return `| ${weekdayShort(weekday)} |${cells.join('')}`;
	});
	return [header, rule, ...body].join('\n');
}

function tableDaysAsColumns(days: readonly number[], facts: readonly SlotFact[]): string {
	const rows = DAYPARTS.filter((daypart) => facts.some((slot) => slot.daypart === daypart));
	const header = ['| |', ...days.map((weekday) => ` ${weekdayShort(weekday)} |`)].join('');
	const rule = ['| --- |', ...days.map(() => ' --- |')].join('');
	const body = rows.map((daypart) => {
		const cells = days.map((weekday) => ` ${cellText(facts, weekday, daypart)} |`);
		return `| ${daypartTitle(daypart)} |${cells.join('')}`;
	});
	return [header, rule, ...body].join('\n');
}

function cellText(facts: readonly SlotFact[], weekday: number, daypart: Daypart): string {
	const slot = facts.find((item) => item.weekday === weekday && item.daypart === daypart);
	if (!slot) return '—';
	return `${slot.homes}/${slot.trials}`;
}

type VoiceBucket = 'try' | 'untried' | 'unsure' | 'avoid';

function voiceLines(facts: readonly SlotFact[]): string[] {
	const grouped: Record<VoiceBucket, SlotFact[]> = { try: [], untried: [], unsure: [], avoid: [] };
	for (const slot of facts) grouped[classifySlot(slot)].push(slot);
	const lines = [
		tryLine(grouped.try),
		untriedLine(facts),
		countedLine('Unsure', grouped.unsure),
		countedLine('Avoid', grouped.avoid),
	];
	return lines.filter((line): line is string => line != null);
}

/**
 * Try wins when a thin sample is already a real home (1/1).
 * Avoid needs a long cold streak. Everything else with a trial is Unsure.
 */
function classifySlot(slot: SlotFact): VoiceBucket {
	if (slot.trials <= 0) return 'untried';
	const soft = laplaceRate(slot.homes, slot.trials);
	if (slot.homes >= 1 && soft >= TRY_SOFT_MIN) return 'try';
	if (slot.trials >= 3 && soft <= AVOID_SOFT_MAX) return 'avoid';
	return 'unsure';
}

function tryLine(slots: readonly SlotFact[]): string | null {
	if (slots.length === 0) return null;
	const ranked = [...slots].sort(compareTry);
	const best = laplaceRate(ranked[0]?.homes ?? 0, ranked[0]?.trials ?? 0);
	const bits = ranked.map((slot) => {
		const text = `${slotName(slot)} (${slot.homes}/${slot.trials})`;
		return Math.abs(laplaceRate(slot.homes, slot.trials) - best) < 1e-9 ? `**${text}**` : text;
	});
	return `Try: ${bits.join(' · ')}`;
}

function compareTry(a: SlotFact, b: SlotFact): number {
	const soft = laplaceRate(b.homes, b.trials) - laplaceRate(a.homes, a.trials);
	if (Math.abs(soft) > 1e-9) return soft;
	return b.trials - a.trials || a.weekday - b.weekday || daypartIndex(a.daypart) - daypartIndex(b.daypart);
}

function untriedLine(facts: readonly SlotFact[]): string | null {
	const weekdays = [...new Set(facts.filter((slot) => slot.trials === 0).map((slot) => slot.weekday))]
		.sort((a, b) => a - b);
	if (weekdays.length === 0) return null;
	const bits = weekdays.map((weekday) => {
		const may = facts.filter((slot) => slot.weekday === weekday).sort(byDaypart);
		const open = may.filter((slot) => slot.trials === 0);
		if (open.length === may.length) return weekdayShort(weekday);
		return condenseDayparts(weekday, open);
	});
	return `Untried: ${bits.join(' · ')}`;
}

function countedLine(label: 'Unsure' | 'Avoid', slots: readonly SlotFact[]): string | null {
	if (slots.length === 0) return null;
	const bits: string[] = [];
	for (const weekday of [...new Set(slots.map((slot) => slot.weekday))].sort((a, b) => a - b)) {
		const daySlots = slots.filter((slot) => slot.weekday === weekday).sort(byDaypart);
		let cluster: SlotFact[] = [];
		const flush = () => {
			if (cluster.length === 0) return;
			const names = cluster.map((slot) => daypartLabel(slot.daypart));
			const head = cluster[0];
			const daypartText = names.length === 1 ? names[0] ?? '' : names.join('/');
			bits.push(`${weekdayShort(weekday)} ${daypartText} (${head?.homes ?? 0}/${head?.trials ?? 0})`);
			cluster = [];
		};
		for (const slot of daySlots) {
			const prev = cluster[cluster.length - 1];
			if (prev && (prev.homes !== slot.homes || prev.trials !== slot.trials)) flush();
			cluster.push(slot);
		}
		flush();
	}
	return `${label}: ${bits.join(' · ')}`;
}

function condenseDayparts(weekday: number, slots: readonly SlotFact[]): string {
	const labels = [...slots].sort(byDaypart).map((slot) => daypartLabel(slot.daypart));
	if (labels.length <= 1) return `${weekdayShort(weekday)} ${labels[0] ?? ''}`.trim();
	return `${weekdayShort(weekday)} ${labels.join('/')}`;
}

function historyLines(entries: readonly AttemptEntry[]): string[] {
	return entries.map((entry) => `${entry.stamp} — ${entry.home ? 'Home' : 'Not home'}`);
}

function slotName(slot: Pick<SlotFact, 'weekday' | 'daypart'>): string {
	return `${weekdayShort(slot.weekday)} ${daypartLabel(slot.daypart)}`;
}

function byDaypart(a: SlotFact, b: SlotFact): number {
	return daypartIndex(a.daypart) - daypartIndex(b.daypart);
}

function daypartIndex(daypart: Daypart): number {
	return DAYPARTS.indexOf(daypart);
}

function isUntouchedWillingDefault(raw: Record<string, unknown>): boolean {
	let count = 0;
	for (let weekday = 0; weekday < 7; weekday += 1) {
		for (const daypart of LEGACY_DAYPARTS) {
			const value = raw[`${weekday}:${daypart}`];
			if (value === undefined) continue;
			count += 1;
			if (value !== 'willing') return false;
		}
	}
	return count === 7 * LEGACY_DAYPARTS.length;
}

function mergeMorning(raw: Record<string, unknown>, weekday: number): AvailabilityLevel {
	const keys = [`${weekday}:morning`, `${weekday}:early-morning`, `${weekday}:late-morning`];
	let may = false;
	for (const key of keys) {
		if (mapLevel(raw[key]) === 'may') may = true;
	}
	return may ? 'may' : 'off';
}

function mapLevel(value: unknown): AvailabilityLevel {
	if (value === 'may' || value === 'go-out' || value === 'willing') return 'may';
	return 'off';
}

const STAMP_BODY = /^(?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat),?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+[—–-]\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})$/i;
const BULLET_LINE = /^(?:>\s*)?[-*]\s+(?:\*\*)?(.+?)\s+[—–-]\s+(success|home|not[ -]?home|miss)(?:\*\*)?\s*$/i;
const HEADING_LINE = /^###\s+(.+?)\s*$/;

function parseBulletLine(line: string): AttemptEntry | null {
	const match = BULLET_LINE.exec(line.trim());
	if (!match) return null;
	const parsed = parseStamp(match[1] ?? '');
	if (!parsed) return null;
	return { ...parsed, home: isHomeOutcome(match[2] ?? '') };
}

function parseHeadingLine(line: string): AttemptEntry | null {
	const match = HEADING_LINE.exec(line.trim());
	if (!match) return null;
	const parsed = parseStamp(match[1] ?? '');
	if (!parsed) return null;
	return { ...parsed, home: true };
}

function parseStamp(raw: string): Omit<AttemptEntry, 'home'> | null {
	const text = raw.trim();
	const match = STAMP_BODY.exec(text);
	if (!match) return null;
	const hour12 = Number(match[2]);
	const minute = match[3] ? Number(match[3]) : 0;
	const ampm = (match[4] ?? '').toLowerCase();
	const dateText = match[5] ?? '';
	const clock = clock24(hour12, minute, ampm);
	const date = parseStampDate(dateText);
	if (!clock || !date) return null;
	const when = new Date(date.year, date.month, date.day, clock.hour, clock.minute, 0, 0);
	const weekday = when.getDay();
	const writtenDow = (match[1] ?? '').trim();
	const dow = writtenDow || weekdayShort(weekday);
	const clockLabel = minute > 0
		? `${hour12}:${String(minute).padStart(2, '0')}${ampm}`
		: `${hour12}${ampm}`;
	return {
		weekday,
		daypart: daypartAt(when),
		stamp: `${dow}, ${clockLabel} — ${dateText.trim()}`,
	};
}

function isHomeOutcome(word: string): boolean {
	const text = word.toLowerCase().replace(/[\s-]+/g, '');
	return text === 'success' || text === 'home';
}

function clock24(hour12: number, minute: number, ampm: string): { hour: number; minute: number } | null {
	if (!Number.isInteger(hour12) || hour12 < 1 || hour12 > 12) return null;
	if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
	let hour = hour12 % 12;
	if (ampm === 'pm') hour += 12;
	return { hour, minute };
}

function parseStampDate(text: string): { year: number; month: number; day: number } | null {
	const match = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(text.trim());
	if (!match) return null;
	const month = MONTH_INDEX[(match[1] ?? '').toLowerCase().slice(0, 3)];
	const day = Number(match[2]);
	const year = Number(match[3]);
	if (month == null || !Number.isInteger(day) || !Number.isInteger(year)) return null;
	const date = new Date(year, month, day);
	if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
	return { year, month, day };
}
