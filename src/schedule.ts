/**
 * Weekday × daypart buckets for Attempt Log history.
 * Wednesday late morning never shares a bucket with Saturday late morning.
 * Boundaries are local time. Evening starts at 4:30.
 */

export const DAYPARTS = ['early-morning', 'late-morning', 'afternoon', 'evening'] as const;

export type Daypart = (typeof DAYPARTS)[number];

export type AvailabilityLevel = 'off' | 'willing' | 'go-out';

export interface AvailabilityMultipliers {
	goOut: number;
	willing: number;
}

export interface BucketCount {
	homes: number;
	trials: number;
}

export type AttemptBuckets = Record<string, BucketCount>;

export type AvailabilityGrid = Record<string, AvailabilityLevel>;

export const DEFAULT_GO_OUT_MULTIPLIER = 1;
export const DEFAULT_WILLING_MULTIPLIER = 0.65;

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Minutes from midnight, inclusive start. */
const DAYPART_START: Record<Daypart, number> = {
	'early-morning': 0,
	'late-morning': 9 * 60 + 30,
	afternoon: 12 * 60,
	evening: 16 * 60 + 30,
};

const DAYPART_END: Record<Daypart, number> = {
	'early-morning': 9 * 60 + 30,
	'late-morning': 12 * 60,
	afternoon: 16 * 60 + 30,
	evening: 24 * 60,
};

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

export function defaultAvailabilityGrid(): AvailabilityGrid {
	const grid: AvailabilityGrid = {};
	for (let weekday = 0; weekday < 7; weekday += 1) {
		for (const daypart of DAYPARTS) {
			grid[availabilityKey(weekday, daypart)] = 'willing';
		}
	}
	return grid;
}

export function daypartAt(date: Date): Daypart {
	const minutes = date.getHours() * 60 + date.getMinutes();
	if (minutes < DAYPART_START['late-morning']) return 'early-morning';
	if (minutes < DAYPART_START.afternoon) return 'late-morning';
	if (minutes < DAYPART_START.evening) return 'afternoon';
	return 'evening';
}

export function daypartLabel(daypart: Daypart): string {
	switch (daypart) {
		case 'early-morning': return 'early morning';
		case 'late-morning': return 'late morning';
		case 'afternoon': return 'afternoon';
		case 'evening': return 'evening';
	}
}

export function weekdayName(weekday: number): string {
	return WEEKDAY_NAMES[weekday] ?? 'that day';
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

export function slotScore(
	homes: number,
	trials: number,
	availability: AvailabilityLevel,
	multipliers: AvailabilityMultipliers,
): number {
	if (!slotOpen(availability, multipliers)) return 0;
	const n = Math.max(0, trials);
	const h = Math.min(Math.max(0, homes), n);
	const mult = availability === 'go-out' ? multipliers.goOut : multipliers.willing;
	return laplaceRate(h, n) * sampleConfidence(n) * mult;
}

export function slotOpen(availability: AvailabilityLevel, multipliers: AvailabilityMultipliers): boolean {
	if (availability === 'off') return false;
	const mult = availability === 'go-out' ? multipliers.goOut : multipliers.willing;
	return Number.isFinite(mult) && mult > 0;
}

export function availabilityAt(grid: AvailabilityGrid, weekday: number, daypart: Daypart): AvailabilityLevel {
	const level = grid[availabilityKey(weekday, daypart)];
	if (level === 'off' || level === 'willing' || level === 'go-out') return level;
	return 'willing';
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
	text: string;
	sentences: string[];
}

const NOT_ENOUGH = 'No visits yet';

/**
 * Deterministic avoid-list. The strongest score is mentioned, and the copy leans on times to skip plus untried go-out slots.
 * Lines are short fragments: weekday crumb, daypart, and a count. Selection is unchanged.
 */
export function suggestReturnDigest(args: {
	buckets: AttemptBuckets;
	grid: AvailabilityGrid;
	multipliers: AvailabilityMultipliers;
	now?: Date;
}): ReturnDigest {
	if (totalTrials(args.buckets) <= 0) {
		return { text: NOT_ENOUGH, sentences: [NOT_ENOUGH] };
	}
	const now = args.now ?? new Date();
	const facts = openSlotFacts(args.buckets, args.grid, args.multipliers);
	const avoid = facts.filter((slot) => isAvoid(slot));
	const avoidKeys = new Set(avoid.map(slotKey));
	const logged = facts.filter((slot) => slot.trials > 0);
	const best = pickBest(logged, now);
	const untried = facts
		.filter((slot) => slot.trials === 0)
		.sort((a, b) => compareUntried(a, b, now));
	const alternates = logged
		.filter((slot) => best != null && slotKey(slot) !== slotKey(best) && !avoidKeys.has(slotKey(slot)))
		.sort((a, b) => b.score - a.score || compareUpcoming(a, b, now))
		.slice(0, 2);

	const sentences = [
		...avoidLines(avoid),
		...untriedLines(untried),
		best ? bestLine(best, avoidKeys.has(slotKey(best))) : 'No scored time',
		...alternateLines(alternates),
	];
	return { text: sentences.join('\n'), sentences };
}

export interface UpcomingSlot {
	weekday: number;
	daypart: Daypart;
	availability: AvailabilityLevel;
	when: Date;
}

/** Go-out and willing dayparts from now through the next `horizonDays`, skipping dayparts already over today. */
export function upcomingSlots(grid: AvailabilityGrid, now: Date, multipliers: AvailabilityMultipliers, horizonDays = 7): UpcomingSlot[] {
	const slots: UpcomingSlot[] = [];
	const todayMin = now.getHours() * 60 + now.getMinutes();
	for (let offset = 0; offset < horizonDays; offset += 1) {
		const when = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12, 0, 0, 0);
		const weekday = when.getDay();
		for (const daypart of DAYPARTS) {
			if (offset === 0 && todayMin >= DAYPART_END[daypart]) continue;
			const availability = availabilityAt(grid, weekday, daypart);
			if (!slotOpen(availability, multipliers)) continue;
			slots.push({ weekday, daypart, availability, when });
		}
	}
	return slots;
}

