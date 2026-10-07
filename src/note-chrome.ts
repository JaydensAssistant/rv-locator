import { Menu, setIcon } from 'obsidian';
import { attemptLogCallouts } from './attempt-digest';
import { pickDayJump, type DayJumpCandidate } from './day-jump';
import { calendarDaysSince, formatDaysAgo, formatDriveDate, parseDriveInstant, visibleStampText } from './dates';
import { parseLogBullet, stampDateTime } from './schedule';
import { readProperty } from './frontmatter';
import { hubRefs, resolveReturnHub, type HubRef } from './hub-row';
import { displayedUrgency } from './row-score';
import { urgencyAccentColor, urgencyMark } from './scoring';
import { mountUrgencyGlyph } from './glancable-view';
import { resolveStatus, statusIcon, type RvStatus } from './status';
import { lastListEntries } from './taken-row';
import type { RVLocatorSettings } from './types';
import { formatStudyFraction } from './catalog';
import { urgencyColorsFor, urgencyInk } from './urgency-palette';

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
	setAddress(path: string, address: string): void;
	openMap(path: string): void;
	openCompanion(path: string): void;
}

const LONG_PRESS_MS = 500;

/** Leaves and previews that own the urgency custom properties. */
const URGENCY_READY_SELECTOR = '.workspace-leaf-content, .markdown-preview-view, .markdown-reading-view, .rv-dashboard';

/** Quick Facts header badges, Quick Facts rows, and one shared Hub chip row. */
export function decorateNoteChrome(root: HTMLElement, path: string, host: NoteChromeHost): void {
	const data = host.frontmatter(path);
	if (!data) return;
	applyLiveUrgency(root, path, host);
	decorateQuickFacts(root, path, data, host);
	decorateHubRow(root, path, data, host);
	decorateSlotOverride(root, path, data, host);
}

/**
 * The note, its preview, and the leaf, walking up from `start`.
 * Custom properties inherit, so the leaf is enough for chrome that mounts later.
 */
export function urgencyStyleHosts(start: HTMLElement): HTMLElement[] {
	const hosts: HTMLElement[] = [start];
	let node = start.parentElement;
	while (node) {
		hosts.push(node);
		if (node.classList.contains('workspace-leaf-content')) break;
		node = node.parentElement;
	}
	return hosts;
}

/**
 * Render-only urgency on the note and Return Suggestions. Does not rewrite Markdown.
 * Sets the accent before chrome paints. With no frontmatter yet, clears a previous
 * note's accent so the hide-until-ready rule can hold the wrong color off screen.
 * `forceReady` unhides after the last remount even if frontmatter never arrives.
 */
export function applyLiveUrgency(start: HTMLElement, path: string, host: NoteChromeHost, forceReady = false): void {
	const hosts = urgencyStyleHosts(start);
	const data = host.frontmatter(path);
	if (!data) {
		if (forceReady) markUrgencyReady(hosts);
		else clearUrgencyPaint(hosts);
		return;
	}
	const priority = finiteNumber(readProperty(data, 'Priority'));
	const urgency = noteUrgency(path, data, priority, host);
	const colors = urgencyColorsFor(host.settings.urgencyPalette, host.settings.urgencyCustomColors);
	const accent = urgencyAccentColor(urgency, priority, colors);
	const ink = urgencyInk(accent);
	for (const el of hosts) {
		el.style.setProperty('--rv-urgency-accent', accent);
		el.style.setProperty('--rv-urgency-ink', ink);
		if (el.classList.contains('rv-locator-return-suggestions')) el.style.setProperty('--callout-color', accent);
	}
	start.querySelectorAll('.rv-locator-return-suggestions').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		node.style.setProperty('--rv-urgency-accent', accent);
		node.style.setProperty('--rv-urgency-ink', ink);
		node.style.setProperty('--callout-color', accent);
	});
	markUrgencyReady(hosts);
}

function markUrgencyReady(hosts: readonly HTMLElement[]): void {
	for (const el of hosts) {
		if (el.matches(URGENCY_READY_SELECTOR)) el.classList.add('is-urgency-ready');
	}
}

