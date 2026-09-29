/** Local date-time. While it is still ahead, urgency displays as 0. */
export const URGENCY_SNOOZE_PROPERTY = 'Urgency Snooze';

export type SnoozeChoice = 'today' | '7' | '14';

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
