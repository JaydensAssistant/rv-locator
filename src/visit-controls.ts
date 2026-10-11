import { addIcon, displayTooltip, getIcon, setIcon } from 'obsidian';
import { attemptLogCallouts } from './attempt-digest';
import { domInstanceOf } from './dom';
import { attemptLogDateParts, calendarDaysSince, formatGlanceableCounter } from './dates';
import { mountFittedTitle, watchTitleRow } from './title-fit';
import { parseLogBullet, stampDateTime } from './schedule';
import { mountHeadingChevron } from './visit-display';

/** A rendered stamp or Attempt Log line, resolved against the file on click. */
export interface VisitTarget {
	when: Date;
	home: boolean;
	/** Position among rendered visits with the same hour and outcome. */
	ordinal: number;
	/** File line of a rendered `#####` stamp, when Obsidian reports it. */
	fileLine: number | null;
}

export type VisitMenuOpener = (target: VisitTarget, evt: MouseEvent) => void;

const MORE_CLASS = 'rv-visit-more';
const MAP_CLASS = 'rv-map-button';
const LOG_STAMP_CLASS = 'rv-log-stamp';
const LOG_DATE_CLASS = 'rv-log-date';
const NOTES_HEADING_CLASS = 'rv-visit-notes-heading';
const MAP_GLYPH = /^\s*🗺️?\s*$/u;