function clearUrgencyPaint(hosts: readonly HTMLElement[]): void {
	for (const el of hosts) {
		el.style.removeProperty('--rv-urgency-accent');
		el.style.removeProperty('--rv-urgency-ink');
		if (el.classList.contains('rv-locator-return-suggestions')) el.style.removeProperty('--callout-color');
		if (el.matches(URGENCY_READY_SELECTOR)) el.classList.remove('is-urgency-ready');
	}
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
	callout.style.setProperty('--rv-urgency-ink', urgencyInk(accent));
	const dashboard = callout.closest('.rv-dashboard');
	if (dashboard instanceof HTMLElement) {
		dashboard.style.setProperty('--rv-urgency-accent', accent);
		dashboard.style.setProperty('--rv-urgency-ink', urgencyInk(accent));
	}
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
	statusRow.addClass('is-status');
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
	const study = status === 'Study';
	if (study) {
		const lessons = textList(readProperty(data, 'Lessons Studied')).length;
		const studies = finiteNumber(readProperty(data, 'Studies')) ?? 0;
		const fraction = formatStudyFraction(lessons, studies, host.settings.studyRatio);
		const label = host.settings.studyRatio === 'studies-lessons' ? 'Studies/Lessons' : 'Lessons/Studies';
		factRow(content, 'percent', label, fraction.withDecimal);
	} else {
		const successful = finiteNumber(readProperty(data, 'Successful Visits'));
		const visits = finiteNumber(readProperty(data, 'Visits'));
		factRow(content, 'list-checks', 'Visits', visitsPercent(successful, visits));
	}

	if (study) factDateRow(content, 'book-marked', 'Studied', readProperty(data, 'Last Studied'));
	if (!study || host.settings.studyShowSpoke) factDateRow(content, 'message-circle', 'Spoke', readProperty(data, 'Last Spoke'));
	if (!study || host.settings.studyShowAttempted) factDateRow(content, 'clock', 'Attempted', readProperty(data, 'Last Attempted'));
	factDateRow(content, 'home', 'Met', readProperty(data, 'Met'));
	paintClampRow(content, 'book', 'Literature', textList(readProperty(data, 'Left Publications')));
	paintClampRow(content, 'film', 'Media', textList(readProperty(data, 'Shared Media')));
	if (study) paintClampRow(content, 'book-open', 'Lessons', textList(readProperty(data, 'Lessons Studied')));

	const taken = textList(readProperty(data, 'Taken'));
	const metWith = textOf(readProperty(data, 'Met With'));
	const row = factRow(content, 'users', 'Taken', '');
	bindCompanionOpen(row, path, host);
	const valueEl = row.querySelector('.rv-qf-value');
	if (valueEl instanceof HTMLElement) {
		if (taken.length === 0 && !metWith) valueEl.setText('—');
		else paintClampList(valueEl, taken.length > 0 ? taken : [metWith]);
	}
}

function visitsPercent(successful: number | null, visits: number | null): string {
	const home = successful == null ? '—' : String(successful);
	const total = visits == null ? '—' : String(visits);
	if (successful == null || visits == null || visits <= 0) return `${home}/${total}`;
	return `${successful}/${visits} (${Math.round((successful / visits) * 100)}%)`;
}

function paintClampRow(parent: HTMLElement, icon: string, label: string, items: readonly string[]): void {
	const row = factRow(parent, icon, label, '');
	const valueEl = row.querySelector('.rv-qf-value');
	if (!(valueEl instanceof HTMLElement)) return;
	if (items.length === 0) {
		valueEl.setText('—');
		return;
	}
	paintClampList(valueEl, items);
}

/** Last three entries, clamped to two lines. A tap shows the rest. */
function paintClampList(host: HTMLElement, items: readonly string[]): void {
	const recent = lastListEntries(items);
	const box = host.createSpan('rv-qf-clamp');
	box.setText(recent.join(' · '));
	if (items.length <= 1 && recent.join(' · ').length < 48) return;
	host.classList.add('is-collapsible');
	host.setAttr('role', 'button');
	host.tabIndex = 0;
	let open = false;
	const toggle = (event: Event): void => {
		event.preventDefault();
		event.stopPropagation();
		open = !open;
		box.setText((open ? items : recent).join(' · '));
		host.classList.toggle('is-expanded', open);
	};
	host.addEventListener('click', toggle);
	host.addEventListener('keydown', (event) => {
		if (!(event instanceof KeyboardEvent)) return;
		if (event.key !== 'Enter' && event.key !== ' ') return;
		toggle(event);
	});
}

