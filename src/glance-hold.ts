import type { ColumnModel, GroupModel, RowModel } from './model';

interface GlanceSlot {
	groups: GroupModel[];
	columns: ColumnModel[] | null;
}

const slots = new Map<string, GlanceSlot>();
let last: GlanceSlot | null = null;

function cloneRow(row: RowModel): RowModel {
	return {
		...row,
		cells: row.cells.map((cell) => ({ ...cell })),
		sortKeys: { ...row.sortKeys },
	};
}

function cloneSlot(groups: readonly GroupModel[], columns: readonly ColumnModel[]): GlanceSlot {
	return {
		groups: groups.map((group) => ({
			label: group.label,
			rows: group.rows.map(cloneRow),
		})),
		columns: columns.length > 0 ? columns.map((column) => ({ ...column })) : null,
	};
}

function readSlot(key: string): GlanceSlot | null {
	if (key) return slots.get(key) ?? null;
	return last;
}

/**
 * Last list for this file. A hub and a base do not share a slot, so one
 * view cannot paint the other's cards. An empty key is the test fallback.
 */
export function rememberGlanceGroups(groups: readonly GroupModel[], columns: readonly ColumnModel[] = [], key = ''): void {
	const rows = groups.reduce((sum, group) => sum + group.rows.length, 0);
	if (rows === 0) return;
	const slot = cloneSlot(groups, columns);
	if (key) slots.set(key, slot);
	last = slot;
}

export function heldGlanceColumns(key = ''): ColumnModel[] | null {
	const columns = readSlot(key)?.columns;
	if (!columns || columns.length === 0) return null;
	return columns.map((column) => ({ ...column }));
}

export function heldGlanceGroups(key = ''): GroupModel[] | null {
	const groups = readSlot(key)?.groups;
	if (!groups || groups.every((group) => group.rows.length === 0)) return null;
	return groups.map((group) => ({
		label: group.label,
		rows: group.rows.map(cloneRow),
	}));
}

export function clearGlanceHold(): void {
	slots.clear();
	last = null;
}
