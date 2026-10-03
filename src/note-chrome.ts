import { Menu, setIcon } from 'obsidian';
import { calendarDaysSince, formatDaysAgo, formatDriveDate } from './dates';
import { readProperty } from './frontmatter';
import { hubRefs, type HubRef } from './hub-row';
import { displayedUrgency } from './row-score';
import { urgencyAccentColor, urgencyMark } from './scoring';
import { mountUrgencyGlyph } from './glancable-view';
import { resolveStatus, statusIcon, type RvStatus } from './status';
import { layoutTakenNames } from './taken-row';
import type { RVLocatorSettings } from './types';
import { urgencyColorsFor } from './urgency-palette';

export interface NoteChromeHost {
	frontmatter(path: string): Record<string, unknown> | null;
	settings: RVLocatorSettings;
	snoozeUntil(path: string): Date | null;
	setStatus(path: string, status: RvStatus): void;
	setPriority(path: string, priority: number): void;
	openUrgency(path: string, name: string, event: MouseEvent): void;
	openPriority(path: string, name: string): void;
	openRoute(path: string): void;
	openHub(path: string, target: string): void;
	addHub(path: string): void;
	removeHub(path: string, label: string): void;
	moveHub(path: string, label: string): void;
	openSlotOverride(path: string): void;
}

const LONG_PRESS_MS = 500;

/** Quick Facts header badges, Quick Facts rows, and one shared Hub chip row. */
export function decorateNoteChrome(root: HTMLElement, path: string, host: NoteChromeHost): void {
	const data = host.frontmatter(path);
	if (!data) return;
	decorateQuickFacts(root, path, data, host);
	decorateHubRow(root, path, data, host);
	decorateSlotOverride(root, path, data, host);
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
	const accent = urgencyAccentColor(urgency, priority, colors);
	callout.style.setProperty('--rv-urgency-accent', accent);
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
			attr: { type: 'button', 'aria-label': 'Open in Google Maps' },
		});
		setIcon(route, 'route');
		route.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			host.openRoute(path);
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
	for (const option of ['Active', 'Study', 'Inactive'] as const) {
		select.createEl('option', { text: option, value: option });
	}
	select.value = status;
	select.addEventListener('change', () => {
		host.setStatus(path, select.value === 'Study' || select.value === 'Inactive' ? select.value : 'Active');
	});

	const priorityRow = factRow(content, 'gauge', 'Priority', '');
	const priorityValue = priorityRow.querySelector('.rv-qf-value');
	if (priorityValue instanceof HTMLElement) {
		const slider = priorityValue.createEl('input', {
			cls: 'rv-qf-priority',
			attr: { type: 'range', min: '0', max: '5', step: '1', 'aria-label': 'Priority' },
		});
		const shown = priority == null ? 0 : Math.max(0, Math.min(5, Math.round(priority)));
		slider.value = String(shown);
		const number = priorityValue.createSpan({ cls: 'rv-qf-priority-num', text: priority == null ? '—' : String(shown) });
		slider.addEventListener('input', () => {
			number.setText(slider.value);
		});
		slider.addEventListener('change', () => {
			host.setPriority(path, Number(slider.value));
		});
	}
	const successful = finiteNumber(readProperty(data, 'Successful Visits'));
	const visits = finiteNumber(readProperty(data, 'Visits'));
	const ratio = `${successful == null ? '—' : String(successful)}/${visits == null ? '—' : String(visits)}`;
	factRow(content, 'list-checks', 'Visits', ratio);

	factDateRow(content, 'message-circle', 'Spoke', readProperty(data, 'Last Spoke'));
	factDateRow(content, 'clock', 'Attempted', readProperty(data, 'Last Attempted'));
	factDateRow(content, 'home', 'Met', readProperty(data, 'Met'));

	const taken = textList(readProperty(data, 'Taken'));
	const metWith = textOf(readProperty(data, 'Met With'));
	const row = factRow(content, 'users', 'Taken', taken.length === 0 ? '—' : '');
	if (taken.length > 0) paintTaken(row, taken, metWith);
}

function factDateRow(parent: HTMLElement, icon: string, label: string, value: unknown): void {
	const row = factRow(parent, icon, label, '');
	const valueEl = row.querySelector('.rv-qf-value');
	if (!(valueEl instanceof HTMLElement)) return;
	const raw = value instanceof Date ? value.toISOString() : textOf(value);
	const display = formatDriveDate(raw);
	if (display.empty || !display.rest) {
		valueEl.setText('—');
		return;
	}
	const days = calendarDaysSince(raw, new Date());
	const when = valueEl.createSpan('rv-qf-when');
	const lead = display.time ? `${display.dow}, ${display.time}` : (display.dow || display.text);
	when.createSpan({ cls: 'rv-qf-when-lead', text: lead });
	when.createSpan({ cls: 'rv-qf-when-date', text: display.rest });
	if (days != null) when.createSpan({ cls: 'rv-qf-when-ago', text: formatDaysAgo(days) });
	when.setAttr('title', display.title || raw);
}

