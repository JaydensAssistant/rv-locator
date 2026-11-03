import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { applyLiveUrgency, type NoteChromeHost } from '../src/note-chrome';
import { clearGlanceHold, rememberGlanceGroups } from '../src/glance-hold';
import { NearbyGlancableView } from '../src/glancable-view';
import { paintedHubLeaf } from '../src/hub-open';
import { opticalChipGapPx, opticalModalGapPx } from '../src/icon-optical';
import type { RowModel } from '../src/model';
import { fitEndEllipsis, mountFittedTitle } from '../src/title-fit';
import { DEFAULT_SETTINGS } from '../src/types';
import { fillItemStrip } from '../src/visit-controls';
import type { QueryController } from 'obsidian';
import type RVLocatorPlugin from '../src/main';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
const hostGlobals = globalThis as typeof globalThis & Record<string, unknown>;
hostGlobals.window = window;
hostGlobals.document = window.document;
hostGlobals.HTMLElement = window.HTMLElement;
hostGlobals.HTMLInputElement = window.HTMLInputElement;
hostGlobals.HTMLTextAreaElement = window.HTMLTextAreaElement;
hostGlobals.HTMLButtonElement = window.HTMLButtonElement;
hostGlobals.HTMLAnchorElement = window.HTMLAnchorElement;
hostGlobals.SVGElement = window.SVGElement;
hostGlobals.Element = window.Element;
hostGlobals.Node = window.Node;
hostGlobals.Document = window.Document;
hostGlobals.requestAnimationFrame = window.requestAnimationFrame.bind(window);
hostGlobals.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
hostGlobals.getComputedStyle = window.getComputedStyle.bind(window);
hostGlobals.MutationObserver = window.MutationObserver;
hostGlobals.ResizeObserver = window.ResizeObserver;

