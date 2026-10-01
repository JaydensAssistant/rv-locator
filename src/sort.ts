import type { LatLon } from './types';
import { haversineMeters } from './distance';

export type SortDirection = 'ASC' | 'DESC';

export interface ActiveSort {
	property: string;
	direction: SortDirection;
}

export type Sortable =
	| { kind: 'empty' }
	| { kind: 'number'; value: number }
	| { kind: 'date'; value: number }
	| { kind: 'text'; value: string };

export interface DistanceSortable {
	lat: number | null;
	lon: number | null;
	sortKeys: Record<string, Sortable>;
}

/** Header click: ascending, descending, then back to the Base's own order. */
export function cycleSort(current: ActiveSort | null, property: string): ActiveSort | null {
	if (!current || current.property !== property) {
		return { property, direction: 'ASC' };
	}
	if (current.direction === 'ASC') {
		return { property, direction: 'DESC' };
	}
	return null;
}

export function sortRows<T extends DistanceSortable>(
	rows: readonly T[],
	sort: ActiveSort | null,
	fix: LatLon | null,
	distanceProperty: string,
): T[] {
	if (!sort) return [...rows];
	return sortRowsBy(rows, [sort], fix, distanceProperty);
}

/** Stable multi-key sort. An empty list keeps the current order (the Base's presort). */
export function sortRowsBy<T extends DistanceSortable>(
	rows: readonly T[],
	sorts: readonly ActiveSort[],
	fix: LatLon | null,
	distanceProperty: string,
): T[] {
	if (sorts.length === 0) return [...rows];
	const copy = [...rows];
	const cityNear = cityNearness(copy, fix);
	copy.sort((a, b) => {
		for (const sort of sorts) {
			const diff = sort.property === 'note.City'
				? compareCity(a, b, sort.direction, fix, cityNear)
				: compareRow(a, b, sort, fix, distanceProperty);
			if (diff !== 0) return diff;
		}
		return 0;
	});
	return copy;
}

/**
 * With a position, cities are ordered by the nearest note in that city.
 * Without one, City is alphabetical. Empty cities sort last.
 */
function compareCity(
	a: DistanceSortable,
	b: DistanceSortable,
	direction: SortDirection,
	fix: LatLon | null,
	cityNear: Map<string, number>,
): number {
	const left = cityText(a);
	const right = cityText(b);
	if (!left && !right) return 0;
	if (!left) return 1;
	if (!right) return -1;
	if (fix) {
		const diff = (cityNear.get(left) ?? Number.POSITIVE_INFINITY) - (cityNear.get(right) ?? Number.POSITIVE_INFINITY);
		if (diff !== 0) return direction === 'ASC' ? diff : -diff;
	}
	const name = left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
	return direction === 'ASC' ? name : -name;
}

function cityNearness(rows: readonly DistanceSortable[], fix: LatLon | null): Map<string, number> {
	const nearest = new Map<string, number>();
	if (!fix) return nearest;
	for (const row of rows) {
		const city = cityText(row);
		const meters = metersOf(row, fix);
		if (!city || meters == null) continue;
		const previous = nearest.get(city);
		if (previous == null || meters < previous) nearest.set(city, meters);
	}
	return nearest;
}

function cityText(row: DistanceSortable): string {
	const key = row.sortKeys['note.City'];
	if (!key || key.kind === 'empty') return '';
	return displayOf(key).trim();
}

function compareRow(
	a: DistanceSortable,
	b: DistanceSortable,
	sort: ActiveSort,
	fix: LatLon | null,
	distanceProperty: string,
): number {
	if (sort.property === distanceProperty) {
		return compareNullableNumber(metersOf(a, fix), metersOf(b, fix), sort.direction);
	}
	const left = a.sortKeys[sort.property] ?? { kind: 'empty' as const };
	const right = b.sortKeys[sort.property] ?? { kind: 'empty' as const };
	return compareSortable(left, right, sort.direction);
}

export function compareSortable(a: Sortable, b: Sortable, direction: SortDirection): number {
	if (a.kind === 'empty' && b.kind === 'empty') return 0;
	if (a.kind === 'empty') return 1;
	if (b.kind === 'empty') return -1;
	let diff = 0;
	if (a.kind === 'number' && b.kind === 'number') {
		diff = a.value - b.value;
	} else if (a.kind === 'date' && b.kind === 'date') {
		diff = a.value - b.value;
	} else {
		diff = displayOf(a).localeCompare(displayOf(b), undefined, { numeric: true, sensitivity: 'base' });
	}
	if (diff === 0) return 0;
	return direction === 'ASC' ? diff : -diff;
}

export function compareNullableNumber(a: number | null, b: number | null, direction: SortDirection): number {
	if (a == null && b == null) return 0;
	if (a == null) return 1;
	if (b == null) return -1;
	const diff = a - b;
	if (diff === 0) return 0;
	return direction === 'ASC' ? diff : -diff;
}

function metersOf(row: DistanceSortable, fix: LatLon | null): number | null {
	if (!fix || row.lat == null || row.lon == null) return null;
	return haversineMeters(fix, { lat: row.lat, lon: row.lon });
}

function displayOf(value: Sortable): string {
	if (value.kind === 'text') return value.value;
	if (value.kind === 'number' || value.kind === 'date') return String(value.value);
	return '';
}
