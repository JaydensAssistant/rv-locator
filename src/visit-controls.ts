import { setIcon } from 'obsidian';
import { attemptLogCallouts } from './attempt-digest';
import { domInstanceOf } from './dom';
import { parseLogBullet, stampDateTime } from './schedule';

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
 * An ellipsis on every rendered visit stamp and every Attempt Log line.
 * `fileLine` is read when tapped, so a section re-render is not stale.
 */
export function decorateVisitControls(root: HTMLElement, sectionLine: () => number | null, open: VisitMenuOpener): void {
	for (const heading of stampHeadings(root)) {
		const when = stampDateTime(textWithout(heading, `.rv-stamp-ago, .${MORE_CLASS}, .heading-collapse-indicator`));
		if (!when) continue;
		heading.addClass('rv-visit-stamp');
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
			moreButton(item, 'Visit options', (evt) => {
				open({ when: bullet.when, home: bullet.home, ordinal, fileLine: null }, evt);
			});
		});
	}
}

/** The 🗺️ link beside Address becomes a map-pin button the size of the Hub plus. */
export function decorateMapLink(root: HTMLElement): void {
	root.querySelectorAll('.callout[data-callout="quote"] a').forEach((link) => {
		if (!domInstanceOf(link, HTMLElement) || link.hasClass(MAP_CLASS)) return;
		if (!MAP_GLYPH.test(link.textContent ?? '')) return;
		link.empty();
		link.addClass(MAP_CLASS);
		link.setAttribute('aria-label', 'Open map');
		setIcon(link, 'map-pin');
	});
}
