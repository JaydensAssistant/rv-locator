import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import {
	MEDIA_TITLES,
	PUBLICATION_TITLES,
	catalogBands,
	catalogSuggestions,
	emptyShare,
	publicationAliasIndex,
	rememberRecentCatalog,
	splitTitleSuffix,
	unwrapStrayQuotes,
} from '../src/catalog';
import { mountShareFields } from '../src/catalog-fields';
import { decorateNoteChrome, type NoteChromeHost } from '../src/note-chrome';
import { mountAlwaysChevron } from '../src/suggest-field';
import { mountClosedTitle } from '../src/title-fit';
import { DEFAULT_SETTINGS } from '../src/types';
import { fillItemStrip } from '../src/visit-controls';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const { window } = dom;
const hostGlobals = globalThis as typeof globalThis & Record<string, unknown>;
hostGlobals.window = window;
hostGlobals.document = window.document;
hostGlobals.HTMLElement = window.HTMLElement;
hostGlobals.Node = window.Node;
hostGlobals.KeyboardEvent = window.KeyboardEvent;
hostGlobals.MouseEvent = window.MouseEvent;
hostGlobals.HTMLInputElement = window.HTMLInputElement;
hostGlobals.HTMLAnchorElement = window.HTMLAnchorElement;
hostGlobals.Element = window.Element;
hostGlobals.getComputedStyle = window.getComputedStyle.bind(window);

const proto = window.HTMLElement.prototype as HTMLElement & Record<string, (...args: never[]) => unknown>;
proto.addClass = function addClass(this: HTMLElement, cls: string) {
	this.classList.add(...cls.split(/\s+/).filter(Boolean));
};
proto.empty = function empty(this: HTMLElement) {
	this.replaceChildren();
};
proto.setText = function setText(this: HTMLElement, text: string) {
	this.textContent = text;
};
proto.setAttr = function setAttr(this: HTMLElement, name: string, value: string) {
	this.setAttribute(name, value);
};
proto.createEl = function createEl(this: HTMLElement, tag: string, spec?: string | { cls?: string; text?: string; attr?: Record<string, string> }) {
	const el = this.ownerDocument.createElement(tag);
	if (typeof spec === 'string') el.className = spec;
	else if (spec) {
		if (spec.cls) el.className = spec.cls;
		if (spec.text) el.textContent = spec.text;
		if (spec.attr) {
			for (const [key, value] of Object.entries(spec.attr)) el.setAttribute(key, value);
		}
	}
	this.appendChild(el);
	return el;
};
proto.createSpan = function createSpan(this: HTMLElement, spec?: string | { cls?: string; text?: string; attr?: Record<string, string> }) {
	return this.createEl('span', typeof spec === 'string' ? { cls: spec } : spec);
};
proto.createDiv = function createDiv(this: HTMLElement, spec?: string | { cls?: string; text?: string }) {
	return this.createEl('div', typeof spec === 'string' ? { cls: spec } : spec);
};

const css = readFileSync('styles.css', 'utf8');

function chromeHost(frontmatter: Record<string, unknown>, opened: { path: string }): NoteChromeHost {
	return {
		frontmatter: () => frontmatter,
		settings: { ...DEFAULT_SETTINGS, distanceTest: true },
		snoozeUntil: () => null,
		setStatus: () => {},
		setPriority: () => {},
		openUrgency: () => {},
		openPriority: () => {},
		openRoute: () => {},
		openHub: (_path, target) => { opened.path = target; },
		addHub: () => {},
		removeHub: () => {},
		moveHub: () => {},
		openSlotOverride: () => {},
		setAddress: () => {},
		openMap: () => {},
		openCompanion: () => {},
		campaignMark: () => null,
		noteTitle: () => 'Pat',
		renameNote: () => {},
		mapOpen: () => false,
		ghostIcon: () => null,
	};
}