function bindCompanionOpen(row: HTMLElement, path: string, host: NoteChromeHost): void {
	const open = (event: Event): void => {
		event.preventDefault();
		event.stopPropagation();
		host.openCompanion(path);
	};
	row.querySelector('.rv-qf-icon')?.addEventListener('click', open);
	row.querySelector('.rv-qf-label')?.addEventListener('click', open);
	row.classList.add('rv-qf-companion');
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
	const instant = parseDriveInstant(raw);
	if (!instant) return;
	when.setAttr('role', 'link');
	when.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		jumpToQuickFactDay(when, instant);
	});
}

interface DayJumpTarget extends DayJumpCandidate {
	el: HTMLElement;
}

function jumpToQuickFactDay(anchor: HTMLElement, when: Date): void {
	const preview = anchor.closest('.markdown-preview-view, .markdown-reading-view, .markdown-rendered');
	const root = preview instanceof HTMLElement ? preview : anchor.ownerDocument.body;
	if (!(root instanceof HTMLElement)) return;
	const pick = pickDayJump(when, collectDayJumps(root));
	if (!pick) return;
	const target = pick.kind === 'notes' ? visitNotesTarget(pick.el) : pick.el;
	revealJumpTarget(target, root);
	jumpToDayInRoot(root, when);
}

/** Scroll to the visit on this day and flash it. Recent Notes, Older Visits, or the Attempt Log. */
export function jumpToDayInRoot(root: HTMLElement, when: Date): boolean {
	const pick = pickDayJump(when, collectDayJumps(root));
	if (!pick) return false;
	const target = pick.kind === 'notes' ? visitNotesTarget(pick.el) : pick.el;
	revealJumpTarget(target, root);
	target.scrollIntoView({ block: 'center' });
	target.classList.add('rv-day-flash');
	window.setTimeout(() => target.classList.remove('rv-day-flash'), 1600);
	return true;
}

function collectDayJumps(root: HTMLElement): DayJumpTarget[] {
	const found: DayJumpTarget[] = [];
	root.querySelectorAll('h3, h5').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		if (node.classList.contains('rv-older-visits') || node.classList.contains('rv-visit-notes-heading')) return;
		const text = headingStampText(node);
		if (/^(?:visit|recent) notes:?$/i.test(text)) return;
		const when = stampDateTime(text);
		if (!when) return;
		found.push({ when, home: true, kind: 'notes', el: node });
	});
	for (const callout of attemptLogCallouts(root)) {
		callout.querySelectorAll('li').forEach((node) => {
			if (!(node instanceof HTMLElement)) return;
			const bullet = parseLogBullet(`- ${node.textContent ?? ''}`);
			if (!bullet) return;
			found.push({ when: bullet.when, home: bullet.home, kind: 'attempt', el: node });
		});
	}
	return found;
}

function headingStampText(node: HTMLElement): string {
	const copy = node.cloneNode(true);
	if (copy instanceof HTMLElement) {
		copy.querySelectorAll('.rv-stamp-ago, .rv-visit-more, .heading-collapse-indicator, .collapse-indicator').forEach((child) => child.remove());
		return visibleStampText(copy.textContent ?? '');
	}
	return visibleStampText(node.textContent ?? '');
}

function visitNotesTarget(stamp: HTMLElement): HTMLElement {
	const start = stamp.closest('.el-h3, .el-h5') ?? stamp;
	let look: Element | null = start.nextElementSibling;
	while (look) {
		if (look.querySelector('h3.rv-visit-stamp, h5.rv-visit-stamp, .rv-stamp-ago')) break;
		const area = look instanceof HTMLTextAreaElement ? look : look.querySelector('textarea');
		if (area instanceof HTMLElement) return area;
		look = look.nextElementSibling;
	}
	return stamp;
}

