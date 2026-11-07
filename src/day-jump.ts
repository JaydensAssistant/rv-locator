export interface DayJumpCandidate {
	when: Date;
	home: boolean;
	kind: 'notes' | 'attempt';
}

/** The visit on that day. A home lands on visit notes. A miss lands on the attempt-log line. */
export function pickDayJump<T extends DayJumpCandidate>(when: Date, items: readonly T[]): T | null {
	const day = items.filter((item) => sameLocalDay(item.when, when));
	if (day.length === 0) return null;
	const closest = nearest(day, when);
	if (!closest) return null;
	if (closest.home) return nearest(day.filter((item) => item.kind === 'notes' && item.home), when) ?? closest;
	return nearest(day.filter((item) => item.kind === 'attempt' && !item.home), when) ?? closest;
}

function nearest<T extends DayJumpCandidate>(items: readonly T[], when: Date): T | null {
	if (items.length === 0) return null;
	return [...items].sort((a, b) => {
		const diff = Math.abs(a.when.getTime() - when.getTime()) - Math.abs(b.when.getTime() - when.getTime());
		if (diff !== 0) return diff;
		if (a.kind === 'notes' && b.kind !== 'notes') return -1;
		if (b.kind === 'notes' && a.kind !== 'notes') return 1;
		return 0;
	})[0] ?? null;
}

function sameLocalDay(left: Date, right: Date): boolean {
	return left.getFullYear() === right.getFullYear()
		&& left.getMonth() === right.getMonth()
		&& left.getDate() === right.getDate();
}