function openSlotFacts(
	buckets: AttemptBuckets,
	grid: AvailabilityGrid,
	multipliers: AvailabilityMultipliers,
): SlotFact[] {
	const facts: SlotFact[] = [];
	for (let weekday = 0; weekday < 7; weekday += 1) {
		for (const daypart of DAYPARTS) {
			const availability = availabilityAt(grid, weekday, daypart);
			if (!slotOpen(availability, multipliers)) continue;
			const count = buckets[availabilityKey(weekday, daypart)] ?? { homes: 0, trials: 0 };
			const homes = Math.min(Math.max(0, count.homes), count.trials);
			const trials = Math.max(0, count.trials);
			facts.push({
				weekday,
				daypart,
				availability,
				homes,
				trials,
				rate: laplaceRate(homes, trials),
				confidence: sampleConfidence(trials),
				score: slotScore(homes, trials, availability, multipliers),
			});
		}
	}
	return facts;
}

function isAvoid(slot: SlotFact): boolean {
	if (slot.trials < 3) return false;
	if (slot.rate >= 0.4) return false;
	return true;
}

function avoidTone(slot: SlotFact): 'never' | 'rarely' {
	if (slot.trials > 0 && slot.homes / slot.trials <= 0.25) return 'never';
	return 'rarely';
}

function avoidLines(slots: SlotFact[]): string[] {
	if (slots.length === 0) return ['None to avoid'];
	const groups: Array<{ weekday: number; dayparts: Daypart[]; homes: number; trials: number; tone: 'never' | 'rarely' }> = [];
	for (const slot of slots) {
		const tone = avoidTone(slot);
		const last = groups[groups.length - 1];
		if (
			last
			&& last.weekday === slot.weekday
			&& last.homes === slot.homes
			&& last.trials === slot.trials
			&& last.tone === tone
		) {
			last.dayparts.push(slot.daypart);
			continue;
		}
		groups.push({
			weekday: slot.weekday,
			dayparts: [slot.daypart],
			homes: slot.homes,
			trials: slot.trials,
			tone,
		});
	}
	return groups.map((group) => `Avoid · ${formatWeekdayDayparts(group.weekday, group.dayparts)} · ${group.homes}/${group.trials}`);
}

function untriedLines(slots: SlotFact[]): string[] {
	return slots.slice(0, 3).map((slot) => `Untried · ${slotCrumb(slot)}`);
}

function bestLine(slot: SlotFact, avoided: boolean): string {
	const flag = avoided ? ' · avoid' : '';
	return `Strongest · ${slotCrumb(slot)} · ${slot.homes}/${slot.trials} · ${slot.score.toFixed(2)}${flag}`;
}

function alternateLines(slots: SlotFact[]): string[] {
	return slots.map((slot) => `Also · ${slotCrumb(slot)} · ${slot.homes}/${slot.trials}`);
}

function slotCrumb(slot: SlotFact): string {
	return `${weekdayShort(slot.weekday)} ${daypartLabel(slot.daypart)}`;
}

function formatWeekdayDayparts(weekday: number, dayparts: Daypart[]): string {
	const labels = dayparts.map((daypart) => daypartLabel(daypart));
	const day = weekdayShort(weekday);
	const first = labels[0] ?? '';
	if (labels.length <= 1) return `${day} ${first}`.trim();
	return `${day} ${labels.join(', ')}`;
}

function pickBest(slots: SlotFact[], now: Date): SlotFact | null {
	let best: SlotFact | null = null;
	for (const slot of slots) {
		if (!best || slot.score > best.score || (slot.score === best.score && compareUpcoming(slot, best, now) < 0)) {
			best = slot;
		}
	}
	return best;
}

function compareUntried(a: SlotFact, b: SlotFact, now: Date): number {
	const rank = (slot: SlotFact) => (slot.availability === 'go-out' ? 0 : 1);
	const byKind = rank(a) - rank(b);
	if (byKind !== 0) return byKind;
	return compareUpcoming(a, b, now);
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
