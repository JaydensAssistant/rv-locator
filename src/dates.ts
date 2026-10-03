const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const MONTH_INDEX: Record<string, number> = {
	jan: 1,
	feb: 2,
	mar: 3,
	apr: 4,
	may: 5,
	jun: 6,
	jul: 7,
	aug: 8,
	sep: 9,
	oct: 10,
	nov: 11,
	dec: 12,
};

export interface WeekdayParts {
	dow: string;
	rest: string;
	text: string;
}

/**
 * Bases sometimes titles `Last Spoke` as "Last Spc". The frontmatter key stays `Last Spoke`.
 */
export function normalizeDatePropertyName(name: string): string {
	const trimmed = name.trim();
	if (trimmed.toLowerCase() === 'last spc') return 'Last Spoke';
	return trimmed;
}

export function parseDatePropertyNames(raw: string): string[] {
	return uniqueDatePropertyNames(raw.split(/[,;\n]/));
}

export function uniqueDatePropertyNames(values: readonly unknown[]): string[] {
	const seen = new Set<string>();
	const names: string[] = [];
	for (const value of values) {
		if (typeof value !== 'string') continue;
		const name = normalizeDatePropertyName(value);
		if (!name) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		names.push(name);
	}
	return names;
}

export function isWeekdayProperty(propertyName: string, displayName: string, configured: readonly string[]): boolean {
	return configured.some((name) => namesMatch(name, propertyName) || namesMatch(name, displayName));
}

/**
 * Calendar date from note values. Time is ignored so a UTC offset cannot shift the day.
 * Accepts `2026-09-09`, `2026-09-09T13:38:03`, `2026-09-20T10:44`, `2026-09-18 16:45`, and `2026-03-28 11:20`.
 * `Met` uses the same shapes as `Last Spoke`. It is never a boolean.
 */
/** Calendar day from {@link parseFlexibleDate}, plus the clock when the text has one. */
export function parseDriveInstant(raw: string): Date | null {
	const date = parseFlexibleDate(raw);
	if (!date) return null;
	const clock = parseClock(raw);
	if (!clock) return date;
	return new Date(date.getFullYear(), date.getMonth(), date.getDate(), clock.hour, clock.minute, 0, 0);
}

