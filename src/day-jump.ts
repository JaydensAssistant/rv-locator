export interface DayJumpCandidate {
	when: Date;
	home: boolean;
	kind: 'notes' | 'attempt';
}

/** The visit on that day. Home lands on visit notes. A miss lands on the attempt-log line. */
export function pickDayJump<T extends DayJumpCandidate>(when: Date, items: readonly T[]): T | null {
	const day = items.filter((item) => sameLocalDay(item.when, when));
	if (day.length === 0) return null;
	day.sort((a, b) => {
		const diff = Math.abs(a.when.getTime() - when.getTime()) - Math.abs(b.when.getTime() - when.getTime());
		if (diff !== 0) return diff;
		if (a.kind === 'notes' && b.kind !== 'notes') return -1;
		if (b.kind === 'notes' && a.kind !== 'notes') return 1;
		return 0;
	});
	const best = day[0];
	if (!best) return null;
	const near = (item: T) => Math.abs(item.when.getTime() - best.when.getTime()) <= 60 * 60 * 1000;
	if (best.home) return day.find((item) => item.kind === 'notes' && item.home && near(item)) ?? best;
	return day.find((item) => item.kind === 'attempt' && !item.home && near(item)) ?? best;
}

function sameLocalDay(left: Date, right: Date): boolean {
	return left.getFullYear() === right.getFullYear()
		&& left.getMonth() === right.getMonth()
		&& left.getDate() === right.getDate();
}