describe('clear pack', () => {
	it('RV-192 RV-194 strips wrapping quotes, keeps inner quotes, and adds invite and card titles', () => {
		assert.equal(unwrapStrayQuotes('"Can We Enjoy Life Forever?" Tiny Tract'), 'Can We Enjoy Life Forever? Tiny Tract');
		assert.equal(
			unwrapStrayQuotes('"You Are Invited: 2026 “Eternal Happiness” Convention of Jehovah’s Witnesses"'),
			'You Are Invited: 2026 “Eternal Happiness” Convention of Jehovah’s Witnesses',
		);
		assert.equal(PUBLICATION_TITLES[0]?.startsWith('"'), false);
		assert.equal(PUBLICATION_TITLES.includes('Invitation to Congregation Meetings'), true);
		assert.equal(PUBLICATION_TITLES.includes('Invitation to the Memorial'), true);
		assert.equal(PUBLICATION_TITLES.includes('Invitation to the Convention'), true);
		assert.equal(PUBLICATION_TITLES.includes('Contact Card for JW.org'), true);
		assert.equal(splitTitleSuffix('Invitation to the Memorial').suffix, 'Invite');
		assert.equal(splitTitleSuffix('Contact Card for JW.org').suffix, 'Card');
		const invited = MEDIA_TITLES.find((title) => title.includes('Eternal Happiness'));
		assert.equal(invited?.includes('“Eternal Happiness”'), true);
		assert.equal(invited?.startsWith('"'), false);
		const quoted = catalogSuggestions(PUBLICATION_TITLES, [], '"Invitation to Congregation Meetings"', publicationAliasIndex());
		assert.equal(quoted[0], 'Invitation to Congregation Meetings');
		assert.equal(splitTitleSuffix('"Can We Enjoy Life Forever?" Tiny Tract').suffix, 'Tiny Tract');
	});

	it('RV-195 groups recent first, then type, with no start-typing hint', () => {
		rememberRecentCatalog('Listen to God Brochure');
		const bands = catalogBands([
			'Can We Enjoy Life Forever? Tiny Tract',
			'Listen to God Brochure',
			'Invitation to the Memorial',
			'Contact Card for JW.org',
		], ['Listen to God Brochure']);
		assert.deepEqual(bands.map((band) => band.label), ['RECENT', 'TINY TRACTS', 'BROCHURES', 'INVITES', 'CARDS']);
		assert.equal(bands[0]?.items[0], 'Listen to God Brochure');
		assert.equal(bands.find((band) => band.label === 'BROCHURES')?.items.includes('Listen to God Brochure'), true);
		const host = window.document.createElement('div');
		const input = window.document.createElement('input');
		host.appendChild(input);
		window.document.body.appendChild(host);
		mountAlwaysChevron(input, () => ['Can We Enjoy Life Forever? Tiny Tract', 'Listen to God Brochure'], () => {}, (value) => splitTitleSuffix(value), (rows) => catalogBands(rows, []));
		host.querySelector('button.rv-suggest-chevron')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.equal(host.querySelector('.rv-suggest-hint'), null);
		assert.equal(host.querySelector('.rv-suggest-band')?.textContent, 'TINY TRACTS');
		assert.equal(host.querySelectorAll('.rv-suggest-option').length, 2);
		assert.equal(host.querySelector('.rv-suggest-option .rv-title-suffix'), null);
		assert.match(css, /\.rv-suggest-band \{\s*display:\s*block;\s*width:\s*100%;/);
		const option = host.querySelector('.rv-suggest-option');
		assert.equal(option?.textContent?.includes('\n'), false);
		host.remove();
		assert.match(css, /\.rv-suggest-panel \{\s*position:\s*absolute;[\s\S]*?top:\s*100%;/);
		assert.match(css, /\.rv-locator-modal \.rv-suggest-host,\s*\.rv-suggest-host \{\s*column-gap:\s*0;/);
	});

	it('RV-B24 a row hide does not deliver the same tap to Cancel', () => {
		const host = window.document.createElement('div');
		const input = window.document.createElement('input');
		host.appendChild(input);
		const cancel = window.document.createElement('button');
		cancel.textContent = 'Cancel';
		let cancelled = 0;
		cancel.addEventListener('click', () => { cancelled += 1; });
		window.document.body.append(host, cancel);
		let picked = '';
		mountAlwaysChevron(input, () => ['Can We Enjoy Life Forever? Tiny Tract'], (value) => { picked = value; });
		host.querySelector('button.rv-suggest-chevron')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		const row = host.querySelector('.rv-suggest-option');
		assert.ok(row instanceof window.HTMLElement);
		row.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
		assert.equal(host.querySelector('.rv-suggest-panel')?.hasAttribute('hidden'), false);
		row.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
		cancel.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.equal(cancelled, 0);
		assert.match(picked, /Enjoy Life/);
		host.remove();
		cancel.remove();
	});

	it('RV-B24 RV-195 the list stops above the footer, keeps whole rows, and a footer tap still lands', () => {
		const sheet = window.document.createElement('div');
		sheet.className = 'modal';
		const content = window.document.createElement('div');
		content.className = 'modal-content';
		const host = window.document.createElement('div');
		const input = window.document.createElement('input');
		host.appendChild(input);
		const footer = window.document.createElement('div');
		footer.className = 'setting-item rv-modal-actions';
		const cancel = window.document.createElement('button');
		cancel.textContent = 'Cancel';
		let cancelled = 0;
		cancel.addEventListener('click', () => { cancelled += 1; });
		footer.appendChild(cancel);
		content.append(host, footer);
		sheet.appendChild(content);
		window.document.body.appendChild(sheet);
		const box = (top: number, height: number): DOMRect => ({
			top, bottom: top + height, left: 0, right: 562, width: 562, height, x: 0, y: top, toJSON() { return {}; },
		}) as DOMRect;
		host.getBoundingClientRect = () => box(80, 40);
		content.getBoundingClientRect = () => box(0, 1002);
		footer.getBoundingClientRect = () => box(400, 48);
		let picked = '';
		mountAlwaysChevron(input, () => [
			'Can We Enjoy Life Forever?',
			'Who Really Controls the World?',
			'What Is the Kingdom of God?',
			'How Do You View the Future?',
			'Will Suffering Ever End?',
			'Listen to God',
			'The Bible Gives Hope',
			'A Real Friend',
		], (value) => { picked = value; });
		const panel = host.querySelector('.rv-suggest-panel');
		assert.ok(panel instanceof window.HTMLElement);
		panel.getBoundingClientRect = () => box(120, Number.parseFloat(panel.style.maxHeight) || 0);
		const open = (): void => {
			host.querySelector('button.rv-suggest-chevron')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		};
		open();
		const room = Number.parseFloat(panel.style.maxHeight);
		assert.equal(room <= 400 - 120, true);
		assert.equal(room % 40, 0);
		const row = panel.querySelector('.rv-suggest-option');
		assert.ok(row instanceof window.HTMLElement);
		for (let tap = 0; tap < 6; tap += 1) {
			row.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
		}
		assert.match(picked, /Enjoy Life/);
		assert.equal(cancelled, 0);
		row.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
		open();
		cancel.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
		assert.equal(cancelled, 1);
		assert.equal(panel.hidden, true);
		sheet.remove();
		assert.match(css, /justify-content:\s*flex-start !important/);
		assert.match(css, /text-align:\s*start !important/);
		assert.match(css, /margin-top:\s*auto !important/);
	});

	it('RV-185 RV-186 the heading overlay matches the chip and the icon opens it', () => {
		const strip = window.document.createElement('div');
		strip.className = 'rv-item-strip';
		window.document.body.appendChild(strip);
		fillItemStrip(strip, '· «film» «Feature Bible Drama Preview: The Good News According to Jesus: Episodes 4, 5, and 6» · «book» «Listen to God Brochure»', '');
		const chips = Array.from(strip.querySelectorAll('.rv-item'));
		assert.equal(chips.length, 2);
		const icon = chips[0]?.querySelector('.rv-item-icon');
		assert.ok(icon instanceof window.HTMLElement);
		const stripBox = { left: 12, width: 350, top: 90, height: 24, right: 362, bottom: 114, x: 12, y: 90, toJSON() { return {}; } };
		strip.getBoundingClientRect = () => stripBox;
		icon.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		const card = window.document.querySelector('.rv-strip-overlay');
		assert.ok(card instanceof window.HTMLElement);
		assert.equal(card.classList.contains('is-multi'), true);
		assert.equal(card.style.fontSize, '11px');
		assert.equal(card.style.left, '12px');
		assert.equal(card.style.width, '350px');
		assert.ok(card.querySelector('.rv-strip-overlay-icon'));
		assert.match(card.textContent ?? '', /Feature Bible Drama Preview/);
		assert.match(card.textContent ?? '', /Video/);
		const other = chips[1];
		assert.ok(other instanceof window.HTMLElement);
		assert.equal(other.classList.contains('is-dropped'), true);
		assert.equal(other.classList.contains('is-squeezed'), false);
		icon.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.equal(window.document.querySelector('.rv-strip-overlay'), null);
		assert.equal(other.classList.contains('is-dropped'), false);
		icon.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		const again = window.document.querySelector('.rv-strip-overlay');
		assert.ok(again instanceof window.HTMLElement);
		assert.equal(again.style.left, '12px');
		assert.equal(again.style.width, '350px');
		assert.match(css, /\.rv-strip-overlay\.is-multi \{[^}]*font-size:\s*11px;/);
		assert.match(css, /\.rv-item-strip\.is-revealing\.is-multi > \.rv-item\.is-dropped \{\s*display:\s*none !important;/);
		strip.remove();
		again.remove();
	});

	it('RV-185 a Visit Facts title draws in an overlay the width of the chip', () => {
		const root = window.document.createElement('div');
		root.className = 'rv-dashboard';
		root.innerHTML = '<div class="callout" data-callout="rv"><div class="callout-title"><div class="callout-title-inner">Visit Facts</div></div><div class="callout-content"></div></div>';
		decorateNoteChrome(root, 'People/Pat.md', chromeHost({
			cssclasses: ['rv-dashboard'],
			Status: 'Active',
			Priority: 1,
			'Last Spoke': '2026-10-14T09:00:00',
			'Shared Media': ['Feature Bible Drama Preview: The Good News According to Jesus: Episodes 4, 5, and 6'],
			'Lessons Studied': ['02 The Bible Gives Hope'],
		}, { path: '' }));
		window.document.body.appendChild(root);
		const chip = root.querySelector('.rv-qf-chip');
		assert.ok(chip instanceof window.HTMLElement);
		const title = chip.querySelector('.rv-qf-chip-title');
		assert.ok(title instanceof window.HTMLElement);
		Object.defineProperty(title, 'clientWidth', { configurable: true, get: () => 80 });
		Object.defineProperty(title, 'scrollWidth', { configurable: true, get: () => 320 });
		chip.getBoundingClientRect = () => ({ left: 16, top: 200, right: 300, bottom: 224, width: 284, height: 24, x: 16, y: 200, toJSON() { return {}; } });
		const lessons = root.querySelector('.rv-qf-row .rv-qf-label');
		chip.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
		const card = window.document.querySelector('.rv-fact-overlay');
		assert.ok(card instanceof window.HTMLElement);
		assert.equal(card.style.left, '16px');
		assert.equal(card.style.width, '284px');
		assert.match(card.textContent ?? '', /Feature Bible Drama Preview/);
		assert.match(card.textContent ?? '', /Video/);
		assert.equal(chip.classList.contains('is-revealed'), true);
		assert.equal(window.getComputedStyle(chip).height, '');
		assert.equal(lessons?.isConnected, true);
		chip.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: true }));
		assert.equal(window.document.querySelector('.rv-fact-overlay'), null);
		root.remove();
		assert.doesNotMatch(css, /\.rv-qf-chip\.is-revealed \{[^}]*height:\s*auto/);
	});

	it('RV-B23 a hub chip tap opens the hub and the menu carries the full name', () => {
		const opened = { path: '' };
		const root = window.document.createElement('div');
		root.className = 'rv-dashboard';
		root.innerHTML = '<div class="callout" data-callout="quote"><div class="callout-content"><p><strong>Hub:</strong> old</p></div></div>';
		decorateNoteChrome(root, 'People/Pat.md', chromeHost({
			cssclasses: ['rv-dashboard'],
			Hub: 'Return Visits Hub With A Very Long Name',
		}, opened));
		const chip = root.querySelector('.rv-hub-chip');
		assert.ok(chip instanceof window.HTMLElement);
		const label = chip.querySelector('.rv-hub-chip-label');
		assert.ok(label instanceof window.HTMLElement);
		Object.defineProperty(label, 'clientWidth', { configurable: true, get: () => 40 });
		Object.defineProperty(label, 'scrollWidth', { configurable: true, get: () => 280 });
		chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.match(opened.path, /Return Visits Hub With A Very Long Name/);
		const chrome = readFileSync('src/note-chrome.ts', 'utf8');
		const hub = chrome.slice(chrome.indexOf('function hubChip'), chrome.indexOf('function decorateSlotOverride'));
		assert.match(hub, /item\.setTitle\(hub\.label\)/);
		assert.doesNotMatch(hub, /plainTitleTruncated/);
		assert.match(css, /\.rv-hub-chip,\s*\.rv-hub-chip > \.rv-hub-chip-label \{\s*white-space:\s*nowrap;/);
	});

	it('RV-201 through RV-207 keep the dark sheet palette off the light theme', () => {
		assert.match(css, /:is\(h3, h5\)\.rv-visit-stamp :is\(\.heading-collapse-indicator, \.collapse-indicator\)/);
		assert.match(css, /\.rv-suggest-host > button\.rv-suggest-chevron \{\s*border:\s*1px solid var\(--interactive-accent, #1f8a4c\)/);
		assert.match(css, /\.modal\.rv-locator-modal button\.rv-age-symbol \{\s*border:\s*1px solid var\(--interactive-accent, #1f8a4c\) !important;\s*border-radius:\s*0 6px 6px 0 !important;\s*box-shadow:\s*none !important;/);
		assert.match(css, /\.modal\.rv-locator-modal \{\s*width:\s*min\(640px, calc\(100vw - 16px\)\);\s*height:\s*calc\(100dvh - 16px\)/);
		assert.match(css, /\.theme-dark \.modal\.rv-locator-modal,\s*\.theme-dark \.rv-study-change-modal \{\s*background:\s*#1e1e1e;\s*border-color:\s*#2f2f2f;/);
		assert.match(css, /background:\s*#262626/);
		assert.match(css, /background:\s*#222222/);
		assert.match(css, /border-bottom:\s*1px solid #373737/);
		assert.match(css, /background:\s*#2a2a2a;\s*border-color:\s*#262626/);
		assert.match(css, /\.theme-dark \.rv-suggest-host > button\.rv-suggest-chevron,\s*\.theme-dark \.modal\.rv-locator-modal button\.rv-age-symbol \{\s*border-color:\s*var\(--rv-modal-accent, #1f8a4c\) !important;/);
		assert.match(css, /\.theme-dark \.modal\.rv-locator-modal \.modal-title \{\s*text-align:\s*left/);
		assert.match(css, /\.rv-locator-modal \.rv-modal-actions button,\s*\.rv-study-change-modal \.rv-modal-actions button \{\s*display:\s*inline-flex;/);
		assert.doesNotMatch(css, /\.modal\.rv-locator-modal \{\s*background:\s*#1e1e1e/);
		const wizard = readFileSync('src/setup-wizard.ts', 'utf8');
		assert.match(wizard, /listedUsCounties/);
		assert.match(wizard, /mountAlwaysChevron/);
		assert.doesNotMatch(wizard, /addTextArea/);
	});
});

const GOOD_NEWS = 'Feature Bible Drama Preview: The Good News According to Jesus: Episodes 4, 5, and 6';

describe('RV-B45 RV-B46 closed catalog field', () => {
	it('hides the closed overlay, including its stale text, while the field is open', () => {
		assert.match(css, /\.rv-closed-title\[hidden\] \{\s*display:\s*none !important;\s*\}/);
		const host = window.document.createElement('div');
		host.className = 'rv-suggest-host';
		const input = window.document.createElement('input');
		input.value = 'Why Study the Bible? Video';
		host.appendChild(input);
		window.document.body.appendChild(host);
		mountClosedTitle(input, () => ({ text: 'Why Study the Bible?', suffix: 'Video' }));
		const overlay = host.querySelector('.rv-closed-title');
		assert.ok(overlay instanceof window.HTMLElement);
		assert.equal(overlay.hidden, false);
		assert.match(overlay.textContent ?? '', /Video/);
		input.focus();
		assert.equal(overlay.hidden, true);
		assert.equal(overlay.childElementCount, 0);
		const style = window.document.createElement('style');
		style.textContent = css;
		window.document.head.appendChild(style);
		const shown = window.getComputedStyle(overlay).display;
		assert.equal(shown, 'none');
		input.blur();
		input.value = 'Why Study the Bible? Video';
		input.dispatchEvent(new window.Event('rv-closed-refresh'));
		assert.equal(overlay.hidden, false);
		assert.match(overlay.textContent ?? '', /Video/);
		style.remove();
		host.remove();
	});

	it('reopens a picked field as an empty search and will not save the summary', () => {
		const root = window.document.createElement('div');
		root.className = 'modal rv-locator-modal';
		window.document.body.appendChild(root);
		const seen: string[][] = [];
		mountShareFields(root, {
			publications: [...PUBLICATION_TITLES],
			media: [...MEDIA_TITLES],
			customLessons: [],
			lessons: [],
			showLiterature: true,
			showLesson: false,
			initial: {
				...emptyShare(),
				media: GOOD_NEWS,
				mediaList: [GOOD_NEWS],
				publications: 'Will Suffering Ever End?',
				publicationList: ['Will Suffering Ever End?'],
			},
		}, (next) => {
			seen.push([...(next.mediaList ?? [])]);
		});
		const inputs = [...root.querySelectorAll('input')];
		const media = inputs.find((input) => input.value.includes('Good News'));
		const literature = inputs.find((input) => input.value.includes('Suffering'));
		assert.ok(media instanceof window.HTMLInputElement);
		assert.ok(literature instanceof window.HTMLInputElement);
		const summary = media.value;
		media.focus();
		assert.equal(media.value, '');
		assert.equal(media.placeholder, 'Add another…');
		const overlay = media.parentElement?.querySelector('.rv-closed-title');
		assert.ok(overlay instanceof window.HTMLElement);
		assert.equal(overlay.hidden, true);
		assert.equal(overlay.childElementCount, 0);
		media.parentElement?.querySelector('button.rv-suggest-chevron')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		const panel = media.parentElement?.querySelector('.rv-suggest-panel');
		assert.ok(panel instanceof window.HTMLElement);
		assert.equal(panel.hidden, false);
		const checked = panel.querySelector('.rv-suggest-option.is-checked');
		assert.ok(checked instanceof window.HTMLElement);
		assert.equal(panel.querySelector('.rv-suggest-option'), checked);
		assert.match(checked.textContent ?? '', /Good News/);
		assert.match(checked.textContent ?? '', /Video/);
		media.value = 'Bib';
		media.dispatchEvent(new window.Event('input', { bubbles: true }));
		assert.equal(media.value, 'Bib');
		assert.equal(media.value.startsWith(summary), false);
		const bible = [...panel.querySelectorAll('.rv-suggest-option')].find((row) => row instanceof window.HTMLElement && /Why Study the Bible\?/.test(row.dataset.value ?? ''));
		assert.ok(bible instanceof window.HTMLElement);
		assert.match(bible.textContent ?? '', /Why Study the Bible\?/);
		assert.equal(bible.classList.contains('is-checked'), false);
		assert.equal(panel.querySelector('.rv-suggest-option')?.classList.contains('is-checked'), true);
		media.value = `${summary} extra`;
		media.dispatchEvent(new window.Event('input', { bubbles: true }));
		assert.equal(media.value, '');
		media.dispatchEvent(new window.Event('blur'));
		assert.equal(media.value, summary);
		assert.equal(seen.some((list) => list.some((item) => item.includes('extra'))), false);
		literature.focus();
		assert.equal(literature.value, '');
		assert.equal(literature.placeholder, 'Add another…');
		literature.dispatchEvent(new window.Event('blur'));
		assert.equal(literature.value.includes('Suffering'), true);
		root.remove();
	});
});

describe('RV-B47 RV-B48 RV-B49 visit strip expand', () => {
	it('lets a lone long title take the strip and keeps a short neighbor to one character', () => {
		assert.doesNotMatch(css, /\.rv-item-strip\.is-revealing:not\(\.is-multi\) > \.rv-item\.is-open \.rv-fit-stem \{\s*overflow:\s*visible;/);
		assert.match(css, /\.rv-item-strip\.is-revealing:not\(\.is-multi\) > \.rv-item\.is-open:not\(:only-child\)/);
		assert.match(css, /\.rv-strip-overlay-type \{\s*color:\s*var\(--text-faint\);/);
		const lone = window.document.createElement('div');
		lone.className = 'rv-item-strip';
		lone.style.paddingLeft = '8px';
		lone.style.paddingRight = '8px';
		Object.defineProperty(lone, 'clientWidth', { configurable: true, get: () => 200 });
		window.document.body.appendChild(lone);
		fillItemStrip(lone, `· «film» «${GOOD_NEWS}»`, '');
		const loneChip = lone.querySelector('.rv-item');
		assert.ok(loneChip instanceof window.HTMLElement);
		loneChip.querySelector('.rv-item-icon')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		const card = window.document.querySelector('.rv-strip-overlay.is-multi');
		assert.ok(card instanceof window.HTMLElement);
		assert.match(card.textContent ?? '', /Good News/);
		assert.match(card.textContent ?? '', /Video/);
		loneChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.equal(window.document.querySelector('.rv-strip-overlay'), null);
		lone.remove();

		const pair = window.document.createElement('div');
		pair.className = 'rv-item-strip';
		pair.style.paddingLeft = '20px';
		pair.style.paddingRight = '20px';
		pair.style.borderTop = '1px solid rgba(218, 218, 218, 0.14)';
		pair.style.borderRight = '1px solid rgba(218, 218, 218, 0.14)';
		pair.style.borderBottom = '1px solid rgba(218, 218, 218, 0.16)';
		pair.style.borderLeft = '1px solid rgba(218, 218, 218, 0.14)';
		pair.style.borderRadius = '6px 6px 0 0';
		pair.style.backgroundColor = '#161616';
		pair.style.lineHeight = '16.5px';
		pair.style.paddingTop = '0px';
		pair.style.paddingBottom = '0px';
		Object.defineProperty(pair, 'clientWidth', { configurable: true, get: () => 200 });
		window.document.body.appendChild(pair);
		fillItemStrip(pair, `· «film» «Good News According» · «book» «Hope»`, '');
		const chips = [...pair.querySelectorAll('.rv-item')];
		assert.equal(chips.length, 2);
		chips[0]?.querySelector('.rv-item-icon')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		const grown = window.document.querySelector('.rv-strip-overlay.is-multi');
		assert.ok(grown instanceof window.HTMLElement);
		assert.equal(grown.style.backgroundColor, 'rgb(22, 22, 22)');
		assert.equal(grown.style.lineHeight, '16.5px');
		assert.equal(grown.style.borderTopWidth, '1px');
		assert.equal(grown.style.borderRadius, '6px 6px 0 0');
		assert.match(grown.style.paddingRight, /20px/);
		const other = chips[1];
		assert.ok(other instanceof window.HTMLElement);
		assert.equal(other.classList.contains('is-dropped'), true);
		assert.equal(other.classList.contains('is-squeezed'), false);
		chips[0]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.equal(window.document.querySelector('.rv-strip-overlay'), null);
		pair.remove();

		const wide = window.document.createElement('div');
		wide.className = 'rv-item-strip';
		Object.defineProperty(wide, 'clientWidth', { configurable: true, get: () => 400 });
		window.document.body.appendChild(wide);
		fillItemStrip(wide, '· «film» «Hope» · «book» «Tiny Tract»', '');
		const wideChips = [...wide.querySelectorAll('.rv-item')];
		assert.equal(wideChips.length, 2);
		wideChips[0]?.querySelector('.rv-item-icon')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.equal(window.document.querySelector('.rv-strip-overlay'), null);
		const squeezed = wideChips[1];
		assert.ok(squeezed instanceof window.HTMLElement);
		assert.equal(squeezed.classList.contains('is-squeezed'), true);
		assert.equal(squeezed.classList.contains('is-dropped'), false);
		assert.equal(squeezed.querySelector('.rv-fit-stem')?.textContent, 'T…');
		wide.remove();
	});
});