function textWithout(el: HTMLElement, selectors: string): string {
	const copy = el.cloneNode(true);
	if (!domInstanceOf(copy, HTMLElement)) return el.textContent ?? '';
	copy.querySelectorAll(selectors).forEach((node) => node.remove());
	return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function moreButton(host: HTMLElement, label: string, onClick: (evt: MouseEvent) => void): void {
	if (host.querySelector(`.${MORE_CLASS}`)) return;
	const button = host.createEl('button', {
		cls: `${MORE_CLASS} clickable-icon`,
		attr: { type: 'button', 'aria-label': label },
	});
	setIcon(button, 'more-horizontal');
	button.addEventListener('click', (evt) => {
		evt.preventDefault();
		evt.stopPropagation();
		onClick(evt);
	});
}

function stampHeadings(root: HTMLElement): HTMLElement[] {
	const found: HTMLElement[] = [];
	const consider = (node: Element) => {
		if (!domInstanceOf(node, HTMLElement) || found.includes(node)) return;
		if (node.querySelector('.rv-stamp-ago, .rv-stamp-row')) {
			found.push(node);
			return;
		}
		const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (stampDateTime(text)) found.push(node);
	};
	if (root.matches('h3, h5')) consider(root);
	root.querySelectorAll('h3, h5').forEach(consider);
	return found;
}

/**
 * Only the calendar date (`Sep 15, 2026`) is small. The weekday, the exact
 * time, and the em dash stay at the body size.
 */
function wrapLogStamp(item: HTMLElement): void {
	if (item.querySelector(`:scope > .${LOG_DATE_CLASS}`)) return;
	const first = Array.from(item.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '');
	if (!first) return;
	const text = first.textContent ?? '';
	const parts = attemptLogDateParts(text);
	if (!parts) return;
	const lead = item.ownerDocument.createTextNode(parts.lead);
	const date = item.ownerDocument.createElement('span');
	date.className = LOG_DATE_CLASS;
	date.textContent = parts.date;
	const tail = item.ownerDocument.createTextNode(parts.tail);
	item.insertBefore(lead, first);
	item.insertBefore(date, first);
	item.insertBefore(tail, first);
	first.textContent = '';
}

function directIndicator(heading: HTMLElement): HTMLElement | null {
	for (const kid of Array.from(heading.children)) {
		if (domInstanceOf(kid, HTMLElement) && kid.classList.contains('collapse-indicator')) return kid;
	}
	return null;
}

function tagVisitNotesHeading(root: HTMLElement): void {
	const headings = root.matches('h3') ? [root] : Array.from(root.querySelectorAll('h3'));
	for (const heading of headings) {
		if (!domInstanceOf(heading, HTMLElement)) continue;
		const title = textWithout(heading, '.heading-collapse-indicator');
		if (title === 'Visit Notes:' || title === 'Recent Notes:') {
			heading.addClass(NOTES_HEADING_CLASS);
			let mark = directIndicator(heading);
			if (!mark) {
				mark = heading.createSpan({ cls: 'collapse-indicator collapse-icon' });
				heading.insertBefore(mark, heading.firstChild);
			}
			mountHeadingChevron(mark);
			const parentCollapsed = heading.parentElement?.hasClass('is-collapsed') === true;
			heading.toggleClass('is-open', !heading.hasClass('is-collapsed') && !parentCollapsed);
		}
	}
}

/**
 * An ellipsis on every rendered visit stamp and every Attempt Log line.
 * `fileLine` is read when tapped, so a section re-render is not stale.
 */
export function decorateVisitControls(root: HTMLElement, sectionLine: () => number | null, open: VisitMenuOpener): void {
	tagVisitNotesHeading(root);
	for (const heading of stampHeadings(root)) {
		const when = stampDateTime(textWithout(heading, `.rv-stamp-ago, .rv-visit-extra, .${MORE_CLASS}, .heading-collapse-indicator`));
		if (!when) continue;
		heading.addClass('rv-visit-stamp');
		moreButton(heading, 'Visit options', (evt) => {
			open({ when, home: true, ordinal: 0, fileLine: sectionLine() }, evt);
		});
		reshapeVisitHeading(heading, when, coveredName(root, when));
		wireStampJump(heading, when);
	}
	for (const callout of attemptLogCallouts(root)) {
		const seen = new Map<string, number>();
		callout.querySelectorAll('.callout-content li').forEach((item) => {
			if (!domInstanceOf(item, HTMLElement)) return;
			const bullet = parseLogBullet(`- ${textWithout(item, `.${MORE_CLASS}, .rv-log-covered`)}`);
			if (!bullet) return;
			const key = `${bullet.when.getTime()}|${bullet.home ? 'home' : 'miss'}`;
			const ordinal = seen.get(key) ?? 0;
			seen.set(key, ordinal + 1);
			item.addClass('rv-visit-line');
			item.dataset.rvWhen = String(bullet.when.getTime());
			if (bullet.covered) item.dataset.rvCovered = bullet.covered;
			wrapLogStamp(item);
			renderCoveredMention(item, bullet.covered || item.dataset.rvCovered || '');
			moreButton(item, 'Visit options', (evt) => {
				open({ when: bullet.when, home: bullet.home, ordinal, fileLine: null }, evt);
			});
		});
	}
	backfillCoveredChips(root);
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `Mon, 10:40am`. The weekday and clock come from the stored stamp, with a comma. */
function stampWhenLabel(source: string, when: Date): string {
	const lead = source.split(/[—–]/)[0]?.trim() ?? '';
	const clock = /((?:\d{1,2}:\d{2}|\d{1,2})\s*[ap]m)/i.exec(lead)?.[1]?.replace(/\s+/g, '') ?? '';
	const written = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/i.exec(lead)?.[1] ?? '';
	const dow = written
		? written.charAt(0).toUpperCase() + written.slice(1, 3).toLowerCase()
		: (WEEKDAYS[when.getDay()] ?? '');
	if (dow && clock) return `${dow}, ${clock}`;
	return lead || dow;
}

/** Heading sections and the Log are often separate post-processor roots. */
function coveredSearchRoot(root: HTMLElement): HTMLElement {
	const wide = root.closest('.markdown-preview-view, .markdown-reading-view, .markdown-source-view, .cm-editor, .workspace-leaf-content');
	return wide instanceof HTMLElement ? wide : root;
}

function coveredName(root: HTMLElement, when: Date): string {
	const target = when.getTime();
	const surface = coveredSearchRoot(root);
	for (const callout of attemptLogCallouts(surface)) {
		for (const item of Array.from(callout.querySelectorAll('li'))) {
			if (!domInstanceOf(item, HTMLElement)) continue;
			const stamped = Number(item.dataset.rvWhen);
			const stored = item.dataset.rvCovered?.trim() ?? '';
			if (stamped === target && stored) return stored;
			const bullet = parseLogBullet(`- ${textWithout(item, `.${MORE_CLASS}, .rv-log-covered`)}`);
			if (!bullet || bullet.when.getTime() !== target) continue;
			if (bullet.covered) return bullet.covered;
			if (stored) return stored;
		}
	}
	return '';
}

/** The Log pass can land after the heading pass. Paint the chip once the token is known. */
function backfillCoveredChips(root: HTMLElement): void {
	const surface = coveredSearchRoot(root);
	for (const heading of stampHeadings(surface)) {
		const when = stampDateTime(headingSource(heading));
		if (!when) continue;
		const covered = coveredName(surface, when);
		if (!covered) continue;
		paintItemStrip(heading, headingSource(heading), covered);
	}
}

function headingSource(heading: HTMLElement): string {
	const hidden = heading.querySelector(':scope > .rv-stamp-source');
	const stored = hidden?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
	if (stored) return stored;
	return textWithout(heading, `.rv-stamp-ago, .rv-visit-extra, .${MORE_CLASS}, .heading-collapse-indicator, .rv-stamp-row, .collapse-indicator, .rv-stamp-source`);
}

/** Heading row and item strip. The markdown line is only restructured on screen. */
function reshapeVisitHeading(heading: HTMLElement, when: Date, covered: string): void {
	const source = headingSource(heading);
	const lead = stampWhenLabel(source, when);
	const month = MONTHS[when.getMonth()] ?? '';
	const day = String(when.getDate());
	const iso = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
	const count = formatGlanceableCounter(calendarDaysSince(iso) ?? 0);
	const fullDate = when.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
	const doc = heading.ownerDocument;
	let row = heading.querySelector(':scope > .rv-stamp-row');
	if (!(row instanceof HTMLElement)) {
		row = heading.createSpan('rv-stamp-row');
		const tile = row.createSpan('rv-cal');
		tile.createSpan({ cls: 'rv-cal-month', text: month });
		tile.createSpan({ cls: 'rv-cal-day', text: day });
		row.createSpan({ cls: 'rv-stamp-when', text: lead });
		const pill = row.createSpan({ cls: 'rv-stamp-ago rv-stamp-count', text: count });
		pill.dataset.rvJump = '1';
	}
	let hidden = heading.querySelector(':scope > .rv-stamp-source');
	if (!(hidden instanceof HTMLElement)) {
		hidden = doc.createElement('span');
		hidden.className = 'rv-stamp-source';
		heading.appendChild(hidden);
	}
	hidden.textContent = source;
	for (const node of Array.from(heading.childNodes)) {
		if (node === row || node === hidden) continue;
		if (domInstanceOf(node, HTMLElement) && (
			node.classList.contains('collapse-indicator')
			|| node.classList.contains('heading-collapse-indicator')
			|| node.classList.contains(MORE_CLASS)
		)) continue;
		node.remove();
	}
	const tile = row.querySelector('.rv-cal');
	if (tile instanceof HTMLElement) {
		tile.setAttribute('title', fullDate);
		tile.setAttribute('aria-label', fullDate);
		const monthEl = tile.querySelector('.rv-cal-month');
		const dayEl = tile.querySelector('.rv-cal-day');
		if (monthEl) monthEl.textContent = month;
		if (dayEl) dayEl.textContent = day;
	}
	const whenEl = row.querySelector('.rv-stamp-when');
	if (whenEl) whenEl.textContent = lead;
	const pill = row.querySelector('.rv-stamp-count');
	if (pill instanceof HTMLElement) pill.textContent = count;
	const more = heading.querySelector(`.${MORE_CLASS}`);
	if (more && more.parentElement !== row) row.appendChild(more);
	paintItemStrip(heading, source, covered);
}

function paintItemStrip(heading: HTMLElement, source: string, covered: string): void {
	const doc = heading.ownerDocument;
	let strip = findItemStrip(heading);
	if (!strip) {
		strip = doc.createElement('div');
		strip.className = 'rv-item-strip';
		heading.insertAdjacentElement('afterend', strip);
	}
	strip.replaceChildren();
	const items: Array<{ icon: string; title: string; kind: 'literature' | 'media' | 'lesson' | 'plain'; campaign?: boolean }> = [];
	if (covered) items.push({ icon: 'book-check', title: covered, kind: 'plain', campaign: true });
	const piece = /·\s+(?:«(book|film|lesson)»|(Left|Shared|Covered|Also))\s+«([^»]*)»/g;
	let match = piece.exec(source);
	while (match) {
		const kind = match[1] || match[2] || '';
		const title = match[3] ?? '';
		if (title && kind !== 'Covered') {
			items.push({
				icon: kind === 'film' || kind === 'Shared' ? 'clapperboard' : kind === 'lesson' || kind === 'Also' ? 'book-marked' : 'book-open',
				title,
				kind: kind === 'film' || kind === 'Shared' ? 'media' : kind === 'lesson' || kind === 'Also' ? 'lesson' : 'literature',
			});
		}
		match = piece.exec(source);
	}
	if (items.length === 0) strip.classList.add('is-ghost');
	else strip.classList.remove('is-ghost');
	for (const item of items) {
		const chip = doc.createElement('span');
		chip.className = 'rv-item';
		const icon = doc.createElement('span');
		icon.className = 'rv-item-icon';
		setIcon(icon, item.icon);
		chip.appendChild(icon);
		if (item.campaign) chip.classList.add('is-campaign');
		strip.appendChild(chip);
		mountFittedTitle(chip, item.title, item.kind);
	}
	ensureNoteBox(heading, strip);
	watchTitleRow(strip);
}

/** Reading view wraps the heading in `.el-h5`. Live Preview keeps it in a `.cm-line`. */
function blockHost(heading: HTMLElement): HTMLElement {
	const wrapped = heading.closest('.el-h1, .el-h2, .el-h3, .el-h4, .el-h5, .el-h6');
	if (wrapped instanceof HTMLElement) return wrapped;
	const line = heading.closest('.cm-line');
	if (line instanceof HTMLElement && line !== heading) return line;
	return heading;
}

function findItemStrip(heading: HTMLElement): HTMLElement | null {
	const hosts = [heading, blockHost(heading)];
	for (const host of hosts) {
		const next = host.nextElementSibling;
		if (!(next instanceof HTMLElement)) continue;
		if (next.classList.contains('rv-item-strip')) return next;
		if (!next.classList.contains('rv-visit-note-box')) continue;
		const strip = next.querySelector(':scope > .rv-item-strip');
		if (strip instanceof HTMLElement) return strip;
	}
	const nested = heading.parentElement?.querySelector(':scope > .rv-visit-note-box > .rv-item-strip, :scope > .rv-item-strip');
	return nested instanceof HTMLElement ? nested : null;
}

/** The strip sits at the top of the tinted note box. The note text is inside that same box. */
function ensureNoteBox(heading: HTMLElement, strip: HTMLElement): void {
	let box = strip.parentElement;
	if (!(box instanceof HTMLElement) || !box.classList.contains('rv-visit-note-box')) {
		const created = heading.ownerDocument.createElement('div');
		created.className = 'rv-visit-note-box';
		strip.replaceWith(created);
		created.appendChild(strip);
		box = created;
	}
	const host = blockHost(heading);
	if (box.parentElement !== host.parentElement || box.previousElementSibling !== host) {
		host.insertAdjacentElement('afterend', box);
	}
	let next = box.nextElementSibling;
	while (next instanceof HTMLElement && isVisitNoteBlock(next)) {
		const following = next.nextElementSibling;
		box.appendChild(next);
		next = following;
	}
}

function isVisitNoteBlock(node: HTMLElement): boolean {
	if (node.matches('h1, h2, h3, h4, h5, h6, .callout, hr, .rv-item-strip, .rv-visit-note-box, .rv-older-visits-wrap, .rv-notes-fold-stop')) return false;
	if (node.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > .callout, .rv-visit-stamp, .rv-stamp-row')) return false;
	if (node.classList.contains('cm-line')) {
		const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (!text) return false;
		if (stampDateTime(text)) return false;
		return true;
	}
	if (node.querySelector('textarea')) return true;
	return node.matches('p, div, .el-p, blockquote, textarea');
}

function renderCoveredMention(item: HTMLElement, covered: string): void {
	if (covered) item.dataset.rvCovered = covered;
	const existing = item.querySelector(':scope > .rv-log-covered');
	if (!covered || existing) return;
	const doc = item.ownerDocument;
	if (typeof doc.createTreeWalker !== 'function' || typeof NodeFilter === 'undefined') return;
	const walker = doc.createTreeWalker(item, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();
	while (node) {
		const text = node.textContent ?? '';
		const at = text.search(/—\s+covered\s+/i);
		if (at >= 0 && node.parentElement) {
			node.textContent = `${text.slice(0, at).trimEnd()} — `;
			const mention = doc.createElement('span');
			mention.className = 'rv-log-covered';
			const icon = doc.createElement('span');
			icon.className = 'rv-log-covered-icon';
			setIcon(icon, 'book-check');
			mention.append(icon, doc.createTextNode(` ${covered}`));
			node.parentElement.insertBefore(mention, node.nextSibling);
			return;
		}
		node = walker.nextNode();
	}
}

/** The calendar date on a visit heading stays the small muted style. Literature stays full size. */
function markStampDate(heading: HTMLElement): void {
	if (heading.querySelector('.rv-stamp-date')) return;
	const doc = heading.ownerDocument;
	if (typeof doc.createTreeWalker !== 'function' || typeof NodeFilter === 'undefined') return;
	const walker = doc.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();
	while (node) {
		const text = node.textContent ?? '';
		const match = /([—–-]\s+)([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/.exec(text);
		const parent = node.parentElement;
		if (match && match.index != null && parent) {
			const start = match.index + (match[1]?.length ?? 0);
			const date = match[2] ?? '';
			const after = text.slice(start + date.length);
			node.textContent = text.slice(0, start);
			const span = doc.createElement('span');
			span.className = 'rv-stamp-date';
			span.textContent = date;
			parent.insertBefore(span, node.nextSibling);
			if (after) parent.insertBefore(doc.createTextNode(after), span.nextSibling);
			return;
		}
		node = walker.nextNode();
	}
}

/** Date and day-count jump to that day's attempt-log line, not the visit notes. */
function wireStampJump(heading: HTMLElement, when: Date): void {
	heading.querySelectorAll('.rv-stamp-date, .rv-stamp-ago').forEach((node) => {
		if (!domInstanceOf(node, HTMLElement) || node.dataset.rvJump === '1') return;
		node.dataset.rvJump = '1';
		node.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			jumpStampToAttempt(heading, when);
		});
	});
}

function jumpStampToAttempt(heading: HTMLElement, when: Date): void {
	const host = heading.closest('.markdown-preview-view, .markdown-reading-view, .markdown-rendered');
	const root = domInstanceOf(host, HTMLElement) ? host : heading.ownerDocument.body;
	if (!domInstanceOf(root, HTMLElement)) return;
	let match: HTMLElement | null = null;
	for (const callout of attemptLogCallouts(root)) {
		for (const item of Array.from(callout.querySelectorAll('li'))) {
			if (match || !domInstanceOf(item, HTMLElement)) continue;
			const bullet = parseLogBullet(`- ${item.textContent ?? ''}`);
			if (!bullet || !sameLocalDay(bullet.when, when)) continue;
			match = item;
		}
	}
	if (!match) return;
	let node: HTMLElement | null = match;
	while (node && node !== root) {
		node.classList.remove('is-collapsed');
		if (node.style.display === 'none') node.style.removeProperty('display');
		node = node.parentElement;
	}
	match.scrollIntoView({ block: 'center' });
	match.classList.add('rv-day-flash');
	const flashed = match;
	window.setTimeout(() => flashed.classList.remove('rv-day-flash'), 1600);
}

function sameLocalDay(left: Date, right: Date): boolean {
	return left.getFullYear() === right.getFullYear()
		&& left.getMonth() === right.getMonth()
		&& left.getDate() === right.getDate();
}

/** Plugin-owned spans around a plain-text share tail. The note file is not rewritten. */
function wrapShareTail(heading: HTMLElement): void {
	if (heading.querySelector('.rv-visit-extra')) return;
	const doc = heading.ownerDocument;
	if (typeof doc.createTreeWalker !== 'function' || typeof NodeFilter === 'undefined') return;
	const walker = doc.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();
	while (node) {
		const text = node.textContent ?? '';
		const at = text.indexOf('·');
		if (at < 0 || !/·\s+(?:«(?:book|film|lesson)»|Left|Shared|Covered|Also)\s+«/.test(text)) {
			node = walker.nextNode();
			continue;
		}
		const parent = node.parentElement;
		if (!parent) return;
		const lead = text.slice(0, at).trimEnd();
		const tail = text.slice(at);
		node.textContent = '';
		if (lead) {
			const leadEl = doc.createElement('span');
			leadEl.className = 'rv-stamp-lead';
			leadEl.textContent = lead;
			parent.insertBefore(leadEl, node.nextSibling);
		}
		const piece = /·\s+(?:«(book|film|lesson)»|(Left|Shared|Covered|Also))\s+«([^»]*)»(?:\s+«[^»]*»–«[^»]*»)?/g;
		let match = piece.exec(tail);
		let cursor = 0;
		let after: Node = node;
		while (match) {
			const span = doc.createElement('span');
			span.className = 'rv-visit-extra';
			const icon = doc.createElement('span');
			icon.className = 'rv-stamp-kind';
			setIcon(icon, stampKindIcon(match[1] || match[2] || ''));
			const title = doc.createElement('span');
			title.className = 'rv-stamp-title';
			title.textContent = match[3] ?? '';
			span.append(icon, title);
			const anchor = after.nextSibling;
			parent.insertBefore(span, anchor);
			after = span;
			cursor = match.index + match[0].length;
			match = piece.exec(tail);
		}
		const rest = tail.slice(cursor);
		if (rest) parent.insertBefore(doc.createTextNode(rest), after.nextSibling);
		return;
	}
}

function stampKindIcon(kind: string): string {
	if (kind === 'book' || kind === 'Left') return 'book';
	if (kind === 'film' || kind === 'Shared') return 'film';
	return 'book-open';
}

/** The 🗺️ link beside Address becomes an earth button the size of the Hub plus. */
export function decorateMapLink(root: HTMLElement, onOpen?: () => void): void {
	root.querySelectorAll('.callout[data-callout="quote"] a').forEach((link) => {
		if (!domInstanceOf(link, HTMLElement) || link.hasClass(MAP_CLASS)) return;
		if (!MAP_GLYPH.test(link.textContent ?? '')) return;
		const gap = link.previousSibling;
		if (gap && gap.nodeType === Node.TEXT_NODE && !(gap.textContent ?? '').trim()) gap.remove();
		link.empty();
		link.addClass(MAP_CLASS);
		link.setAttribute('aria-label', 'Map');
		setIcon(link, 'earth');
		if (onOpen) {
			link.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				onOpen();
			});
		}
	});
}

/** Archive shows Unarchive once the note is inactive. The command does the switch. */
export function decorateArchiveButton(root: HTMLElement, inactive: boolean): void {
	root.querySelectorAll('.mb-button.rv-visit-btn button').forEach((node) => {
		if (!domInstanceOf(node, HTMLElement)) return;
		const label = node.getAttribute('aria-label') ?? '';
		if (label !== 'Archive' && label !== 'Unarchive') return;
		const next = inactive ? 'Unarchive' : 'Archive';
		if (label !== next) {
			node.setAttribute('aria-label', next);
			node.empty();
			setIcon(node, inactive ? 'archive-restore' : 'archive');
		}
	});
}

const VISIT_BUTTON = '.mb-button.rv-visit-btn button';
const LONG_PRESS_MS = 450;
const LONG_PRESS_CLICK_GRACE_MS = 900;

function visitButtonAt(target: EventTarget | null): HTMLElement | null {
	if (!domInstanceOf(target, Element)) return null;
	const button = target.closest(VISIT_BUTTON);
	return domInstanceOf(button, HTMLElement) ? button : null;
}

/**
 * Icon-only visit buttons show their name on desktop hover. Holding one on
 * a touch screen shows the name and does not press it. Meta Bind puts the
 * tooltip in aria-label, which Obsidian does not show on its own.
 */
export class VisitButtonLongPress {
	private timer: number | null = null;
	private swallowUntil = 0;
	private hovered: HTMLElement | null = null;

	hover(evt: MouseEvent): void {
		const button = visitButtonAt(evt.target);
		if (button === this.hovered) return;
		this.hovered = button;
		const label = button?.getAttribute('aria-label')?.trim();
		if (button && label) displayTooltip(button, label, { placement: 'top' });
	}

	start(evt: TouchEvent): void {
		this.cancel();
		const button = visitButtonAt(evt.target);
		const label = button?.getAttribute('aria-label')?.trim();
		if (!button || !label) return;
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.swallowUntil = Date.now() + LONG_PRESS_CLICK_GRACE_MS;
			displayTooltip(button, label, { placement: 'top' });
		}, LONG_PRESS_MS);
	}

	cancel(): void {
		if (this.timer != null) window.clearTimeout(this.timer);
		this.timer = null;
	}

	/** Capture-phase click and contextmenu handler. */
	swallow(evt: Event): void {
		if (Date.now() > this.swallowUntil || !visitButtonAt(evt.target)) return;
		evt.preventDefault();
		evt.stopPropagation();
		if (evt.type === 'click') this.swallowUntil = 0;
	}
}

/**
 * Log past visit uses Lucide `rotate-ccw-clock`. An Obsidian build whose
 * Lucide set predates it gets that id drawn from `history`, the same arrow
 * around a clock. `addIcon` takes a 100 × 100 view box, so the 24 × 24
 * Lucide paths are scaled up.
 */
export function ensureIconAlias(id: string, fallback: string): void {
	if (getIcon(id)) return;
	const base = getIcon(fallback);
	if (!base) return;
	const paths = Array.from(base.children).map((child) => child.outerHTML).join('');
	addIcon(id, `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`);
}