const proto = window.HTMLElement.prototype as HTMLElement & Record<string, (...args: never[]) => unknown>;
proto.addClass = function addClass(this: HTMLElement, cls: string) {
	this.classList.add(...cls.split(/\s+/).filter(Boolean));
};
proto.removeClass = function removeClass(this: HTMLElement, cls: string) {
	this.classList.remove(...cls.split(/\s+/).filter(Boolean));
};
proto.hasClass = function hasClass(this: HTMLElement, cls: string) {
	return this.classList.contains(cls);
};
proto.toggleClass = function toggleClass(this: HTMLElement, cls: string, force?: boolean) {
	this.classList.toggle(cls, force);
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
proto.hide = function hide(this: HTMLElement) {
	this.hidden = true;
};
proto.createEl = function createEl(this: HTMLElement, tag: string, spec?: string | { cls?: string; text?: string; href?: string; attr?: Record<string, string> }) {
	const el = this.ownerDocument.createElement(tag);
	if (typeof spec === 'string') el.className = spec;
	else if (spec) {
		if (spec.cls) el.className = spec.cls;
		if (spec.text) el.textContent = spec.text;
		if (spec.href) el.setAttribute('href', spec.href);
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

function sameColor(actual: string, hex: string): boolean {
	const norm = actual.replace(/\s+/g, '').toLowerCase();
	if (norm === hex) return true;
	const match = /^#([0-9a-f]{6})$/.exec(hex);
	if (!match?.[1]) return false;
	const value = Number.parseInt(match[1], 16);
	const rgb = `rgb(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255})`;
	return norm === rgb;
}

function source(file: string): string {
	return readFileSync(file, 'utf8');
}

function chromeHost(): NoteChromeHost {
	return {
		frontmatter: () => ({
			Status: 'Active',
			Priority: 1,
			'Last Spoke': spokeStamp(),
			'Last Attempted': spokeStamp(),
		}),
		settings: { ...DEFAULT_SETTINGS, distanceTest: true },
		snoozeUntil: () => null,
		setStatus: () => {},
		setPriority: () => {},
		openUrgency: () => {},
		openPriority: () => {},
		openRoute: () => {},
		openHub: () => {},
		addHub: () => {},
		removeHub: () => {},
		moveHub: () => {},
		openSlotOverride: () => {},
		setAddress: () => {},
		openMap: () => {},
		openCompanion: () => {},
		campaignMark: () => null,
		noteTitle: () => 'Dale',
		renameNote: () => {},
		mapOpen: () => false,
		ghostIcon: () => null,
	};
}

function spokeStamp(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T08:00:00`;
}

function sampleRow(): RowModel {
	return {
		path: 'People/Dale.md',
		name: 'Dale Red',
		lat: null,
		lon: null,
		addressText: '1800 N Orange Ave',
		addressStreet: '1800 N Orange Ave',
		addressCity: 'Orlando',
		status: 'Active',
		gender: null,
		cells: [],
		sortKeys: {},
	};
}

function glancePlugin(bucket: { refresh: (() => void) | null }): RVLocatorPlugin {
	const base: Record<string, unknown> = {
		nearbySort: { property: 'file.name', direction: 'ASC' },
		settings: { ...DEFAULT_SETTINGS, distanceTest: true },
		hubMapOpen: false,
		hubPaneNarrow: false,
		app: {
			vault: { getAbstractFileByPath: () => null, getFileByPath: () => null, getMarkdownFiles: () => [] },
			metadataCache: { getFileCache: () => null },
			workspace: { getLeavesOfType: () => [] },
		},
		subscribeViewRefresh: (cb: () => void) => {
			bucket.refresh = cb;
			return () => {};
		},
		registerGlancePainter: () => () => {},
		registerGlanceWidth: () => () => {},
		registerGlanceLayout: () => () => {},
		registerHubScroller: () => () => {},
		passesSnoozeFilter: () => true,
		snoozeUntilFor: () => null,
		campaignMark: () => null,
		noteFrontmatter: () => null,
		snoozeActiveFor: () => false,
		cardOverrideLabel: () => null,
		cardReturnBucket: () => '',
		ghostIconForCard: () => null,
	};
	return new Proxy(base, {
		get(target, prop, receiver) {
			if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
			if (typeof prop === 'symbol') return undefined;
			return () => {};
		},
	}) as unknown as RVLocatorPlugin;
}

describe('RV-B2 embedded hub accent', () => {
	it('leaves a Bases card accent alone while the note sections take the note color', () => {
		const preview = window.document.createElement('div');
		preview.className = 'markdown-preview-view';
		const address = window.document.createElement('div');
		address.className = 'el-p';
		address.style.setProperty('--rv-urgency-accent', '#c8960a');
		const buttons = window.document.createElement('div');
		buttons.className = 'el-pre';
		buttons.style.setProperty('--rv-urgency-accent', '#c8960a');
		const embed = window.document.createElement('div');
		embed.className = 'bases-embed';
		const glance = window.document.createElement('div');
		glance.className = 'rv-locator-glancable';
		const card = window.document.createElement('div');
		card.className = 'rv-locator-card';
		card.style.setProperty('--rv-urgency-accent', '#d63c3c');
		const icon = window.document.createElement('span');
		icon.className = 'rv-item-icon';
		icon.style.setProperty('color', '#d63c3c');
		const badge = window.document.createElement('button');
		badge.className = 'rv-locator-urgency';
		card.append(icon, badge);
		glance.append(card);
		embed.append(glance);
		preview.append(address, buttons, embed);
		applyLiveUrgency(buttons, 'People/Dale.md', chromeHost(), true);
		const green = '#1f8a4c';
		assert.equal(sameColor(address.style.getPropertyValue('--rv-urgency-accent'), green), true);
		assert.equal(sameColor(buttons.style.getPropertyValue('--rv-urgency-accent'), green), true);
		assert.equal(sameColor(card.style.getPropertyValue('--rv-urgency-accent'), '#d63c3c'), true);
		assert.equal(sameColor(icon.style.getPropertyValue('color'), '#d63c3c'), true);
		assert.equal(badge.style.getPropertyValue('border-width'), '');
		assert.equal(glance.style.getPropertyValue('--rv-urgency-accent'), '');
	});
});

describe('RV-B3 hub click blank', () => {
	it('paints held cards in the same turn and hides a cold shell', () => {
		clearGlanceHold();
		const bucket = { refresh: null as (() => void) | null };
		const parent = window.document.createElement('div');
		window.document.body.append(parent);
		rememberGlanceGroups([{ label: null, rows: [sampleRow()] }]);
		const started = performance.now();
		new NearbyGlancableView({} as QueryController, parent, glancePlugin(bucket));
		const heldMs = performance.now() - started;
		const card = parent.querySelector('.rv-locator-card');
		assert.ok(card instanceof window.HTMLElement);
		assert.equal(card.getAttribute('data-rv-path'), 'People/Dale.md');
		assert.equal(parent.querySelector('.is-glance-pending'), null);
		assert.ok(heldMs < 150, `held cards painted in ${heldMs.toFixed(2)}ms`);
		console.log(`RV-B3-MEASURE held-click-to-cards ${heldMs.toFixed(2)}ms`);
		bucket.refresh?.();
		assert.equal(parent.querySelectorAll('.rv-locator-card').length, 1);
		assert.equal(parent.querySelector('.rv-locator-empty'), null);

		clearGlanceHold();
		const coldParent = window.document.createElement('div');
		window.document.body.append(coldParent);
		const coldBucket = { refresh: null as (() => void) | null };
		const coldStart = performance.now();
		new NearbyGlancableView({} as QueryController, coldParent, glancePlugin(coldBucket));
		const coldMs = performance.now() - coldStart;
		const shell = coldParent.querySelector('.rv-locator-glancable');
		assert.ok(shell instanceof window.HTMLElement);
		assert.equal(shell.classList.contains('is-glance-pending'), true);
		assert.equal(coldParent.querySelector('.rv-locator-card'), null);
		assert.equal(coldParent.querySelector('.rv-locator-empty'), null);
		coldBucket.refresh?.();
		assert.equal(coldParent.querySelector('.rv-locator-empty'), null);
		assert.equal(shell.classList.contains('is-glance-pending'), true);
		console.log(`RV-B3-MEASURE cold-shell ${coldMs.toFixed(2)}ms pending`);
		parent.remove();
		coldParent.remove();
		clearGlanceHold();
	});

	it('reveals a hub leaf that already has cards', () => {
		const painted = {
			view: {
				file: { path: 'Return Visits Hub.md' },
				containerEl: { querySelector: (selector: string) => selector === '.rv-locator-card' ? {} : null },
			},
		};
		const empty = {
			view: {
				file: { path: 'Return Visits Hub.md' },
				containerEl: { querySelector: () => null },
			},
		};
		assert.equal(paintedHubLeaf([empty, painted], 'Return Visits Hub.md', 'Return Visits Hub'), painted);
		assert.equal(paintedHubLeaf([empty], null, 'Return Visits Hub'), null);
		const main = source('src/main.ts');
		assert.match(main, /paintedHubLeaf\(/);
		assert.match(main, /revealLeaf\(leaf\)/);
		const css = source('styles.css');
		assert.match(css, /\.bases-embed:has\(\.rv-locator-glancable\.is-glance-pending\)/);
		assert.match(css, /\.rv-locator-glancable\.is-glance-pending \{\s*visibility: hidden;/);
	});
});

describe('RV-B4 age outline', () => {
	it('gives the age symbol the same inset outline without a chevron', () => {
		const css = source('styles.css');
		assert.match(css, /\.modal\.rv-locator-modal button\.rv-age-symbol \{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--rv-menu-ink, #1f8a4c\) !important;/);
		assert.match(css, /\.modal\.rv-locator-modal button\.rv-age-symbol \{[^}]*color:\s*var\(--rv-menu-ink, #1f8a4c\) !important;/);
		assert.match(css, /\.modal\.rv-locator-modal button\.rv-age-symbol \{[^}]*background:\s*transparent !important;/);
		assert.doesNotMatch(css, /:not\(\.rv-age-choice\)/);
		assert.match(css, /\.rv-locator-modal button\.rv-age-symbol \{\s*height: 40px;/);
		const modal = source('src/new-rv-modal.ts');
		assert.match(modal, /button\.textContent = exact\(\) \? '=' : '~'/);
		const ageSymbol = modal.slice(modal.indexOf('function mountAgeSymbol'));
		assert.equal(ageSymbol.includes('setIcon'), false);
	});
});

describe('RV-B5 hover tooltips', () => {
	it('uses displayTooltip on a strip title and keeps the phone popover', () => {
		const calls: Array<{ text?: string; placement?: string }> = [];
		(globalThis as { __rvTooltip?: (el: unknown, text?: string, options?: { placement?: string }) => void }).__rvTooltip = (_el, text, options) => {
			calls.push({ text, placement: options?.placement });
		};
		const parent = window.document.createElement('div');
		window.document.body.append(parent);
		const host = mountFittedTitle(parent, 'Why Study the Bible?', 'media');
		assert.equal(host.getAttribute('title'), null);
		assert.equal(host.dataset.rvTip, 'Why Study the Bible? Video');
		host.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
		assert.deepEqual(calls, [{ text: 'Why Study the Bible? Video', placement: 'top' }]);
		window.document.body.classList.add('is-mobile');
		host.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
		assert.equal(calls.length, 1);
		window.document.body.classList.remove('is-mobile');
		const stem = host.querySelector('.rv-fit-stem');
		assert.ok(stem);
		stem.textContent = 'Why…';
		host.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		const pop = window.document.querySelector('.rv-title-popover');
		assert.ok(pop);
		assert.match(pop.textContent ?? '', /Why Study the Bible\? Video/);
		pop.remove();
		parent.remove();

		const label = window.document.createElement('span');
		window.document.body.append(label);
		fitEndEllipsis(label, 'Return Visits Hub');
		assert.equal(label.getAttribute('title'), null);
		assert.equal(label.dataset.rvTip, 'Return Visits Hub');
		label.remove();
		delete (globalThis as { __rvTooltip?: unknown }).__rvTooltip;
	});

	it('drops the native title from every listed hover site', () => {
		const titleFit = source('src/title-fit.ts');
		assert.doesNotMatch(titleFit, /setAttribute\('title'/);
		assert.doesNotMatch(titleFit, /\.title = /);
		const chrome = source('src/note-chrome.ts');
		assert.doesNotMatch(chrome, /setAttr\('title'/);
		assert.doesNotMatch(chrome, /link\.title = /);
		assert.match(chrome, /armHoverTooltip\(pill,/);
		assert.match(chrome, /armHoverTooltip\(link, hub\.label/);
		const nearby = source('src/nearby-view.ts');
		assert.doesNotMatch(nearby, /setAttr\('title'/);
		assert.doesNotMatch(nearby, /title: 'Sort'|title: 'Search'|title: 'Map'|title: 'Campaign'|title: 'New RV'|title: 'Filters'/);
		assert.match(nearby, /armHoverTooltip\(el, live \? distance : 'No position'/);
		assert.match(nearby, /title: `Sort by \$\{column\.displayName\}`/);
		const map = source('src/map-view.ts');
		assert.doesNotMatch(map, /setAttr\('title'|title: 'Full screen'|title: 'My location'|title: 'Show all'|title: 'Hide map'/);
		assert.match(map, /armIconTooltip\(fullscreen, 'Full screen'\)/);
		assert.match(map, /armHoverTooltip\(dot, 'Current location'/);
		const suggest = source('src/suggest-field.ts');
		assert.doesNotMatch(suggest, /row\.title = /);
		assert.match(suggest, /armHoverTooltip\(row, item/);
		const glance = source('src/glancable-view.ts');
		assert.doesNotMatch(glance, /title: 'Close search'/);
		assert.match(glance, /armIconTooltip\(clear, 'Close search'\)/);
	});
});

describe('RV-B6 icon optical gap', () => {
	it('marks strip glyphs and keeps each optical gap within 1px of literature', () => {
		const strip = window.document.createElement('div');
		fillItemStrip(
			strip,
			'· «book» «Enjoy Life Forever» · «film» «Eternal Happiness» · «lesson» «How Can the Bible Help You»',
			'Campaign Week',
		);
		const glyphs = Array.from(strip.querySelectorAll('.rv-item-icon')).map((node) => (node as HTMLElement).dataset.rvGlyph);
		assert.deepEqual(glyphs, ['book-check', 'book-open', 'clapperboard', 'book-marked']);
		const literature = opticalChipGapPx('book-open');
		const gaps = {
			literature,
			media: opticalChipGapPx('clapperboard'),
			lesson: opticalChipGapPx('book-marked'),
			campaign: opticalChipGapPx('book-check'),
		};
		for (const [kind, gap] of Object.entries(gaps)) {
			assert.ok(Math.abs(gap - literature) <= 1, `${kind} optical ${gap} vs literature ${literature}`);
		}
		const modalLiterature = opticalModalGapPx('book-open');
		for (const icon of ['clapperboard', 'book-marked', 'book-check']) {
			assert.ok(Math.abs(opticalModalGapPx(icon) - modalLiterature) <= 1, icon);
		}
		const css = source('styles.css');
		assert.match(css, /\.rv-item-icon,\s*\.rv-modal-icon \{\s*width: 16px;\s*height: 16px;/);
		assert.match(css, /\[data-rv-glyph="clapperboard"\] svg \{\s*transform: translateX\(0\.67px\);/);
		assert.match(css, /\[data-rv-glyph="book-marked"\] svg,[\s\S]*?\[data-rv-glyph="book-check"\] svg \{\s*transform: translateX\(1\.33px\);/);
		assert.match(source('src/modal-chrome.ts'), /mark\.dataset\.rvGlyph = icon/);
		const stamps = source('src/visit-controls.ts');
		const stampBody = stamps.slice(stamps.indexOf('function stampKindIcon'));
		assert.equal(stampBody.includes('data-rv-glyph'), false);
		console.log(`RV-B6-MEASURE chip ${JSON.stringify(gaps)}`);
		console.log(`RV-B6-MEASURE modal literature ${modalLiterature.toFixed(2)} media ${opticalModalGapPx('clapperboard').toFixed(2)} lesson ${opticalModalGapPx('book-marked').toFixed(2)} campaign ${opticalModalGapPx('book-check').toFixed(2)}`);
	});
});
