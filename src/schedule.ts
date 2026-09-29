/**
 * Weekday × daypart buckets for Attempt Log history.
 * Wednesday morning never shares a bucket with Saturday morning.
 * Boundaries are local time. Evening starts at 4:30.
 */

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

const DAYPART_END: Record<Daypart, number> = {
	morning: 12 * 60,
	afternoon: 16 * 60 + 30,
	evening: 24 * 60,
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

/**
 * Attempt Log lines only. `###` stamps are the same home visit and are not counted twice.
 * The written hour is the rounded local hour. 4:30 in the raw clock is evening; a rounded `4pm` stamp is afternoon.
 */
export function parseAttemptLog(body: string): AttemptBuckets {
	const buckets: AttemptBuckets = {};
	for (const line of body.split('\n')) {
		const visit = parseAttemptLine(line);
		if (!visit) continue;
		const key = availabilityKey(visit.weekday, visit.daypart);
		const current = buckets[key] ?? { homes: 0, trials: 0 };
		buckets[key] = {
			homes: current.homes + (visit.home ? 1 : 0),
			trials: current.trials + 1,
		};
	}
	return buckets;
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
	/** Footer lines, or the empty-schedule line. */
	text: string;
	sentences: string[];
	table: string;
	/** Table plus accented footers, ready to store under Attempt Log. */
	markdown: string;
}

const NO_SCHEDULE = 'No May-go-out days';

/**
 * Compact table of May-go-out days, then two footer lines.
 * Avoid and try name dayparts, never a whole weekday by itself.
 */
export function suggestReturnDigest(args: {
	buckets: AttemptBuckets;
	grid: AvailabilityGrid;
	orientation?: DigestOrientation;
	now?: Date;
}): ReturnDigest {
	const now = args.now ?? new Date();
	const orientation = args.orientation === 'columns' ? 'columns' : 'rows';
	const days = mayGoOutDays(args.grid);
	if (days.length === 0) {
		return { text: NO_SCHEDULE, sentences: [NO_SCHEDULE], table: '', markdown: NO_SCHEDULE };
	}
	const facts = daypartFacts(days, args.buckets, args.grid);
	const table = orientation === 'columns'
		? tableDaysAsColumns(days, facts)
		: tableDaysAsRows(days, facts);
	const avoid = facts.filter((slot) => isAvoid(slot))
		.sort((a, b) => a.rate - b.rate || b.trials - a.trials || compareUpcoming(a, b, now))
		.slice(0, 3);
	const avoidKeys = new Set(avoid.map(slotKey));
	const promising = facts
		.filter((slot) => slot.trials > 0 && !avoidKeys.has(slotKey(slot)))
		.sort((a, b) => b.rate - a.rate || b.trials - a.trials || compareUpcoming(a, b, now))[0] ?? null;
	const untried = facts
		.filter((slot) => slot.trials === 0)
		.sort((a, b) => compareUpcoming(a, b, now))
		.slice(0, 2);
	const sentences = [avoidLine(avoid), tryLine(promising, untried)];
	const markdown = [table, '', ...sentences].join('\n');
	return { text: sentences.join('\n'), sentences, table, markdown };
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

function isAvoid(slot: SlotFact): boolean {
	if (slot.trials < 3) return false;
	return slot.rate < 0.4;
}

function avoidLine(slots: readonly SlotFact[]): string {
	if (slots.length === 0) return '**Avoid** Nothing stands out';
	return `**Avoid** ${joinDayparts(slots)}`;
}

function tryLine(promising: SlotFact | null, untried: readonly SlotFact[]): string {
	const parts: string[] = [];
	if (promising) parts.push(daypartCount(promising));
	if (untried.length === 1) {
		const slot = untried[0];
		if (slot) parts.push(`${daypartName(slot)} has not been tried`);
	} else if (untried.length > 1) {
		const names = untried.map((slot) => daypartName(slot));
		parts.push(`${names[0]} and ${names[1]} have not been tried`);
	}
	if (parts.length === 0) return '**Try** No daypart stands out yet';
	return `**Try** ${parts.join('; ')}`;
}

function joinDayparts(slots: readonly SlotFact[]): string {
	const bits = slots.map((slot) => daypartCount(slot));
	if (bits.length <= 1) return bits[0] ?? '';
	if (bits.length === 2) return `${bits[0]} and ${bits[1]}`;
	return `${bits.slice(0, -1).join(', ')}, and ${bits[bits.length - 1]}`;
}

function daypartCount(slot: SlotFact): string {
	return `${daypartName(slot)} (${slot.homes}/${slot.trials})`;
}

function daypartName(slot: Pick<SlotFact, 'weekday' | 'daypart'>): string {
	return `${weekdayShort(slot.weekday)} ${daypartLabel(slot.daypart)}`;
}

function compareUpcoming(a: SlotFact, b: SlotFact, now: Date): number {
	return minutesUntil(now, a.weekday, a.daypart) - minutesUntil(now, b.weekday, b.daypart);
}

function minutesUntil(now: Date, weekday: number, daypart: Daypart): number {
	const start = DAYPART_START[daypart];
	const end = DAYPART_END[daypart];
	const nowMin = now.getHours() * 60 + now.getMinutes();
	let dayDelta = (weekday - now.getDay() + 7) % 7;
	if (dayDelta === 0 && nowMin >= end) dayDelta = 7;
	return dayDelta * 1440 + start - nowMin;
}

function slotKey(slot: SlotFact): string {
	return availabilityKey(slot.weekday, slot.daypart);
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

const LOG_LINE = /^>\s*-\s*(?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat),?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+[—–-]\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\s+[—–-]\s+(success|not home)\s*$/i;

function parseAttemptLine(line: string): { weekday: number; daypart: Daypart; home: boolean } | null {
	const match = LOG_LINE.exec(line.trim());
	if (!match) return null;
	const hour12 = Number(match[2]);
	const minute = match[3] ? Number(match[3]) : 0;
	const ampm = (match[4] ?? '').toLowerCase();
	const dateText = match[5] ?? '';
	const outcome = (match[6] ?? '').toLowerCase();
	const clock = clock24(hour12, minute, ampm);
	const date = parseStampDate(dateText);
	if (!clock || !date) return null;
	const when = new Date(date.year, date.month, date.day, clock.hour, clock.minute, 0, 0);
	return {
		weekday: when.getDay(),
		daypart: daypartAt(when),
		home: outcome === 'success',
	};
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
