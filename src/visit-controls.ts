import { addIcon, displayTooltip, getIcon, setIcon } from 'obsidian';
import { attemptLogCallouts } from './attempt-digest';
import { domInstanceOf } from './dom';
import { attemptLogDateParts } from './dates';
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
	if (host.querySelector(`:scope > .${MORE_CLASS}`)) return;
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
		if (domInstanceOf(node, HTMLElement) && node.querySelector('.rv-stamp-ago')) found.push(node);
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
		markStampDate(heading);
		moreButton(heading, 'Visit options', (evt) => {
			open({ when, home: true, ordinal: 0, fileLine: sectionLine() }, evt);
		});
	}
	for (const callout of attemptLogCallouts(root)) {
		const seen = new Map<string, number>();
		callout.querySelectorAll('.callout-content li').forEach((item) => {
			if (!domInstanceOf(item, HTMLElement)) return;
			const bullet = parseLogBullet(`- ${textWithout(item, `.${MORE_CLASS}`)}`);
			if (!bullet) return;
			const key = `${bullet.when.getTime()}|${bullet.home ? 'home' : 'miss'}`;
			const ordinal = seen.get(key) ?? 0;
			seen.set(key, ordinal + 1);
			item.addClass('rv-visit-line');
			wrapLogStamp(item);
			moreButton(item, 'Visit options', (evt) => {
				open({ when: bullet.when, home: bullet.home, ordinal, fileLine: null }, evt);
			});
		});
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