export function parseFlexibleDate(input: string): Date | null {
	const text = input.trim();
	if (!text) return null;

	const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(text);
	if (iso) {
		return localDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
	}

	const pretty = /^(?:(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat),?\s+)?([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/.exec(text);
	if (!pretty) return null;
	const monthToken = pretty[1]?.toLowerCase().slice(0, 3) ?? '';
	const month = MONTH_INDEX[monthToken];
	if (!month) return null;
	return localDate(Number(pretty[3]), month, Number(pretty[2]));
}

const STAMP_AGE_SUFFIX = /\s*<span class="rv-stamp-ago">[^<]*<\/span>\s*$/i;
const VISIT_STAMP_DATE = /[—–-]\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\s*$/;

/** Drop a plugin-written age suffix so the visit stamp can be parsed again. */
export function stripStampAge(text: string): string {
	return text
		.replace(/\s*<span\b[^>]*\brv-visit-extra\b[^>]*>[\s\S]*?<\/span>/gi, ' ')
		.replace(STAMP_AGE_SUFFIX, '')
		.replace(/\s+/g, ' ')
		.trim();
}

const STAMP_AGE_WORDS = /\s+(?:Today|\d+ days? ago)\s*$/i;

/** Stamp heading text with the rendered age (`Today`, `3 days ago`) removed. */
export function visibleStampText(text: string): string {
	let next = text.replace(/\s+/g, ' ').trim();
	for (let pass = 0; pass < 3 && STAMP_AGE_WORDS.test(next); pass += 1) {
		next = next.replace(STAMP_AGE_WORDS, '').trim();
	}
	return next;
}

/**
 * Calendar days from a Glancable visit stamp (`Wed, 2pm — Sep 9, 2026`) to `today`.
 * The clock on the stamp is ignored. A stamp dated tomorrow (hour rounding) is 0.
 * Text that is not a visit stamp returns null.
 */
export function calendarDaysSinceStamp(stamp: string, today: Date = new Date()): number | null {
	const match = VISIT_STAMP_DATE.exec(stripStampAge(stamp));
	if (!match) return null;
	const date = parseFlexibleDate(match[1] ?? '');
	if (!date) return null;
	const days = calendarDaysSince(formatShortDate(date), today);
	if (days == null) return 0;
	return days;
}

/** `Today`, `1 day ago`, or `54 days ago`. */
export function formatDaysAgo(days: number): string {
	const whole = Math.max(0, Math.floor(days));
	if (whole === 0) return 'Today';
	if (whole === 1) return '1 day ago';
	return `${whole} days ago`;
}

/**
 * Glanceable day counter. Days through 20, weeks for 3–9 weeks,
 * months from 64 days through 365, then years.
 */
export function formatGlanceableCounter(days: number): string {
	const whole = Math.max(0, Math.floor(days));
	if (whole === 0) return 'Today';
	if (whole <= 20) return whole === 1 ? '1 day' : `${whole} days`;
	if (whole < 64) {
		const weeks = Math.min(9, Math.max(3, Math.round(whole / 7)));
		return weeks === 1 ? '1 week' : `${weeks} weeks`;
	}
	if (whole <= 365) {
		const months = Math.max(2, Math.round(whole / 30.44));
		return months === 1 ? '1 month' : `${months} months`;
	}
	const years = Math.max(1, Math.round(whole / 365.25));
	return years === 1 ? '1 year' : `${years} years`;
}

const STAMP_DATE_ANYWHERE = /[—–-]\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/;

/**
 * Age label for rendered stamp heading text, such as
 * `Wed, 2pm — Sep 9, 2026 20 days ago`. The stale age text after the date is
 * ignored. Text without a visit stamp returns null.
 */
export function stampAgeFromHeadingText(text: string, today: Date = new Date()): string | null {
	const match = STAMP_DATE_ANYWHERE.exec(text);
	if (!match) return null;
	const days = calendarDaysSinceStamp(`— ${match[1] ?? ''}`, today);
	if (days == null) return null;
	return formatDaysAgo(days);
}

/** Inline age next to a `###` visit stamp. Empty when `stamp` is not a visit stamp. */
export function stampAgeMarkup(stamp: string, today: Date = new Date()): string {
	const days = calendarDaysSinceStamp(stamp, today);
	if (days == null) return '';
	return `<span class="rv-stamp-ago">${formatDaysAgo(days)}</span>`;
}

export function formatShortDate(date: Date): string {
	const month = MONTHS[date.getMonth()] ?? '';
	return `${month} ${date.getDate()}, ${date.getFullYear()}`;
}

const BOOLEAN_WORD = /^(true|false|yes|no)$/i;
const MS_PER_DAY = 86_400_000;

/**
 * Whole calendar days from the written date to `today`, in local dates.
 * Time of day is ignored, including the display-only hour rounding.
 * Empty, boolean, unparseable, and future dates return null.
 */
export function calendarDaysSince(raw: string, today: Date = new Date()): number | null {
	const text = raw.trim();
	if (!text || BOOLEAN_WORD.test(text)) return null;
	const date = parseFlexibleDate(text);
	if (!date) return null;
	const then = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
	const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
	const days = Math.round((now - then) / MS_PER_DAY);
	if (!Number.isFinite(days) || days < 0) return null;
	return days;
}

export interface DateCellDisplay {
	text: string;
	title: string;
	empty: boolean;
	dow?: string;
	rest?: string;
}

const EMPTY_DATE: DateCellDisplay = { text: '—', title: 'No date', empty: true };

/**
 * Last Spoke and Met display. Empty values and boolean words are an em dash,
 * never a checkbox. Glancable passes weekday true; the table passes false.
 */
export function dateCellDisplay(raw: string, weekday: boolean): DateCellDisplay {
	const text = raw.trim();
	if (!text || BOOLEAN_WORD.test(text)) return EMPTY_DATE;
	const date = parseFlexibleDate(text);
	if (!date) return { text, title: text, empty: false };
	if (weekday) {
		const parts = formatWeekdayParts(date);
		return { text: parts.text, title: parts.text, empty: false, dow: parts.dow, rest: parts.rest };
	}
	const short = formatShortDate(date);
	return { text: short, title: short, empty: false };
}

/**
 * Formatted Last Spoke / Met text.
 * Empty and boolean words return null; the view shows an em dash for those.
 */
export function dateCellText(raw: string, display: 'weekday' | 'short'): string | null {
	const cell = dateCellDisplay(raw, display === 'weekday');
	return cell.empty ? null : cell.text;
}

export function isBooleanWord(raw: string): boolean {
	return BOOLEAN_WORD.test(raw.trim());
}

/** Last Spoke, Last Attempted, and Met. Not Met With. */
export function showsElapsedDays(name: string, displayName: string): boolean {
	const left = name.trim().toLowerCase();
	const right = displayName.trim().toLowerCase();
	return left === 'last spoke' || left === 'last spc' || right === 'last spc'
		|| left === 'last attempted' || right === 'last attempted'
		|| left === 'met' || right === 'met';
}

export function formatWeekdayDate(date: Date): string {
	const parts = formatWeekdayParts(date);
	return parts.text;
}

export function formatWeekdayParts(date: Date): WeekdayParts {
	const dow = WEEKDAYS[date.getDay()] ?? '';
	const rest = `, ${formatShortDate(date)}`;
	return { dow, rest, text: `${dow}${rest}` };
}

export interface DriveDateDisplay {
	text: string;
	/** Original precise value, for a tooltip. */
	title: string;
	empty: boolean;
	/** Weekday abbreviation. Bold, beside the hour. */
	dow?: string;
	/** `Sep 9, 2026` — smaller, not bold. */
	rest?: string;
	/** Rounded hour, such as `2pm`. Bold with the weekday. Omitted for a date-only value. */
	time?: string;
}

/**
 * Display-only Spoke / Last Attempted / Met.
 * Time is rounded to the nearest hour. A date-only value omits the time.
 * The stored property is not changed.
 * Bold piece: `Wed, 2pm`. Smaller calendar piece: `Sep 9, 2026`.
 */
export function formatDriveDate(raw: string): DriveDateDisplay {
	const text = raw.trim();
	if (!text || BOOLEAN_WORD.test(text)) return { text: '—', title: 'No date', empty: true };
	const date = parseFlexibleDate(text);
	if (!date) return { text, title: text, empty: false };
	const clock = parseClock(text);
	let year = date.getFullYear();
	let month = date.getMonth();
	let day = date.getDate();
	let time: string | undefined;
	if (clock) {
		let hour = clock.hour;
		if (clock.minute >= 30) hour += 1;
		if (hour >= 24) {
			const next = new Date(year, month, day + 1);
			year = next.getFullYear();
			month = next.getMonth();
			day = next.getDate();
			hour = 0;
		}
		time = formatHourLabel(hour);
	}
	const shown = new Date(year, month, day);
	const dow = WEEKDAYS[shown.getDay()] ?? '';
	const monthName = MONTHS[month] ?? '';
	const rest = `${monthName} ${day}, ${year}`;
	const composed = time ? `${dow}, ${time}` : dow;
	return {
		text: composed,
		title: text,
		empty: false,
		dow,
		rest,
		time,
	};
}

/**
 * Note heading and Attempt Log stamp.
 * Uses the same rounding as `formatDriveDate`: `Wed, 2pm — Sep 9, 2026`.
 * A date-only value omits the hour: `Wed — Sep 9, 2026`.
 */
export function formatGlancableStampFromRaw(raw: string): string {
	const display = formatDriveDate(raw);
	if (display.empty || !display.rest) return display.text;
	return `${display.text} — ${display.rest}`;
}

/** Local clock on `date`, rendered with `formatGlancableStampFromRaw`. */
export function formatGlancableVisitStamp(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	const iso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
	return formatGlancableStampFromRaw(iso);
}

/**
 * Attempt Log and visit headings. The clock is exact (`4:32pm`).
 * An hour with no minutes stays `4pm`, the same shape as the rounded stamp.
 */
export function formatExactVisitStamp(date: Date): string {
	const dow = WEEKDAYS[date.getDay()] ?? '';
	const rest = `${MONTHS[date.getMonth()] ?? ''} ${date.getDate()}, ${date.getFullYear()}`;
	return `${dow}, ${formatExactClock(date.getHours(), date.getMinutes())} — ${rest}`;
}

/** `Tue, 4:32pm — Sep 15, 2026 — success` → the calendar date is the only small piece. */
export function attemptLogDateParts(text: string): { lead: string; date: string; tail: string } | null {
	const match = /^(.*?\s—\s)((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4})(.*)$/i.exec(text);
	if (!match) return null;
	return { lead: match[1] ?? '', date: match[2] ?? '', tail: match[3] ?? '' };
}

function formatExactClock(hour: number, minute: number): string {
	const suffix = hour >= 12 ? 'pm' : 'am';
	const onClock = hour % 12 === 0 ? 12 : hour % 12;
	if (minute <= 0) return `${onClock}${suffix}`;
	return `${onClock}:${String(minute).padStart(2, '0')}${suffix}`;
}

function parseClock(text: string): { hour: number; minute: number } | null {
	const match = /(?:T|\s)(\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i.exec(text.trim());
	if (!match) return null;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
	return { hour, minute };
}

function formatHourLabel(hour: number): string {
	const suffix = hour >= 12 ? 'pm' : 'am';
	const onClock = hour % 12 === 0 ? 12 : hour % 12;
	return `${onClock}${suffix}`;
}

function namesMatch(configured: string, candidate: string): boolean {
	const left = normalizeDatePropertyName(configured).toLowerCase();
	const right = normalizeDatePropertyName(candidate).toLowerCase();
	return left.length > 0 && left === right;
}

function localDate(year: number, month: number, day: number): Date | null {
	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const date = new Date(year, month - 1, day);
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
	return date;
}
