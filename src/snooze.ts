/** Local date-time. While it is still ahead, urgency displays as 0. */
export const URGENCY_SNOOZE_PROPERTY = 'Urgency Snooze';

export type SnoozeChoice = 'today' | '7' | '14';

/** Slate used for a snoozed card, badge, and map pin. Not the green urgency band. */
export const SNOOZE_SLATE = '#6b7a99';

/** Tiny card caption. A blank reason reads as "snoozed". A reason is the label alone. */
export function snoozeCardCaption(label: string): string {
	const text = label.trim();
	return text || 'snoozed';
}

export function snoozeDeadline(choice: SnoozeChoice, now: Date): Date {
	if (choice === 'today') {
		return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
	}
	const days = choice === '7' ? 7 : 14;
	return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export function formatSnoozeUntil(choice: SnoozeChoice, now: Date): string {
	const date = snoozeDeadline(choice, now);
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function parseSnoozeUntil(value: unknown): Date | null {
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
	if (typeof value !== 'string' || !value.trim()) return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value.trim());
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const day = Number(match[3]);
	const hour = match[4] == null ? 23 : Number(match[4]);
	const minute = match[5] == null ? 59 : Number(match[5]);
	const second = match[6] == null ? 59 : Number(match[6]);
	const date = new Date(year, month, day, hour, minute, second);
	if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
	return date;
}

export function snoozeActive(until: Date | null, now: Date): boolean {
	return until != null && until.getTime() > now.getTime();
}

/** When the snooze began. Stored beside the until-datetime. */
export const SNOOZE_START_PROPERTY = 'Snooze Start';
/** Free-text reason shown on the card. */
export const SNOOZE_LABEL_PROPERTY = 'Snooze Label';

export const SNOOZE_DAY_MIN = 1;
export const SNOOZE_DAY_MAX = 90;

export interface SnoozeWrite {
	until: string;
	start: string;
	label: string;
}

/** Whole days from now, clamped to 1–90, landing at the same clock time. */
export function snoozeUntilFromDays(days: number, now: Date): Date {
	const clamped = Math.max(SNOOZE_DAY_MIN, Math.min(SNOOZE_DAY_MAX, Math.round(days)));
	return new Date(now.getTime() + clamped * 24 * 60 * 60 * 1000);
}

export function formatSnoozeInstant(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatSnoozeStart(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Days still ahead. 0 once the until-datetime has passed. */
export function snoozeDaysLeft(until: Date, now: Date): number {
	const ms = until.getTime() - now.getTime();
	if (ms <= 0) return 0;
	return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/** Days a stored until-datetime represents, for reopening the modal. */
export function snoozeDaysFromUntil(until: Date, now: Date): number {
	return Math.max(SNOOZE_DAY_MIN, Math.min(SNOOZE_DAY_MAX, snoozeDaysLeft(until, now) || SNOOZE_DAY_MIN));
}

/** `Until Wed, Nov 11 · 30 days`. */
export function snoozePreview(days: number, now: Date): string {
	const clamped = Math.max(SNOOZE_DAY_MIN, Math.min(SNOOZE_DAY_MAX, Math.round(days)));
	const until = snoozeUntilFromDays(clamped, now);
	const when = until.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
	const unit = clamped === 1 ? 'day' : 'days';
	return `Until ${when} · ${clamped} ${unit}`;
}
