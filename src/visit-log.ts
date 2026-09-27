import { assignProperty, readProperty, removeProperty } from './frontmatter';

export type VisitOutcome = 'home' | 'miss';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const ATTEMPT_LOG = /^## Attempt Log\s*$/;
const ADDRESS_KEY = 'Address';

/** Local date-time stored on Last Spoke / Last Attempted. No UTC shift. */
export function formatFrontmatterDateTime(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Weekday, calendar date, and clock time with minutes. */
export function formatVisitStamp(date: Date): string {
	const dow = WEEKDAYS[date.getDay()] ?? '';
	const month = MONTHS[date.getMonth()] ?? '';
	const hour24 = date.getHours();
	const suffix = hour24 >= 12 ? 'pm' : 'am';
	const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
	const minute = String(date.getMinutes()).padStart(2, '0');
	return `${dow}, ${month} ${date.getDate()}, ${date.getFullYear()}, ${hour}:${minute}${suffix}`;
}

/**
 * Frontmatter for one logged visit. Address is never assigned.
 * Home bumps Visits and Successful Visits and sets Last Spoke and Last Attempted.
 * A miss bumps Visits and sets Last Attempted only.
 */
export function applyVisitFrontmatter(
	frontmatter: Record<string, unknown>,
	outcome: VisitOutcome,
	now: Date,
): void {
	const address = readProperty(frontmatter, ADDRESS_KEY);
	const hadAddress = Object.keys(frontmatter).some((key) => key.toLowerCase() === ADDRESS_KEY.toLowerCase());
	bumpCount(frontmatter, 'Visits');
	const stamp = formatFrontmatterDateTime(now);
	assignProperty(frontmatter, 'Last Attempted', stamp);
	if (outcome === 'home') {
		bumpCount(frontmatter, 'Successful Visits');
		assignProperty(frontmatter, 'Last Spoke', stamp);
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
 * A home visit inserts `## <stamp>` and a blank line just above Attempt Log.
 * Both outcomes append a bullet under `## Attempt Log`, creating that heading at the end when it is missing.
 */
export function applyVisitBody(body: string, outcome: VisitOutcome, now: Date): string {
	const stamp = formatVisitStamp(now);
	const phrase = outcome === 'home' ? 'success' : 'not home';
	let next = ensureAttemptLog(body);
	if (outcome === 'home') next = insertHomeHeading(next, stamp);
	return appendLogLine(next, `- ${stamp} — ${phrase}`);
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

function ensureAttemptLog(body: string): string {
	const lines = body.split('\n');
	if (lines.some((line) => ATTEMPT_LOG.test(line))) return body.replace(/\s*$/, '');
	const trimmed = body.replace(/\s*$/, '');
	const gap = trimmed.length > 0 ? '\n\n' : '';
	return `${trimmed}${gap}## Attempt Log`;
}

function insertHomeHeading(body: string, stamp: string): string {
	const lines = body.split('\n');
	const index = lines.findIndex((line) => ATTEMPT_LOG.test(line));
	if (index < 0) return body;
	const before = lines.slice(0, index);
	while (before.length > 0 && before[before.length - 1] === '') before.pop();
	const after = lines.slice(index);
	const block = before.length > 0
		? ['', `## ${stamp}`, '', ...after]
		: [`## ${stamp}`, '', ...after];
	return [...before, ...block].join('\n');
}

function appendLogLine(body: string, line: string): string {
	const lines = body.split('\n');
	const start = lines.findIndex((entry) => ATTEMPT_LOG.test(entry));
	if (start < 0) return body;
	let end = lines.length;
	for (let index = start + 1; index < lines.length; index += 1) {
		if (/^#{1,2}\s+/.test(lines[index] ?? '')) {
			end = index;
			break;
		}
	}
	const section = lines.slice(start, end);
	while (section.length > 0 && section[section.length - 1] === '') section.pop();
	section.push(line);
	const rest = lines.slice(end);
	const gap = rest.length > 0 && rest[0] !== '' ? [''] : [];
	return [...lines.slice(0, start), ...section, ...gap, ...rest].join('\n').replace(/\s*$/, '') + '\n';
}
