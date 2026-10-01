import { setIcon } from 'obsidian';
import { calendarDaysSince } from './dates';
import { formatDriveDate } from './dates';
import { readProperty } from './frontmatter';
import { displayedUrgency } from './row-score';
import { urgencyAccentColor, urgencyMark } from './scoring';
import { mountUrgencyGlyph } from './glancable-view';
import { resolveStatus, statusIcon, type RvStatus } from './status';
import type { RVLocatorSettings } from './types';
import { urgencyColorsFor } from './urgency-palette';

export interface NoteChromeHost {
	frontmatter(path: string): Record<string, unknown> | null;
	settings: RVLocatorSettings;
	snoozeUntil(path: string): Date | null;
	setStatus(path: string, status: RvStatus): void;
	openUrgency(path: string, name: string, event: MouseEvent): void;
	openPriority(path: string, name: string): void;
	openMap(): void;
	addHub(path: string): void;
	removeHub(path: string, label: string): void;
}

/** Quick Facts header badges, Quick Facts rows, and one shared Hub chip row. */
export function decorateNoteChrome(root: HTMLElement, path: string, host: NoteChromeHost): void {
	const data = host.frontmatter(path);
	if (!data) return;
	decorateQuickFacts(root, path, data, host);
	decorateHubRow(root, path, data, host);
}

function decorateQuickFacts(root: HTMLElement, path: string, data: Record<string, unknown>, host: NoteChromeHost): void {
	const callout = quickFactsCallout(root);
	if (!callout) return;
	const title = callout.querySelector(':scope > .callout-title');
	const content = callout.querySelector(':scope > .callout-content');
	if (!title || !content || !(title instanceof HTMLElement) || !(content instanceof HTMLElement)) return;
	const priority = finiteNumber(readProperty(data, 'Priority'));
	const status = resolveStatus(readProperty(data, 'Status'), priority);
	const urgency = noteUrgency(path, data, priority, host);
	const colors = urgencyColorsFor(host.settings.urgencyPalette, host.settings.urgencyCustomColors);
	callout.style.setProperty('--rv-urgency-accent', urgencyAccentColor(urgency, priority, colors));
	paintFactsTitle(title, path, data, status, priority, urgency, host);
	paintFactsBody(content, path, data, status, priority, host);
}

function quickFactsCallout(root: HTMLElement): HTMLElement | null {
	const list = root.matches('.callout[data-callout="rv"]')
		? [root]
		: Array.from(root.querySelectorAll('.callout[data-callout="rv"]'));
	for (const node of list) {
		if (!(node instanceof HTMLElement)) continue;
		const title = node.querySelector(':scope > .callout-title');
		if ((title?.textContent ?? '').includes('Quick Facts')) return node;
	}
	return null;
}

function paintFactsTitle(
	title: HTMLElement,
	path: string,
	data: Record<string, unknown>,
	status: RvStatus,
	priority: number | null,
	urgency: number | null,
	host: NoteChromeHost,
): void {
	const inner = title.querySelector('.callout-title-inner');
	if (inner) inner.textContent = 'Quick Facts';
	let badges = title.querySelector(':scope > .rv-qf-badges');
	if (!(badges instanceof HTMLElement)) {
		badges = title.createSpan('rv-qf-badges');
	}
	badges.empty();
	const name = path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
	if (host.settings.showUrgencyBadge) {
		const marks = urgencyMark(urgency, priority);
		const button = badges.createEl('button', {
			cls: 'rv-locator-urgency',
			attr: { type: 'button', 'data-band': String(marks.band), 'aria-label': 'Urgency' },
		});
		mountUrgencyGlyph(button, marks.glyphs);
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			host.openUrgency(path, name, event);
		});
	}
	if (host.settings.showPriorityBadge && priority != null) {
		const pill = badges.createEl('button', {
			cls: 'rv-locator-priority-pill',
			text: String(Math.max(0, Math.min(5, Math.round(priority)))),
			attr: { type: 'button', 'aria-label': `Priority ${priority}` },
		});
		pill.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			host.openPriority(path, name);
		});
	}
	if (host.settings.showRouteBadge) {
		const route = badges.createEl('button', {
			cls: 'rv-locator-map-pin',
			attr: { type: 'button', 'aria-label': 'Map, coming soon' },
		});
		setIcon(route, 'route');
		route.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			host.openMap();
		});
	}
	title.setAttr('data-rv-status', status);
}

