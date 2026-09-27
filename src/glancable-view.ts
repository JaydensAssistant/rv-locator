import { setIcon, type QueryController } from 'obsidian';
import type { NearbyScope } from './active-layout';
import { GLANCABLE_VIEW_TYPE } from './constants';
import type { CellModel, ColumnModel, RowModel } from './model';
import type RVLocatorPlugin from './main';
import { glancableLineId } from './glancable-lines';
import { NearbyBasesView } from './nearby-view';

export class NearbyGlancableView extends NearbyBasesView {
	readonly type: string;

	constructor(
		controller: QueryController,
		parentEl: HTMLElement,
		plugin: RVLocatorPlugin,
		viewType: string = GLANCABLE_VIEW_TYPE,
		scope: NearbyScope = 'active',
	) {
		super(controller, parentEl, plugin, 'glancable', scope);
		this.type = viewType;
		this.quietBanner = true;
	}

	protected paint(): void {
		const groups = this.sortedGroups();
		groups.forEach((group, groupIndex) => {
			if (group.label) {
				this.scrollEl.createDiv({ cls: 'rv-locator-group-label', text: group.label });
			}
			const grid = this.scrollEl.createDiv('rv-locator-card-grid');
			group.rows.forEach((row, rowIndex) => {
				this.paintCard(grid, row, `${groupIndex}:${rowIndex}:${row.path}`);
			});
		});
	}

	private paintCard(parent: HTMLElement, row: RowModel, key: string): void {
		const card = parent.createDiv('rv-locator-card');
		const rank = priorityRank(this.cellNamed(row, 'Priority'));
		if (rank) {
			card.setAttr('data-priority', rank);
			card.setAttr('title', `Priority ${rank}`);
		}

		const name = card.createDiv('rv-locator-card-name');
		name.setAttr('data-line', glancableLineId(0));
		const link = name.createEl('a', {
			cls: 'rv-locator-file-link',
			text: row.name,
			href: row.path,
			title: row.name,
		});
		this.bindFileLink(link, row.path);

		const place = card.createDiv('rv-locator-place');
		place.setAttr('data-line', glancableLineId(1));
		if (row.addressStreet) {
			place.createSpan({
				cls: 'rv-locator-card-street',
				text: row.addressStreet,
				title: row.addressText || row.addressStreet,
			});
		}
		if (row.addressCity) {
			place.createSpan({
				cls: 'rv-locator-city-lg',
				text: row.addressCity,
				title: row.addressText || row.addressCity,
			});
		}
		const distance = this.distanceLabel(row);
		const live = distance !== '—';
		const distEl = place.createSpan({
			cls: `rv-locator-distance-lg${live ? ' is-live' : ' is-missing'}`,
			text: live ? `· ${distance}` : '· —',
			attr: { 'aria-label': live ? `Distance ${distance}` : 'Distance unavailable' },
		});
		distEl.setAttr('title', live ? distance : 'No position');
		this.rememberDistance(key, distEl, row);

		const when = card.createDiv('rv-locator-when');
		this.iconSlot(when, row, 'Last Spoke', 'message-circle', 'Last Spoke', glancableLineId(2));
		this.iconSlot(when, row, 'Last Attempted', 'clock', 'Last Attempted', glancableLineId(3));
		this.iconSlot(when, row, 'Met', 'home', 'Met', glancableLineId(4));

		const foot = card.createDiv('rv-locator-card-foot');
		foot.setAttr('data-line', glancableLineId(5));
		const metWith = this.cellNamed(row, 'Met With');
		const metText = metWith && metWith.kind !== 'empty' && metWith.text && metWith.text !== '—'
			? metWith.text
			: '';
		this.plainSlot(foot, 'user', metText || '—', metText ? `Met with ${metText}` : 'Met with', !metText);
		const ratio = visitRatio(this.cellNamed(row, 'Successful Visits'), this.cellNamed(row, 'Visits'));
		const ratioEl = foot.createSpan({
			cls: 'rv-locator-slot rv-locator-visits',
			attr: { title: ratio.title },
		});
		ratioEl.createSpan({ cls: 'rv-locator-slot-text', text: `# ${ratio.text}` });
		this.paintActions(card, rank, row);
	}