function revealJumpTarget(target: HTMLElement, root: HTMLElement): void {
	let node: HTMLElement | null = target;
	while (node && node !== root) {
		if (node.classList.contains('callout')) node.classList.remove('is-collapsed');
		if (node.style?.display === 'none') node.style.removeProperty('display');
		node = node.parentElement;
	}
	const notes = root.querySelector('h3.rv-visit-notes-heading');
	const host = notes?.parentElement;
	if (notes instanceof HTMLElement && host instanceof HTMLElement && host.classList.contains('is-collapsed') && !host.contains(target)) {
		let inRecent = false;
		let cursor = host.nextElementSibling;
		while (cursor instanceof HTMLElement) {
			if (cursor.classList.contains('rv-older-visits-wrap') || cursor.classList.contains('rv-notes-fold-stop')) break;
			if (cursor === target || cursor.contains(target)) inRecent = true;
			cursor = cursor.nextElementSibling;
		}
		if (inRecent) {
			host.classList.remove('is-collapsed');
			notes.classList.add('is-open');
			let again = host.nextElementSibling;
			while (again instanceof HTMLElement) {
				if (again.classList.contains('rv-older-visits-wrap') || again.classList.contains('rv-notes-fold-stop')) break;
				if (again.style?.display === 'none') again.style.removeProperty('display');
				again = again.nextElementSibling;
			}
		}
	}
	if (!target.classList.contains('rv-older-hidden') && !target.closest('.rv-older-hidden')) return;
	root.dataset.rvOlderOpen = '1';
	root.querySelectorAll('.rv-older-hidden').forEach((el) => {
		if (el instanceof HTMLElement) el.classList.remove('rv-older-hidden');
	});
	root.querySelectorAll('.rv-older-visits').forEach((el) => {
		if (el instanceof HTMLElement) el.classList.add('is-open');
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
		const hubLabel = labeledStrong(paragraph, 'hub');
		if (!hubLabel) continue;
		hubLabel.textContent = 'Hub:';
		paragraph.addClass('rv-hub-owned');
		const address = labeledStrong(paragraph, 'address');
		let line = paragraph.querySelector(':scope > .rv-hub-line');
		if (!(line instanceof HTMLElement)) {
			line = paragraph.createSpan('rv-hub-line');
			if (address?.parentElement === paragraph) paragraph.insertBefore(line, address);
		}
		if (hubLabel.parentElement !== line) line.insertBefore(hubLabel, line.firstChild);
		let row = line.querySelector(':scope > .rv-hub-row');
		if (!(row instanceof HTMLElement)) {
			const stray = paragraph.querySelector(':scope > .rv-hub-row');
			row = stray instanceof HTMLElement ? stray : line.createSpan('rv-hub-row');
			if (row.parentElement !== line) line.appendChild(row);
		}
		paragraph.querySelectorAll('.rv-hub-add, a.rv-map-button').forEach((node) => node.remove());
		row.empty();
		paintLabelIcon(hubLabel, 'layout-grid', 'Hub:');
		const hubs = hubRefs(readProperty(data, 'Hub'));
		const returnHub = host.settings.returnHubNote;
		hubs.forEach((hub, index) => {
			row.appendChild(hubChip(paragraph.ownerDocument, path, resolveReturnHub(hub, returnHub), index, host));
		});
		armHubOverflow(row);
		decorateAddress(paragraph, path, data, host);
	}
}

function ensureAddressInput(paragraph: HTMLElement): HTMLInputElement {
	const found = paragraph.querySelector(':scope > input.rv-address-input');
	if (found instanceof HTMLInputElement) return found;
	const created = paragraph.ownerDocument.createElement('input');
	created.className = 'rv-address-input';
	created.type = 'text';
	created.setAttribute('aria-label', 'Address');
	const map = paragraph.querySelector(':scope > a.rv-map-button');
	if (map) paragraph.insertBefore(created, map);
	else paragraph.appendChild(created);
	return created;
}

function decorateAddress(paragraph: HTMLElement, path: string, data: Record<string, unknown>, host: NoteChromeHost): void {
	const address = labeledStrong(paragraph, 'address');
	if (!address) return;
	paintLabelIcon(address, 'earth', 'Address:');
	const property = host.settings.addressProperty.trim() || 'Address';
	const input = ensureAddressInput(paragraph);
	for (const child of Array.from(paragraph.childNodes)) {
		if (child === address || child === input) continue;
		if (!(child instanceof HTMLElement)) {
			if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim()) {
				const plain = paragraph.ownerDocument.createElement('span');
				plain.className = 'rv-address-hidden';
				plain.textContent = child.textContent ?? '';
				child.replaceWith(plain);
			}
			continue;
		}
		if (
			child.classList.contains('rv-hub-line')
			|| child.classList.contains('rv-address-link')
			|| child.tagName === 'STRONG'
		) {
			child.classList.remove('rv-address-hidden');
			continue;
		}
		if (child.classList.contains('rv-map-button')) {
			child.remove();
			continue;
		}
		child.classList.add('rv-address-hidden');
	}
	const stored = textOf(readProperty(data, property));
	const focused = paragraph.ownerDocument.activeElement === input;
	if (!focused) input.value = stored;
	const write = () => host.setAddress(path, input.value);
	input.onchange = write;
	input.onblur = () => {
		write();
		showAddressLink(paragraph, input, path, host);
	};
	input.classList.add('rv-address-input');
	showAddressLink(paragraph, input, path, host);
	if (address.dataset.rvAddressEdit !== '1') {
		address.dataset.rvAddressEdit = '1';
		address.addEventListener('click', () => {
			const link = paragraph.querySelector(':scope > a.rv-address-link');
			if (link instanceof HTMLElement) link.hidden = true;
			input.hidden = false;
			input.focus();
		});
	}
}