function paintFactsBody(
	content: HTMLElement,
	path: string,
	data: Record<string, unknown>,
	status: RvStatus,
	priority: number | null,
	host: NoteChromeHost,
): void {
	content.empty();
	content.addClass('rv-qf-body');
	const statusRow = factRow(content, statusIcon(status), 'Status', '');
	const statusValue = statusRow.querySelector('.rv-qf-value');
	const select = (statusValue instanceof HTMLElement ? statusValue : statusRow).createEl('select', { cls: 'rv-qf-control' });
	for (const option of ['Study', 'Active', 'Inactive'] as const) {
		select.createEl('option', { text: option, value: option });
	}
	select.value = status;
	select.addEventListener('change', () => {
		host.setStatus(path, select.value === 'Study' || select.value === 'Inactive' ? select.value : 'Active');
	});

	factRow(content, 'gauge', 'Priority', priority == null ? '—' : String(priority));
	const successful = finiteNumber(readProperty(data, 'Successful Visits'));
	const visits = finiteNumber(readProperty(data, 'Visits'));
	const ratio = `${successful == null ? '—' : String(successful)}/${visits == null ? '—' : String(visits)}`;
	factRow(content, 'list-checks', 'Visits', ratio);

	factRow(content, 'message-circle', 'Last Spoke', stampText(readProperty(data, 'Last Spoke')));
	factRow(content, 'clock', 'Last Attempted', stampText(readProperty(data, 'Last Attempted')));
	factRow(content, 'home', 'Met', stampText(readProperty(data, 'Met')));

	const taken = textList(readProperty(data, 'Taken'));
	const metWith = textOf(readProperty(data, 'Met With')).toLowerCase();
	const row = factRow(content, 'users', 'Taken', taken.length === 0 ? '—' : '');
	if (taken.length > 0) {
		const value = row.querySelector('.rv-qf-value');
		if (value instanceof HTMLElement) {
			value.empty();
			for (const name of taken) {
				const chip = value.createSpan({
					cls: `rv-qf-taken${name.toLowerCase() === metWith ? ' is-met-with' : ''}`,
					text: name,
				});
				if (name.toLowerCase() === metWith) chip.setAttr('title', 'Met With');
			}
		}
	}
}

function factRow(parent: HTMLElement, icon: string, label: string, value = ''): HTMLElement {
	const row = parent.createDiv('rv-qf-row');
	const iconEl = row.createSpan('rv-qf-icon');
	setIcon(iconEl, icon);
	row.createSpan({ cls: 'rv-qf-label', text: label });
	const valueEl = row.createSpan({ cls: 'rv-qf-value', text: value });
	if (!value) valueEl.empty();
	return row;
}

function decorateHubRow(root: HTMLElement, path: string, data: Record<string, unknown>, host: NoteChromeHost): void {
	const paragraphs = root.matches('p') ? [root] : Array.from(root.querySelectorAll('p'));
	for (const paragraph of paragraphs) {
		if (!(paragraph instanceof HTMLElement)) continue;
		const strong = paragraph.querySelector(':scope > strong');
		const label = (strong?.textContent ?? '').replace(/:$/, '').trim().toLowerCase();
		if (label !== 'hub' && label !== 'hubs') continue;
		if (strong) strong.textContent = 'Hub:';
		paragraph.addClass('rv-hub-owned');
		let row = paragraph.querySelector(':scope > .rv-hub-row');
		if (!(row instanceof HTMLElement)) row = paragraph.createSpan('rv-hub-row');
		row.empty();
		const hubs = textList(readProperty(data, 'Hub'));
		for (const hub of hubs) {
			const chip = row.createSpan({ cls: 'rv-hub-chip', text: hub, attr: { title: hub } });
			const remove = chip.createEl('button', {
				cls: 'rv-hub-remove',
				text: '×',
				attr: { type: 'button', 'aria-label': `Remove ${hub}` },
			});
			remove.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				host.removeHub(path, hub);
			});
		}
		const add = row.createEl('button', {
			cls: 'rv-hub-add',
			attr: { type: 'button', 'aria-label': 'Add hub' },
		});
		setIcon(add, 'plus');
		add.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			host.addHub(path);
		});
	}
}

function noteUrgency(path: string, data: Record<string, unknown>, priority: number | null, host: NoteChromeHost): number | null {
	const spoke = readProperty(data, 'Last Spoke');
	const raw = spoke instanceof Date ? spoke.toISOString() : typeof spoke === 'string' ? spoke : '';
	const days = raw ? calendarDaysSince(raw, new Date()) : null;
	return displayedUrgency(days, priority, host.settings, host.snoozeUntil(path), new Date());
}

function stampText(value: unknown): string {
	const raw = value instanceof Date ? value.toISOString() : textOf(value);
	if (!raw) return '—';
	const display = formatDriveDate(raw);
	if (display.empty) return '—';
	return display.rest ? `${display.text} — ${display.rest}` : display.text;
}

function textList(value: unknown): string[] {
	const source = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
	const names: string[] = [];
	for (const item of source) {
		const text = wikiLabel(textOf(item));
		if (text) names.push(text);
	}
	return names;
}

function wikiLabel(text: string): string {
	const raw = text.replace(/^["']|["']$/g, '').trim();
	const wiki = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/.exec(raw);
	if (!wiki) return raw;
	const alias = wiki[2]?.trim();
	if (alias) return alias;
	const target = (wiki[1] ?? raw).trim();
	return (target.split('/').pop() ?? target).replace(/\.md$/i, '');
}

function textOf(value: unknown): string {
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	return '';
}

function finiteNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
	return null;
}