function paintTaken(row: HTMLElement, names: readonly string[], metWith: string): void {
	const value = row.querySelector('.rv-qf-value');
	if (!(value instanceof HTMLElement)) return;
	value.empty();
	const layout = layoutTakenNames(names, metWith);
	const line = value.createSpan('rv-qf-taken-line');
	const pieces: { name: string; kind: 'met' | 'scroll' | 'recent' }[] = [];
	if (layout.met) pieces.push({ name: layout.met, kind: 'met' });
	for (const name of layout.scroll) pieces.push({ name, kind: 'scroll' });
	if (layout.recent) pieces.push({ name: layout.recent, kind: 'recent' });
	let scroll: HTMLElement | null = null;
	pieces.forEach((piece, index) => {
		const host = piece.kind === 'scroll'
			? (scroll ?? (scroll = line.createSpan('rv-qf-taken-scroll')))
			: line.createSpan('rv-qf-taken-pin');
		if (index > 0) host.createSpan({ cls: 'rv-qf-comma', text: ', ' });
		const cls = piece.kind === 'met' ? 'rv-qf-taken is-met' : 'rv-qf-taken';
		const chip = host.createSpan({ cls, text: piece.name });
		if (piece.kind === 'met') chip.setAttr('title', 'Met With');
	});
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
		const foundAdd = paragraph.querySelector(':scope > .rv-hub-add');
		const add = foundAdd instanceof HTMLElement
			? foundAdd
			: paragraph.createEl('button', { cls: 'rv-hub-add', attr: { type: 'button', 'aria-label': 'Add hub' } });
		row.empty();
		add.empty();
		setIcon(add, 'plus');
		add.onclick = (event) => {
			event.preventDefault();
			event.stopPropagation();
			host.addHub(path);
		};
		const hubs = hubRefs(readProperty(data, 'Hub'));
		hubs.forEach((hub, index) => {
			row.appendChild(hubChip(paragraph.ownerDocument, path, hub, index, host));
		});
		if (row.nextElementSibling !== add) paragraph.appendChild(add);
	}
}

function hubChip(doc: Document, path: string, hub: HubRef, index: number, host: NoteChromeHost): HTMLAnchorElement {
	const link = doc.createElement('a');
	link.className = 'internal-link rv-hub-chip';
	link.textContent = hub.label;
	link.href = hub.target;
	link.dataset.href = hub.target;
	link.title = hub.label;
	link.addEventListener('click', (event) => {
		if (link.dataset.rvMenu === '1') {
			link.dataset.rvMenu = '';
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		host.openHub(path, hub.target);
	});
	const openMenu = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		link.dataset.rvMenu = '1';
		const menu = new Menu();
		if (index > 0) {
			menu.addItem((item) => {
				item.setTitle('Move Left');
				item.setIcon('arrow-left');
				item.onClick(() => host.moveHub(path, hub.label));
			});
		}
		menu.addItem((item) => {
			item.setTitle('Remove');
			item.setIcon('trash');
			item.onClick(() => host.removeHub(path, hub.label));
		});
		menu.showAtMouseEvent(event);
		window.setTimeout(() => { link.dataset.rvMenu = ''; }, 400);
	};
	link.addEventListener('contextmenu', openMenu);
	let timer: number | null = null;
	const clear = () => {
		if (timer != null) window.clearTimeout(timer);
		timer = null;
	};
	link.addEventListener('pointerdown', (event) => {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		clear();
		timer = window.setTimeout(() => openMenu(event), LONG_PRESS_MS);
	});
	link.addEventListener('pointerup', clear);
	link.addEventListener('pointerleave', clear);
	link.addEventListener('pointercancel', clear);
	return link;
}

function decorateSlotOverride(root: HTMLElement, path: string, data: Record<string, unknown>, host: NoteChromeHost): void {
	const callouts = root.matches('.callout') ? [root] : Array.from(root.querySelectorAll('.callout'));
	for (const callout of callouts) {
		if (!(callout instanceof HTMLElement)) continue;
		const title = callout.querySelector(':scope > .callout-title');
		if (!(title instanceof HTMLElement)) continue;
		if (!(title.textContent ?? '').includes('Attempt Log')) continue;
		const priority = finiteNumber(readProperty(data, 'Priority'));
		const urgency = noteUrgency(path, data, priority, host);
		const colors = urgencyColorsFor(host.settings.urgencyPalette, host.settings.urgencyCustomColors);
		callout.style.setProperty('--rv-urgency-accent', urgencyAccentColor(urgency, priority, colors));
		let badges = title.querySelector(':scope > .rv-qf-badges');
		if (!(badges instanceof HTMLElement)) badges = title.createSpan('rv-qf-badges');
		badges.empty();
		const button = badges.createEl('button', {
			cls: 'rv-locator-urgency rv-attempt-override',
			attr: { type: 'button', 'aria-label': 'Mark a daypart Try or Avoid' },
		});
		setIcon(button, 'calendar-plus-2');
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			host.openSlotOverride(path);
		});
	}
}

function noteUrgency(path: string, data: Record<string, unknown>, priority: number | null, host: NoteChromeHost): number | null {
	const spoke = readProperty(data, 'Last Spoke');
	const raw = spoke instanceof Date ? spoke.toISOString() : typeof spoke === 'string' ? spoke : '';
	const days = raw ? calendarDaysSince(raw, new Date()) : null;
	return displayedUrgency(days, priority, host.settings, host.snoozeUntil(path), new Date());
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