function paintLabelIcon(label: HTMLElement, icon: string, text: string): void {
	label.empty();
	const mark = label.createSpan('rv-label-icon');
	setIcon(mark, icon);
	label.createSpan({ cls: 'rv-label-text', text });
}

function showAddressLink(paragraph: HTMLElement, input: HTMLInputElement, path: string, host: NoteChromeHost): void {
	const found = paragraph.querySelector(':scope > a.rv-address-link');
	const link = found instanceof HTMLElement ? found : paragraph.ownerDocument.createElement('a');
	if (!(found instanceof HTMLElement)) {
		link.className = 'rv-address-link';
		link.setAttribute('href', '#');
		if (typeof input.insertAdjacentElement === 'function') input.insertAdjacentElement('afterend', link);
		else paragraph.appendChild(link);
		link.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			host.openMap(path);
		});
	}
	link.classList.remove('rv-address-hidden');
	const text = input.value.trim();
	link.textContent = text || 'Add an address';
	link.classList.toggle('is-empty', !text);
	const editing = paragraph.ownerDocument.activeElement === input;
	link.hidden = editing || text.length === 0;
	input.hidden = !editing && text.length > 0;
}

function labeledStrong(paragraph: HTMLElement, kind: 'hub' | 'address'): HTMLElement | null {
	const nodes = paragraph.querySelectorAll('strong');
	for (const node of Array.from(nodes)) {
		if (!(node instanceof HTMLElement)) continue;
		const label = (node.textContent ?? '').replace(/:$/, '').trim().toLowerCase();
		if (kind === 'hub' ? label === 'hub' || label === 'hubs' : label === 'address') return node;
	}
	return null;
}

function fitHubOverflow(row: HTMLElement): void {
	row.querySelectorAll('.rv-hub-chip').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		const label = node.querySelector('.rv-hub-chip-label');
		if (!(label instanceof HTMLElement)) return;
		node.classList.toggle('is-overflow', label.scrollWidth - label.clientWidth > 1);
	});
}

function armHubOverflow(row: Element): void {
	if (!(row instanceof HTMLElement)) return;
	fitHubOverflow(row);
	if (row.dataset.rvHubOverflow === '1') return;
	row.dataset.rvHubOverflow = '1';
	const again = (): void => fitHubOverflow(row);
	globalThis.setTimeout(again, 0);
	if (typeof ResizeObserver === 'undefined') return;
	try {
		const observer = new ResizeObserver(again);
		observer.observe(row);
	} catch {
		/* The row is not a browser node. */
	}
}

function hubChip(doc: Document, path: string, hub: HubRef, index: number, host: NoteChromeHost): HTMLAnchorElement {
	const link = doc.createElement('a');
	link.className = 'internal-link rv-hub-chip';
	const label = doc.createElement('span');
	label.className = 'rv-hub-chip-label';
	label.textContent = hub.label;
	link.appendChild(label);
	const ellipsis = doc.createElement('span');
	ellipsis.className = 'rv-hub-chip-ellipsis';
	ellipsis.textContent = '…';
	ellipsis.setAttribute('aria-hidden', 'true');
	link.appendChild(ellipsis);
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
		menu.addItem((item) => {
			item.setTitle('Add a Hub');
			item.setIcon('plus');
			item.onClick(() => host.addHub(path));
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
	if (Array.isArray(value)) return value.map((item) => textOf(item)).filter(Boolean).join(' · ');
	return '';
}

function finiteNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
	return null;
}