	private paintActions(parent: HTMLElement, rank: string | null, row: RowModel): void {
		const showRank = rank != null;
		const map = this.mapCell(row);
		const showMap = map?.kind === 'url' && Boolean(map.text);
		if (!showRank && !showMap) return;
		parent.addClass('has-actions');
		const actions = parent.createSpan('rv-locator-card-actions');
		if (showRank && rank) {
			const pill = actions.createEl('button', {
				cls: 'rv-locator-priority-pill',
				text: rank,
				attr: {
					type: 'button',
					title: `Priority ${rank}. Log a visit.`,
					'aria-label': `Priority ${rank}. Were they home?`,
				},
			});
			pill.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.plugin.promptVisit(row.path, row.name);
			});
		}
		if (showMap && map) this.renderMapChip(actions, map);
	}

	private iconSlot(parent: HTMLElement, row: RowModel, name: string, icon: string, label: string, lineId: string): void {
		const cell = this.cellNamed(row, name);
		const text = cell && cell.kind !== 'empty' && cell.text && cell.text !== '—' ? cell.text : null;
		if (!cell || text == null) {
			this.plainSlot(parent, icon, '—', label, true, '', lineId);
			return;
		}
		const slot = parent.createSpan({
			cls: 'rv-locator-slot',
			attr: { title: cell.title || label, 'data-line': lineId },
		});
		const iconEl = slot.createSpan('rv-locator-slot-icon');
		setIcon(iconEl, icon);
		if (cell.dow) {
			this.renderDriveDate(slot, cell);
			return;
		}
		slot.createSpan({ cls: 'rv-locator-slot-text', text });
	}

	private plainSlot(parent: HTMLElement, icon: string, text: string, title: string, empty: boolean, extra = '', lineId = ''): void {
		const slot = parent.createSpan({
			cls: `rv-locator-slot${empty ? ' is-empty' : ''}${extra ? ` ${extra}` : ''}`,
			attr: { title, ...(lineId ? { 'data-line': lineId } : {}) },
		});
		const iconEl = slot.createSpan('rv-locator-slot-icon');
		setIcon(iconEl, icon);
		slot.createSpan({ cls: 'rv-locator-slot-text', text });
	}

	private renderMapChip(parent: HTMLElement, cell: CellModel): void {
		const link = parent.createEl('a', {
			cls: 'rv-locator-map-pin',
			href: cell.text,
			title: cell.title || 'Open map',
			attr: {
				rel: 'noopener',
				target: '_blank',
				'aria-label': 'Open map',
			},
		});
		setIcon(link, 'map-pin');
	}

	private mapCell(row: RowModel): CellModel | undefined {
		const wanted = this.plugin.settings.mapLinkProperty.trim().toLowerCase();
		const column = this.columns.find((item) => {
			const name = item.name.trim().toLowerCase();
			const label = item.displayName.trim().toLowerCase();
			return (wanted && (name === wanted || label === wanted)) || name === 'map link' || label === 'map link';
		});
		if (!column) return undefined;
		return row.cells.find((cell) => cell.id === column.id);
	}

	private cellNamed(row: RowModel, name: string): CellModel | undefined {
		const column = this.columnNamed(name);
		if (!column) return undefined;
		return row.cells.find((cell) => cell.id === column.id);
	}

	private columnNamed(name: string): ColumnModel | undefined {
		const wanted = name.trim().toLowerCase();
		return this.columns.find((column) => column.name.trim().toLowerCase() === wanted);
	}

}

function priorityRank(cell: CellModel | undefined): string | null {
	if (!cell || cell.kind === 'empty' || !cell.text) return null;
	const parsed = Number(cell.text);
	if (!Number.isFinite(parsed)) return null;
	const rank = Math.round(parsed);
	if (rank < 0 || rank > 5) return null;
	return String(rank);
}

function visitRatio(successful: CellModel | undefined, visits: CellModel | undefined): { text: string; title: string } {
	const home = countText(successful);
	const total = countText(visits);
	const homeLabel = home === '—' ? 'no successful count' : `${home} successful`;
	const totalLabel = total === '—' ? 'no visit count' : `${total} visits`;
	return { text: `${home}/${total}`, title: `${homeLabel} of ${totalLabel}` };
}

function countText(cell: CellModel | undefined): string {
	if (!cell || cell.kind === 'empty' || !cell.text || cell.text === '—') return '—';
	const count = Number(cell.text);
	if (!Number.isFinite(count)) return cell.text;
	return Number.isInteger(count) ? String(count) : cell.text;
}
