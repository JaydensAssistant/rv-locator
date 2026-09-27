import type { QueryController } from 'obsidian';
import type { NearbyScope } from './active-layout';
import { VANILLA_VIEW_TYPE } from './constants';
import type { ColumnModel, RowModel } from './model';
import type RVLocatorPlugin from './main';
import { NearbyBasesView } from './nearby-view';

export class NearbyVanillaView extends NearbyBasesView {
	readonly type: string;

	constructor(
		controller: QueryController,
		parentEl: HTMLElement,
		plugin: RVLocatorPlugin,
		viewType: string = VANILLA_VIEW_TYPE,
		scope: NearbyScope = 'active',
	) {
		super(controller, parentEl, plugin, 'vanilla', scope);
		this.type = viewType;
	}

	protected paint(): void {
		const table = this.scrollEl.createEl('table', { cls: 'rv-locator-table' });
		const headRow = table.createEl('thead').createEl('tr');
		for (const column of this.columns) {
			const th = headRow.createEl('th', { cls: columnClass(column) });
			this.headerButton(th, column, this.iconSample(column));
		}

		const tbody = table.createEl('tbody');
		const groups = this.sortedGroups();
		groups.forEach((group, groupIndex) => {
			if (group.label) {
				const groupRow = tbody.createEl('tr', { cls: 'rv-locator-group' });
				groupRow.createEl('td', {
					text: group.label,
					attr: { colspan: String(Math.max(1, this.columns.length)) },
				});
			}
			group.rows.forEach((row, rowIndex) => {
				const tr = tbody.createEl('tr');
				for (const column of this.columns) {
					const td = tr.createEl('td', { cls: columnClass(column) });
					if (column.isDistance) {
						const text = this.distanceLabel(row);
						const wrap = td.createSpan('rv-locator-distance-wrap');
						const span = wrap.createSpan({
							cls: 'rv-locator-distance',
							text,
							title: text === '—' ? 'No coordinates, or this device has no position yet' : text,
						});
						if (row.addressCity) {
							wrap.createSpan({
								cls: 'rv-locator-city',
								text: row.addressCity,
								title: row.addressText || row.addressCity,
							});
						}
						this.rememberDistance(`${groupIndex}:${rowIndex}:${row.path}`, span, row);
						continue;
					}
					if (this.isAddressColumn(column)) {
						const full = row.addressText;
						const shown = row.addressStreet || full;
						if (shown) {
							td.createSpan({
								cls: 'rv-locator-text',
								text: shown,
								title: full || shown,
							});
						}
						continue;
					}
					const cell = row.cells.find((item) => item.id === column.id);
					if (!cell) continue;
					if (this.isPriorityColumn(column) && cell.kind !== 'empty' && cell.text) {
						this.paintPriority(td, cell.text, row);
						continue;
					}
					if (cell.numeric) td.addClass('is-number');
					this.renderCell(td, cell, row.path);
				}
			});
		});
	}

	private paintPriority(parent: HTMLElement, text: string, row: RowModel): void {
		const rank = Number(text);
		const label = Number.isFinite(rank) ? String(Math.round(rank)) : text;
		const button = parent.createEl('button', {
			cls: 'rv-locator-priority-btn',
			text: label,
			attr: {
				type: 'button',
				title: `Priority ${label}. Log a visit.`,
				'aria-label': `Priority ${label}. Were they home?`,
			},
		});
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.plugin.promptVisit(row.path, row.name);
		});
	}

	private isPriorityColumn(column: ColumnModel): boolean {
		return column.name.trim().toLowerCase() === 'priority'
			|| column.displayName.trim().toLowerCase() === 'priority';
	}

	private isAddressColumn(column: ColumnModel): boolean {
		const wanted = this.plugin.settings.addressProperty.trim().toLowerCase();
		if (!wanted) return false;
		return column.name.trim().toLowerCase() === wanted
			|| column.displayName.trim().toLowerCase() === wanted;
	}

	private iconSample(column: ColumnModel): RowModel | undefined {
		for (const group of this.groups) {
			for (const row of group.rows) {
				const key = row.sortKeys[column.id];
				if (key && key.kind !== 'empty') return row;
			}
		}
		return this.groups[0]?.rows[0];
	}
}

function columnClass(column: ColumnModel): string {
	const classes: string[] = [];
	if (column.isDistance) classes.push('is-distance');
	if (column.isFileName) classes.push('is-file');
	return classes.join(' ');
}
