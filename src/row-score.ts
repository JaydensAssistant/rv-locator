import { IDEALITY_COLUMN_ID, URGENCY_COLUMN_ID } from './constants';
import { idealityScore, likelihoodMultiplier, urgencyScore } from './scoring';
import { snoozeActive } from './snooze';
import { availabilityKey, daypartAt, type AttemptBuckets } from './schedule';
import type { RowModel } from './model';
import type { Sortable } from './sort';
import type { RVLocatorSettings } from './types';

export function rowSpokeDays(row: RowModel): number | null {
	const cell = cellByNoteName(row, 'Last Spoke');
	if (!cell || typeof cell.daysSince !== 'number' || !Number.isFinite(cell.daysSince)) return null;
	return cell.daysSince;
}

export function rowUrgency(
	row: RowModel,
	settings: RVLocatorSettings,
	now: Date = new Date(),
	snoozeUntil: Date | null = null,
): number | null {
	return displayedUrgency(rowSpokeDays(row), rowPriority(row), settings, snoozeUntil, now);
}

/** Priority 0 has no urgency. An active snooze holds every other priority at 0. */
export function displayedUrgency(
	days: number | null,
	priority: number | null,
	settings: Pick<RVLocatorSettings, 'urgencyThresholdDays'>,
	snoozeUntil: Date | null,
	now: Date,
): number | null {
	if (priority == null || priority <= 0) return null;
	if (snoozeActive(snoozeUntil, now)) return 0;
	return urgencyScore(days, priority, settings.urgencyThresholdDays);
}

export function rowPriority(row: RowModel): number | null {
	const cell = cellByNoteName(row, 'Priority');
	if (!cell || cell.kind === 'empty' || !cell.text) return null;
	const parsed = Number(cell.text);
	if (!Number.isFinite(parsed)) return null;
	const rank = Math.round(parsed);
	if (rank < 0 || rank > 5) return null;
	return rank;
}

/** Current weekday × daypart only. A missing log leaves the multiplier at 1. */
export function likelihoodForNow(buckets: AttemptBuckets | null, now: Date): number {
	if (!buckets) return 1;
	const key = availabilityKey(now.getDay(), daypartAt(now));
	const count = buckets[key] ?? { homes: 0, trials: 0 };
	return likelihoodMultiplier(count.homes, count.trials);
}

export function annotateRowScores(
	row: RowModel,
	miles: number | null,
	settings: RVLocatorSettings,
	buckets: AttemptBuckets | null,
	now: Date,
	snoozeUntil: Date | null = null,
): RowModel {
	const days = rowSpokeDays(row);
	const priority = rowPriority(row);
	const urgency = displayedUrgency(days, priority, settings, snoozeUntil, now);
	const base = idealityScore({
		days,
		priority,
		miles,
		thresholds: settings.urgencyThresholdDays,
		floors: settings.idealityFloorDays,
		territorySpan: settings.territorySpanMiles,
	});
	const factor = settings.homeLikelihoodEnabled ? likelihoodForNow(buckets, now) : 1;
	const ideality = base == null ? null : base * factor;
	return {
		...row,
		sortKeys: {
			...row.sortKeys,
			[URGENCY_COLUMN_ID]: numberKey(urgency),
			[IDEALITY_COLUMN_ID]: numberKey(ideality),
		},
	};
}

function numberKey(value: number | null): Sortable {
	if (value == null || !Number.isFinite(value)) return { kind: 'empty' };
	return { kind: 'number', value };
}

function cellByNoteName(row: RowModel, name: string): RowModel['cells'][number] | undefined {
	const wanted = `note.${name.toLowerCase()}`;
	return row.cells.find((cell) => cell.id.toLowerCase() === wanted);
}
