import type { ColumnModel, GroupModel, RowModel } from './model';

let held: GroupModel[] | null = null;
let heldColumns: ColumnModel[] | null = null;

function cloneRow(row: RowModel): RowModel {
	return {
		...row,
		cells: row.cells.map((cell) => ({ ...cell })),
		sortKeys: { ...row.sortKeys },
	};
}

/** Last non-empty glancable list. A new hub shell paints this before Bases answers. */
export function rememberGlanceGroups(groups: readonly GroupModel[], columns: readonly ColumnModel[] = []): void {
	const rows = groups.reduce((sum, group) => sum + group.rows.length, 0);
	if (rows === 0) return;
	held = groups.map((group) => ({
		label: group.label,
		rows: group.rows.map(cloneRow),
	}));
	heldColumns = columns.length > 0 ? columns.map((column) => ({ ...column })) : null;
}

export function heldGlanceColumns(): ColumnModel[] | null {
	if (!heldColumns || heldColumns.length === 0) return null;
	return heldColumns.map((column) => ({ ...column }));
}

export function heldGlanceGroups(): GroupModel[] | null {
	if (!held || held.every((group) => group.rows.length === 0)) return null;
	return held.map((group) => ({
		label: group.label,
		rows: group.rows.map(cloneRow),
	}));
}

export function clearGlanceHold(): void {
	held = null;
	heldColumns = null;
}
