import { setIcon, type QueryController } from 'obsidian';
import type { NearbyScope } from './active-layout';
import { GLANCABLE_VIEW_TYPE } from './constants';
import { glancableColumns } from './glancable-density';
import type { CellModel, ColumnModel, RowModel } from './model';
import type RVLocatorPlugin from './main';
import { glancableLineId } from './glancable-lines';
import { NearbyBasesView } from './nearby-view';
import { rowPriority, rowUrgency } from './row-score';
import { urgencyAccentColor, urgencyBand, urgencyMark } from './scoring';
import type { GlancableLineId } from './types';

export class NearbyGlancableView extends NearbyBasesView {
	readonly type: string;
	private layoutObserver: ResizeObserver | null = null;

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
		this.applyDensity();
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
		this.applyColumnSnap();
		this.watchLayout();
	}

	private paintCard(parent: HTMLElement, row: RowModel, key: string): void {
		const card = parent.createDiv('rv-locator-card');
		const rank = priorityRank(this.cellNamed(row, 'Priority'));
		const priority = rowPriority(row);
		const urgency = rowUrgency(row, this.plugin.settings, new Date(), this.plugin.snoozeUntilFor(row.path));
		const band = priority != null && priority > 0 ? urgencyBand(urgency) : 0;
		card.setAttr('data-urgency-band', String(band));
		if (priority === 0) card.addClass('is-priority-zero');
		card.style.setProperty('--rv-urgency-accent', urgencyAccentColor(urgency, priority));
		const titleBits: string[] = [];
		if (rank) {
			card.setAttr('data-priority', rank);
			titleBits.push(`Priority ${rank}`);
		}
		if (urgency != null) titleBits.push(`Urgency ${urgency.toFixed(2)}`);
		if (titleBits.length > 0) card.setAttr('title', titleBits.join('. '));

		if (this.lineOn('name')) {
			const name = card.createDiv('rv-locator-card-name');
			name.setAttr('data-line', glancableLineId(0));
			const link = name.createEl('a', {
				cls: 'rv-locator-file-link',
				text: row.name,
				href: row.path,
				title: row.name,
			});
			this.bindFileLink(link, row.path);
		}

		const showStreet = this.lineOn('street') && Boolean(row.addressStreet);
		const showCity = this.lineOn('city') && Boolean(row.addressCity);
		const showDistance = this.lineOn('distance');
		if (showStreet || showCity || showDistance) {
			const place = card.createDiv('rv-locator-place');
			place.setAttr('data-line', glancableLineId(1));
			if (showStreet && row.addressStreet) {
				place.createSpan({
					cls: 'rv-locator-card-street',
					text: row.addressStreet,
					title: row.addressText || row.addressStreet,
				});
			}
			if (showCity && row.addressCity) {
				place.createSpan({
					cls: 'rv-locator-city-lg',
					text: row.addressCity,
					title: row.addressText || row.addressCity,
				});
			}
			if (showDistance) {
				const distance = this.distanceLabel(row);
				const live = distance !== '—';
				const distEl = place.createSpan({
					cls: `rv-locator-distance-lg${live ? ' is-live' : ' is-missing'}`,
					text: live ? `· ${distance}` : '· —',
					attr: { 'aria-label': live ? `Distance ${distance}` : 'Distance unavailable' },
				});
				distEl.setAttr('title', live ? distance : 'No position');
				this.rememberDistance(key, distEl, row);
			}
		}

		const showSpoke = this.lineOn('last-spoke');
		const showAttempted = this.lineOn('last-attempted');
		const showMet = this.lineOn('met');
		if (showSpoke || showAttempted || showMet) {
			const when = card.createDiv('rv-locator-when');
			if (showSpoke) this.iconSlot(when, row, 'Last Spoke', 'message-circle', 'Last Spoke', glancableLineId(2));
			if (showAttempted) this.iconSlot(when, row, 'Last Attempted', 'clock', 'Last Attempted', glancableLineId(3));
			if (showMet) this.iconSlot(when, row, 'Met', 'home', 'Met', glancableLineId(4));
		}

		const foot = card.createDiv('rv-locator-card-foot');
		foot.setAttr('data-line', glancableLineId(5));
		if (this.lineOn('met-with')) {
			const metWith = this.cellNamed(row, 'Met With');
			const metText = metWith && metWith.kind !== 'empty' && metWith.text && metWith.text !== '—'
				? metWith.text
				: '';
			this.plainSlot(foot, 'user', metText || '—', metText ? `Met With ${metText}` : 'Met With', !metText);
		}
		if (this.lineOn('visits')) {
			const ratio = visitRatio(this.cellNamed(row, 'Successful Visits'), this.cellNamed(row, 'Visits'));
			const ratioEl = foot.createSpan({
				cls: 'rv-locator-slot rv-locator-visits',
				attr: { title: ratio.title },
			});
			ratioEl.createSpan({ cls: 'rv-locator-slot-text', text: `# ${ratio.text}` });
		}
		this.paintActions(card, rank, row, urgency, priority);
	}

	private paintActions(
		parent: HTMLElement,
		rank: string | null,
		row: RowModel,
		urgency: number | null,
		priority: number | null,
	): void {
		const showRank = rank != null;
		const map = this.mapCell(row);
		const showMap = map?.kind === 'url' && Boolean(map.text);
		const marks = urgencyMark(urgency, priority);
		parent.addClass('has-actions');
		const actions = parent.createSpan('rv-locator-card-actions');
		const urgencyButton = actions.createEl('button', {
			cls: 'rv-locator-urgency',
			text: marks.glyphs,
			attr: {
				type: 'button',
				'data-band': String(marks.band),
				title: urgencyTitle(urgency, priority),
				'aria-label': urgencyTitle(urgency, priority),
			},
		});
		urgencyButton.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.plugin.promptUrgencySnooze(row.path, row.name);
		});
		if (showRank && rank) {
			const pill = actions.createEl('button', {
				cls: 'rv-locator-priority-pill',
				text: rank,
				attr: {
					type: 'button',
					title: `Priority ${rank}. Log a visit.`,
					'aria-label': `Priority ${rank}. Home or Not home?`,
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

	private lineOn(id: GlancableLineId): boolean {
		return this.plugin.settings.glancableLines[id] !== false;
	}

	private applyDensity(): void {
		const settings = this.plugin.settings;
		this.root.style.setProperty('--rv-pad-y', `${settings.glancablePaddingY}px`);
		this.root.style.setProperty('--rv-pad-x', `${settings.glancablePaddingX}px`);
		this.root.style.setProperty('--rv-font-scale', String(settings.glancableFontScale));
		this.root.style.setProperty('--rv-control-size', `calc(28px * ${settings.glancableFontScale})`);
		this.root.style.setProperty(
			'--rv-line-max',
			settings.glancableMaxLineChars > 0 ? `${settings.glancableMaxLineChars}ch` : '100%',
		);
	}

	private applyColumnSnap(): void {
		const columns = glancableColumns(this.scrollEl.clientWidth, this.plugin.settings);
		const template = columns === 2 ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)';
		for (const node of Array.from(this.scrollEl.querySelectorAll('.rv-locator-card-grid'))) {
			(node as HTMLElement).style.gridTemplateColumns = template;
		}
	}

	private watchLayout(): void {
		if (this.layoutObserver || typeof ResizeObserver === 'undefined') return;
		this.layoutObserver = new ResizeObserver(() => this.applyColumnSnap());
		this.layoutObserver.observe(this.scrollEl);
		this.register(() => {
			this.layoutObserver?.disconnect();
			this.layoutObserver = null;
		});
	}

	private columnNamed(name: string): ColumnModel | undefined {
		const wanted = name.trim().toLowerCase();
		return this.columns.find((column) => column.name.trim().toLowerCase() === wanted);
	}

}

function urgencyTitle(urgency: number | null, priority: number | null): string {
	if (priority == null || priority <= 0) return 'Priority 0. No urgency color.';
	if (urgency == null) return 'Urgency. Snooze for today, 7 days, or 14 days.';
	if (urgency < 1) return `Urgency ${urgency.toFixed(2)}. Snooze for today, 7 days, or 14 days.`;
	return `Urgency ${urgency.toFixed(2)}. Snooze for today, 7 days, or 14 days.`;
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
	const homeLabel = home === '—' ? 'Successful Visits missing' : `${home} Successful Visits`;
	const totalLabel = total === '—' ? 'Visits missing' : `${total} Visits`;
	return { text: `${home}/${total}`, title: `${homeLabel} of ${totalLabel}` };
}

function countText(cell: CellModel | undefined): string {
	if (!cell || cell.kind === 'empty' || !cell.text || cell.text === '—') return '—';
	const count = Number(cell.text);
	if (!Number.isFinite(count)) return cell.text;
	return Number.isInteger(count) ? String(count) : cell.text;
}
