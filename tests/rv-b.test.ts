import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { applyLiveUrgency, type NoteChromeHost } from '../src/note-chrome';
import { parkVisibleCardList, releaseParkedCardList, seedCardList, watchCardHold } from '../src/card-hold';
import { clearGlanceHold, rememberGlanceGroups } from '../src/glance-hold';
import { NearbyGlancableView } from '../src/glancable-view';
import { hubGroupsFromCache, type HubCacheFile } from '../src/hub-cache';
import { holdLeafForHubPaint, hubFrameReady, hubSwapDecision, isHubSwapFile, releaseHubSwapCover } from '../src/hub-cover';
import { hubClickFrames, paintedHubLeaf } from '../src/hub-open';
import { hubEmbedCapPx } from '../src/hub-layout';
import { shouldHideMobileNav } from '../src/status-bar';
import { LESSONS, emptyShare, studyPrefill, type VisitShare } from '../src/catalog';
import { mountShareFields, type ShareFieldOptions } from '../src/catalog-fields';
import { assignStudySlider } from '../src/study-panel';
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

function glancePlugin(bucket: { refresh: (() => void) | null }, extra: Record<string, unknown> = {}): RVLocatorPlugin {
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
		watchMapSplit: () => () => {},
		mapSplitRatio: () => 0.42,
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
		...extra,
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
		const swaps: { before: number; next: number }[] = [];
		const proto = window.HTMLElement.prototype;
		const origReplace = proto.replaceChildren;
		proto.replaceChildren = function replaceChildren(this: HTMLElement, ...nodes: Node[]) {
			if (this.classList.contains('rv-locator-scroll')) {
				const next = nodes.reduce((count, node) => count + (node instanceof window.HTMLElement ? node.querySelectorAll('.rv-locator-card').length : 0), 0);
				swaps.push({ before: this.querySelectorAll('.rv-locator-card').length, next });
			}
			return origReplace.apply(this, nodes);
		};
		new NearbyGlancableView({} as QueryController, parent, glancePlugin(bucket));
		const heldMs = performance.now() - started;
		const card = parent.querySelector('.rv-locator-card');
		assert.ok(card instanceof window.HTMLElement);
		assert.equal(card.getAttribute('data-rv-path'), 'People/Dale.md');
		assert.equal(parent.querySelector('.is-glance-pending'), null);
		assert.ok(heldMs < 150, `held cards painted in ${heldMs.toFixed(2)}ms`);
		console.log(`RV-B3-MEASURE held-click-to-cards ${heldMs.toFixed(2)}ms`);
		bucket.refresh?.();
		proto.replaceChildren = origReplace;
		assert.equal(swaps.some((swap) => swap.before > 0 && swap.next === 0), false);
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
		assert.equal(paintedHubLeaf([empty], null, 'Return Visits Hub'), empty);
		assert.equal(paintedHubLeaf([{ view: { file: { path: 'People/Dale.md' }, containerEl: { querySelector: () => null } } }], 'Return Visits Hub.md', 'Return Visits Hub'), null);
		const main = source('src/main.ts');
		assert.match(main, /paintedHubLeaf\(this\.workspaceLeaves\(\)/);
		assert.match(main, /iterateAllLeaves/);
		assert.match(main, /revealLeaf\(leaf\)/);
		const css = source('styles.css');
		assert.match(css, /\.rv-locator-full-base \.bases-toolbar,/);
		assert.match(css, /\.workspace-leaf-content:has\(\.rv-locator-glancable\) \.bases-toolbar,/);
		assert.doesNotMatch(css, /is-glance-pending/);
		const frames = hubClickFrames({ existingLeaf: false, existingCards: 0, heldCards: 0, cacheCards: 15 });
		assert.deepEqual(frames.map((frame) => frame.phase), ['cards']);
		assert.equal(frames.some((frame) => frame.viewsToolbarVisible || frame.blankBodyVisible), false);
		assert.equal(frames[0]?.cards, 15);
		const revealed = hubClickFrames({ existingLeaf: true, existingCards: 15, heldCards: 0 });
		assert.equal(revealed.length, 1);
		assert.equal(revealed[0]?.revealedExisting, true);
		assert.equal(revealed[0]?.cards, 15);
		const missed = hubClickFrames({ existingLeaf: false, existingCards: 0, heldCards: 0, cacheCards: 0 });
		assert.equal(missed[0]?.blankBodyVisible, true);
		console.log(`RV-B9-FRAMES ${JSON.stringify(frames)}`);
	});

	it('never paints 0 cards between hub activation and settle', async () => {
		clearGlanceHold();
		const doc = window.document;
		const leaf = doc.createElement('div');
		leaf.className = 'workspace-leaf mod-active';
		const content = doc.createElement('div');
		content.className = 'view-content';
		leaf.append(content);
		doc.body.append(leaf);
		const rows = Array.from({ length: 7 }, (_, index) => ({
			...sampleRow(),
			path: `People/Lane ${index}.md`,
			name: `Lane ${index}`,
		}));
		rememberGlanceGroups([{ label: null, rows }]);
		let armed = true;
		let stopWatch = (): void => {};
		stopWatch = watchCardHold(doc, () => armed, () => {
			armed = false;
			stopWatch();
			releaseParkedCardList();
		});
		const plugin = glancePlugin({ refresh: null });
		const warmup = doc.createElement('div');
		doc.body.append(warmup);
		const cold = new NearbyGlancableView({} as QueryController, warmup, plugin);
		cold.onunload();
		warmup.remove();
		clearGlanceHold();
		rememberGlanceGroups([{ label: null, rows }]);
		const rebuildStart = performance.now();
		const first = new NearbyGlancableView({} as QueryController, content, plugin);
		const rebuildMs = performance.now() - rebuildStart;
		assert.equal(content.querySelectorAll('.rv-locator-card').length, 7);

		const counts: number[] = [];
		const sample = (): void => {
			counts.push(content.querySelectorAll('.rv-locator-card').length);
		};
		const seedStart = performance.now();
		parkVisibleCardList(doc);
		content.replaceChildren();
		seedCardList(content);
		const seedMs = performance.now() - seedStart;
		sample();

		content.replaceChildren();
		await new Promise<void>((resolve) => {
			window.requestAnimationFrame(() => resolve());
		});
		sample();

		const adoptStart = performance.now();
		const next = new NearbyGlancableView({} as QueryController, content, plugin);
		const adoptMs = performance.now() - adoptStart;
		sample();
		await new Promise<void>((resolve) => {
			window.requestAnimationFrame(() => resolve());
		});
		sample();

		assert.equal(counts.every((count) => count > 0), true, `card counts ${counts.join(',')}`);
		assert.ok(adoptMs < 50, `open long task ${adoptMs.toFixed(2)}ms`);
		console.log(`HUB-OPEN rebuild ${rebuildMs.toFixed(2)}ms seed ${seedMs.toFixed(2)}ms adopt ${adoptMs.toFixed(2)}ms counts ${counts.join(',')}`);

		const main = source('src/main.ts');
		const hook = main.slice(main.indexOf('proto.openFile = function'), main.indexOf('proto.setViewState = function'));
		assert.ok(hook.indexOf('holdCardsFor(file)') < hook.indexOf('openFile.call'));
		assert.ok(hook.indexOf('openFile.call') < hook.indexOf('seedOpenLeaf(this)'));
		const glance = source('src/glancable-view.ts');
		const opened = glance.slice(glance.indexOf('onOpen(): void'), glance.indexOf('override onunload'));
		assert.match(opened, /adoptHeldGlance\(\)/);
		assert.doesNotMatch(opened, /\bawait\b/);
		assert.match(glance, /parkCardList\(this\.scrollEl\)/);

		first.onunload();
		next.onunload();
		stopWatch();
		leaf.remove();
		clearGlanceHold();
	});
});

function daleFile(address = '1800 N Orange Ave, Orlando, FL', lastSpoke = '2026-11-01'): HubCacheFile {
	return {
		path: 'People/Dale.md',
		name: 'Dale Red',
		folder: 'People',
		frontmatter: {
			Hub: ['[[Return Visits Hub]]'],
			Priority: 4,
			Status: 'Active',
			Address: address,
			'Last Spoke': lastSpoke,
			Location: '28.5383, -81.3792',
		},
	};
}

function isoDaysAgo(days: number): string {
	const date = new Date();
	date.setDate(date.getDate() - days);
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daleCache(address = '1800 N Orange Ave, Orlando, FL', lastSpoke = '2026-11-01') {
	return hubGroupsFromCache([daleFile(address, lastSpoke)], {
		returnScope: 'active',
		genderFilter: 'all',
		campaignListFilter: 'all',
		campaignMark: () => null,
		addressProperty: 'Address',
		locationProperty: 'Location',
		cityProperty: 'City',
	});
}

describe('RV-184 fresh hub paint', () => {
	it('drops a stale held list after a visit write so the first card is the new urgency', () => {
		clearGlanceHold();
		const stale = daleCache('1800 N Orange Ave, Orlando, FL', '2025-01-01');
		rememberGlanceGroups(stale.groups, stale.columns);
		const warmParent = window.document.createElement('div');
		window.document.body.append(warmParent);
		const warmBucket = { refresh: null as (() => void) | null };
		const freshModel = () => daleCache('1800 N Orange Ave, Orlando, FL', isoDaysAgo(1));
		new NearbyGlancableView({} as QueryController, warmParent, glancePlugin(warmBucket, {
			hubCacheModel: freshModel,
		}));
		const warm = warmParent.querySelector('.rv-locator-card');
		assert.ok(warm instanceof window.HTMLElement);
		assert.equal(warm.style.getPropertyValue('--rv-urgency-accent').toLowerCase(), '#d63c3c');

		clearGlanceHold();
		const freshParent = window.document.createElement('div');
		window.document.body.append(freshParent);
		const freshBucket = { refresh: null as (() => void) | null };
		new NearbyGlancableView({} as QueryController, freshParent, glancePlugin(freshBucket, {
			hubCacheModel: freshModel,
		}));
		const fresh = freshParent.querySelector('.rv-locator-card');
		assert.ok(fresh instanceof window.HTMLElement);
		assert.equal(fresh.style.getPropertyValue('--rv-urgency-accent').toLowerCase(), '#1f8a4c');
		warmParent.remove();
		freshParent.remove();
		clearGlanceHold();

		const main = source('src/main.ts');
		const pin = main.slice(main.indexOf('private pinVisitPaint'), main.indexOf('private async writeVisitHeadThenBody'));
		assert.match(pin, /pinFrontmatter\(path, data\)/);
		const changed = main.slice(main.indexOf("metadataCache.on('changed'"), main.indexOf("vault.on('modify'"));
		assert.match(changed, /clearGlanceHold\(\)/);
		assert.match(main.slice(main.indexOf('private async writePriority'), main.indexOf('private promptAddHub')), /pinFrontmatter/);
		assert.match(main.slice(main.indexOf('private async writeStatus'), main.indexOf('private async writePriority')), /pinFrontmatter/);
		assert.match(main.slice(main.indexOf('private async applySnooze'), main.indexOf('private async maybeNudgePriority')), /pinFrontmatter/);
		assert.match(main.slice(main.indexOf('snoozeUntilFor'), main.indexOf('private pathIsInactive')), /noteFrontmatter\(path\)/);
		const glance = source('src/glancable-view.ts');
		assert.match(glance.slice(glance.indexOf('private noteFrontmatter'), glance.indexOf('private frontmatterDateSlot')), /plugin\.noteFrontmatter/);
		assert.match(source('src/nearby-view.ts'), /noteValue: \(file, name\) => readProperty\(this\.plugin\.noteFrontmatter\(file\.path\), name\)/);
		assert.match(glance, /hostIsHidden\(this\.root\)/);
		assert.match(source('styles.css'), /\.rv-hub-snapshot-body/);
	});
});

describe('RV-B9 cache first paint', () => {
	it('paints vault-cache cards before Bases and patches one changed card', () => {
		clearGlanceHold();
		let address = '1800 N Orange Ave, Orlando, FL';
		const bucket = { refresh: null as (() => void) | null };
		const parent = window.document.createElement('div');
		window.document.body.append(parent);
		const plugin = glancePlugin(bucket, {
			hubCacheModel: () => daleCache(address),
		});
		new NearbyGlancableView({} as QueryController, parent, plugin);
		const card = parent.querySelector('.rv-locator-card');
		assert.ok(card instanceof window.HTMLElement);
		assert.equal(card.getAttribute('data-rv-path'), 'People/Dale.md');
		assert.ok(card.getAttribute('data-rv-paint'));
		const accent = card.style.getPropertyValue('--rv-urgency-accent');
		assert.ok(accent.trim().length > 0, 'card accent is painted');
		assert.equal(parent.querySelector('.is-glance-pending'), null);
		assert.equal(parent.querySelector('.rv-locator-empty'), null);
		assert.match(parent.textContent ?? '', /1800 N Orange Ave/);
		const scroll = parent.querySelector('.rv-locator-scroll');
		assert.ok(scroll instanceof window.HTMLElement);
		scroll.scrollTop = 48;
		bucket.refresh?.();
		assert.equal(parent.querySelector('.rv-locator-card'), card);
		assert.equal(scroll.scrollTop, 48);
		address = '99 Main St, Orlando, FL';
		bucket.refresh?.();
		const next = parent.querySelector('.rv-locator-card');
		assert.ok(next instanceof window.HTMLElement);
		assert.notEqual(next, card);
		assert.equal(parent.querySelectorAll('.rv-locator-card').length, 1);
		assert.match(parent.textContent ?? '', /99 Main St/);
		assert.equal(scroll.scrollTop, 48);
		parent.remove();
		clearGlanceHold();
	});
});

describe('RV-B9 swap cover', () => {
	it('covers a hub open until the phone toolbar is docked under the cards', async () => {
		assert.equal(isHubSwapFile('base', null), true);
		assert.equal(isHubSwapFile('BASE', null), true);
		assert.equal(isHubSwapFile('md', { cssclass: 'rv-locator-full-base' }), true);
		assert.equal(isHubSwapFile('md', { cssclasses: ['rv-dashboard'] }), false);
		assert.equal(isHubSwapFile('md', null), false);

		const empty = hubLeaf('No file');
		window.document.body.append(empty);
		assert.equal(hubFrameReady(empty, true), false);
		paintHub(empty, true);
		placeDock(empty, 720);
		assert.equal(hubFrameReady(empty, true), false, 'the empty "No file" frame stays covered');
		const title = empty.querySelector('.view-header-title');
		assert.ok(title);
		title.textContent = 'Return Visits';
		empty.querySelector('.rv-locator-glancable')?.classList.remove('is-stacked');
		assert.equal(hubFrameReady(empty, true), false, 'a phone hub waits for the stacked toolbar');
		empty.querySelector('.rv-locator-glancable')?.classList.add('is-stacked');
		assert.equal(hubFrameReady(empty, true), true);
		placeDock(empty, 40);
		assert.equal(hubFrameReady(empty, true), false, 'a toolbar still at the top is not the first paint');
		assert.equal(hubSwapDecision(empty, true, 10), 'hold');
		assert.equal(hubSwapDecision(empty, true, 800), 'drop');
		placeDock(empty, 720);
		assert.equal(hubFrameReady(empty, false), true);
		empty.remove();

		window.document.body.classList.add('is-phone');
		const leaf = hubLeaf('Lisa Study Test');
		const preview = window.document.createElement('div');
		preview.className = 'markdown-preview-view';
		preview.textContent = 'Recent notes and the hub chip';
		leaf.append(preview);
		placeDock(leaf, 40);
		window.document.body.append(leaf);
		try {
			holdLeafForHubPaint(leaf);
			const cover = leaf.querySelector(':scope > .rv-hub-swap-cover');
			assert.ok(cover instanceof window.HTMLElement);
			assert.match(cover.textContent ?? '', /Lisa Study Test/);
			assert.equal(window.document.body.classList.contains('rv-hub-swapping'), true);
			assert.equal(window.document.body.classList.contains('rv-hide-mobile-nav'), true);
			titleOf(leaf).textContent = 'No file';
			preview.textContent = '';
			await frame();
			const held = leaf.querySelector(':scope > .rv-hub-swap-cover');
			assert.ok(held instanceof window.HTMLElement, 'the note stays up through the empty frame');
			assert.match(held.textContent ?? '', /Lisa Study Test/);
			assert.equal(hubFrameReady(leaf, true), false);
			paintHub(leaf, true);
			titleOf(leaf).textContent = 'Return Visits';
			placeDock(leaf, 720);
			await frame();
			await frame();
			assert.equal(leaf.querySelector('.rv-hub-swap-cover'), null);
			assert.equal(window.document.body.classList.contains('rv-hub-swapping'), false);
			assert.equal(window.document.body.classList.contains('rv-hide-mobile-nav'), true);
		} finally {
			window.document.body.classList.remove('is-phone', 'rv-hide-mobile-nav', 'rv-hub-swapping');
			leaf.remove();
			releaseHubSwapCover(window.document);
		}

		const parent = window.document.createElement('div');
		window.document.body.classList.add('is-phone');
		window.document.body.append(parent);
		const bucket = { refresh: null as (() => void) | null };
		new NearbyGlancableView({} as QueryController, parent, glancePlugin(bucket));
		assert.equal(parent.querySelector('.rv-locator-glancable')?.classList.contains('is-stacked'), true);
		window.document.body.classList.remove('is-phone');
		parent.remove();

		const main = source('src/main.ts');
		assert.doesNotMatch(main, /holdLeafForHubPaint\(/);
		assert.match(main, /coversHubOpen\(file\)/);
		assert.match(main, /releaseHubSwapCover\(document, true\)/);
		const glance = source('src/glancable-view.ts');
		const read = glance.slice(glance.indexOf('private readStacked'), glance.indexOf('private ensureStage'));
		assert.match(read, /is-phone/);
		assert.match(read, /is-mobile/);
	});

	it('draws the cached hub into the cover and ignores a 0×0 embed', async () => {
		window.document.body.classList.add('is-phone');
		const leaf = hubLeaf('Lisa Study Test');
		const preview = window.document.createElement('div');
		preview.className = 'markdown-preview-view';
		preview.textContent = 'Recent notes and the hub chip';
		leaf.append(preview);
		placeDock(leaf, 40);
		window.document.body.append(leaf);
		const stopCover = async (): Promise<void> => {
			releaseHubSwapCover(window.document);
			await frame();
			await frame();
		};
		try {
			holdLeafForHubPaint(leaf, {
				title: 'Return Visits',
				mount(host) {
					const bucket = { refresh: null as (() => void) | null };
					new NearbyGlancableView({} as QueryController, host, glancePlugin(bucket, {
						hubCacheModel: () => daleCache(),
					}));
				},
			});
			const cover = leaf.querySelector(':scope > .rv-hub-swap-cover');
			assert.ok(cover instanceof window.HTMLElement);
			assert.match(cover.textContent ?? '', /Return Visits/);
			assert.match(cover.textContent ?? '', /Dale Red/);
			assert.equal((cover.textContent ?? '').includes('Recent notes'), false);
			assert.ok(cover.querySelector('.rv-locator-card'));
			assert.ok(cover.querySelector('.rv-app-slot, .rv-bar-spacer'));
			assert.equal(hubFrameReady(leaf, true), false, 'cards inside the cover are not the real hub');
			await stopCover();

			holdLeafForHubPaint(leaf, {
				title: 'Return Visits',
				mount() { throw new Error('snapshot failed'); },
			});
			const fallback = leaf.querySelector(':scope > .rv-hub-swap-cover');
			assert.ok(fallback instanceof window.HTMLElement);
			assert.match(fallback.textContent ?? '', /Lisa Study Test/);
			await stopCover();

			const ghost = window.document.createElement('div');
			ghost.className = 'bases-embed';
			ghost.style.display = 'none';
			ghost.getBoundingClientRect = zeroRect;
			leaf.append(ghost);
			paintHub(ghost, true);
			placeDock(leaf, 720);
			assert.equal(hubFrameReady(leaf, true), false, 'a hidden 0×0 embed is not the first paint');
			ghost.style.display = '';
			ghost.getBoundingClientRect = box(0, 690);
			titleOf(leaf).textContent = 'Return Visits';
			assert.equal(hubFrameReady(leaf, true), true);
		} finally {
			window.document.body.classList.remove('is-phone', 'rv-hide-mobile-nav', 'rv-hub-swapping');
			leaf.remove();
			releaseHubSwapCover(window.document);
			clearGlanceHold();
		}
	});

	it('does not paint cards into a hidden markdown mode', async () => {
		clearGlanceHold();
		rememberGlanceGroups([{ label: null, rows: [sampleRow()] }]);
		const hidden = window.document.createElement('div');
		hidden.className = 'markdown-reading-view';
		hidden.style.display = 'none';
		window.document.body.append(hidden);
		const bucket = { refresh: null as (() => void) | null };
		try {
			new NearbyGlancableView({} as QueryController, hidden, glancePlugin(bucket));
			assert.equal(hidden.querySelector('.rv-locator-card'), null);
			hidden.style.display = '';
			await frame();
			assert.ok(hidden.querySelector('.rv-locator-card') instanceof window.HTMLElement);
		} finally {
			hidden.remove();
			clearGlanceHold();
		}
	});
});

function frame(): Promise<void> {
	return new Promise((resolve) => {
		window.requestAnimationFrame(() => resolve());
	});
}

function titleOf(leaf: HTMLElement): HTMLElement {
	const titles = leaf.querySelectorAll('.view-header-title');
	for (let index = 0; index < titles.length; index += 1) {
		const title = titles[index];
		if (title instanceof window.HTMLElement && !title.closest('.rv-hub-swap-cover')) return title;
	}
	throw new Error('missing title');
}

function hubLeaf(title: string): HTMLElement {
	const leaf = window.document.createElement('div');
	leaf.className = 'workspace-leaf mod-active';
	const header = window.document.createElement('div');
	header.className = 'view-header-title';
	header.textContent = title;
	leaf.append(header);
	return leaf;
}

function paintHub(leaf: HTMLElement, stacked: boolean): void {
	const glance = window.document.createElement('div');
	glance.className = stacked ? 'rv-locator-glancable is-stacked' : 'rv-locator-glancable';
	const card = window.document.createElement('div');
	card.className = 'rv-locator-card';
	const sort = window.document.createElement('div');
	sort.className = 'rv-locator-sortbar';
	const actions = window.document.createElement('div');
	actions.className = 'rv-locator-toolbar-actions';
	const button = window.document.createElement('button');
	button.textContent = 'Sort';
	actions.append(button);
	sort.append(actions);
	glance.append(card, sort);
	leaf.append(glance);
}

function zeroRect(): DOMRect {
	return box(0, 0)();
}

function box(top: number, height: number): () => DOMRect {
	return () => ({
		top,
		left: 0,
		width: height > 0 ? 382 : 0,
		height,
		bottom: top + height,
		right: height > 0 ? 382 : 0,
		x: 0,
		y: top,
		toJSON() { return {}; },
	}) as DOMRect;
}

function placeDock(leaf: HTMLElement, sortTop: number): void {
	const rect = (top: number, height: number) => () => ({
		top,
		left: 0,
		width: 382,
		height,
		bottom: top + height,
		right: 382,
		x: 0,
		y: top,
		toJSON() { return {}; },
	});
	leaf.getBoundingClientRect = rect(0, 800);
	const actions = leaf.querySelector('.rv-locator-toolbar-actions');
	const sort = leaf.querySelector('.rv-locator-sortbar');
	if (actions instanceof window.HTMLElement) actions.getBoundingClientRect = rect(sortTop + 8, 40);
	if (sort instanceof window.HTMLElement) sort.getBoundingClientRect = rect(sortTop, 80);
}

describe('RV-B7 hub forehead', () => {
	it('keeps the safe area and the 6px the direct base sits lower', () => {
		const css = source('styles.css');
		assert.match(css, /\.markdown-preview-view\.rv-locator-full-base,\s*\n\.markdown-reading-view\.rv-locator-full-base \{\s*--view-top-spacing-markdown: env\(safe-area-inset-top, 0px\);\s*padding-top: calc\(env\(safe-area-inset-top, 0px\) \+ 6px\) !important;\s*\}/);
		assert.match(css, /env\(safe-area-inset-top, 0px\)/);
		assert.equal(css.includes('--view-top-spacing-markdown: 0'), false);
		const phoneAt = css.indexOf('/* RV-162.');
		const phoneQuote = css.slice(phoneAt, css.indexOf('body.is-phone .markdown-preview-view.rv-locator-full-base', phoneAt));
		assert.match(phoneQuote, /margin-top:\s*-5px !important/);
		assert.equal(phoneQuote.includes('safe-area-inset-top'), false);
		const liveDirect = 117;
		const liveLink = 111.09;
		const linkPad = 6;
		assert.ok(Math.abs((liveLink + linkPad) - liveDirect) <= 2, `link ${liveLink + linkPad} direct ${liveDirect}`);
		assert.equal(hubEmbedCapPx(800, 223, 119), 800 - 223);
		assert.equal(hubEmbedCapPx(800, 0, 119), 800 - 119);
		assert.equal(hubEmbedCapPx(800, 104, 0), 800 - 104);
		const view = source('src/glancable-view.ts');
		const frame = view.slice(view.indexOf('private sizeEmbedFrame'), view.indexOf('private bindHubHandle'));
		assert.match(frame, /hubEmbedCapPx\(viewport, top, pad\)/);
		assert.match(frame, /Math\.max\(160/);
	});
});

describe('RV-B8 standalone base nav', () => {
	it('hides the phone navbar on a base opened by itself', () => {
		assert.equal(shouldHideMobileNav(false, true), true);
		assert.equal(shouldHideMobileNav(true, false), true);
		assert.equal(shouldHideMobileNav(false, false), false);
		const main = source('src/main.ts');
		const layout = main.slice(main.indexOf('applyLayoutClasses'), main.indexOf('private activeLocatorSurface'));
		assert.match(layout, /shouldHideMobileNav\(this\.activeLocatorSurface\(\), this\.standaloneBaseOpen\(\)\)/);
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
	it('uses displayTooltip for a truncated phone tap and dismisses it', async () => {
		const calls: Array<{ text?: string; placement?: string }> = [];
		(globalThis as { __rvTooltip?: (el: unknown, text?: unknown, options?: { placement?: string }) => void }).__rvTooltip = (el, text, options) => {
			const value = typeof text === 'string' ? text : (text as { textContent?: string } | null)?.textContent ?? '';
			calls.push({ text: value, placement: options?.placement });
			const doc = (el as HTMLElement).ownerDocument;
			doc.querySelectorAll('.tooltip').forEach((node) => node.remove());
			const tip = doc.createElement('div');
			tip.className = 'tooltip';
			tip.textContent = value;
			doc.body.append(tip);
		};
		const parent = window.document.createElement('div');
		let parentClicks = 0;
		parent.addEventListener('click', () => { parentClicks += 1; });
		window.document.body.append(parent);
		const host = mountFittedTitle(parent, 'You Are Invited: 2026 Eternal Happiness', 'media');
		assert.equal(host.getAttribute('title'), null);
		assert.equal(host.dataset.rvTip, 'You Are Invited: 2026 Eternal Happiness Video');
		host.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.placement, 'top');
		window.document.body.classList.add('is-mobile');
		host.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
		assert.equal(calls.length, 1);
		const stem = host.querySelector('.rv-fit-stem');
		assert.ok(stem);
		stem.textContent = 'You Are…';
		host.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.equal(parentClicks, 0);
		assert.equal(window.document.querySelector('.rv-title-popover'), null);
		assert.equal(window.document.querySelector('.tooltip')?.textContent, 'You Are Invited: 2026 Eternal Happiness Video');
		await new Promise((resolve) => setTimeout(resolve, 0));
		window.document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
		assert.equal(window.document.querySelector('.tooltip'), null);
		host.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		window.document.dispatchEvent(new window.Event('scroll'));
		assert.equal(window.document.querySelector('.tooltip'), null);
		window.document.body.classList.remove('is-mobile');
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
		assert.match(chrome, /plainTitleTruncated\(pill\)/);
		assert.match(chrome, /plainTitleTruncated\(link\)/);
		assert.match(chrome, /host\.openHub\(path, hub\.target\)/);
		assert.match(titleFit, /displayTooltip\(anchor, tooltipContent/);
		assert.doesNotMatch(titleFit, /className = 'rv-title-popover'/);
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

const LESSON_1 = '01 How Can the Bible Help You?';
const LESSON_2 = '02 The Bible Gives Hope';

function shareOptions(extra: Partial<ShareFieldOptions> = {}): ShareFieldOptions {
	return {
		publications: [],
		media: [],
		customLessons: [],
		lessons: [...LESSONS],
		showLiterature: true,
		showLesson: false,
		optionalLesson: true,
		lessonPrefill: studyPrefill(null),
		initial: emptyShare(),
		...extra,
	};
}

function clickText(root: ParentNode, text: string): void {
	const nodes = root.querySelectorAll('button');
	for (const node of nodes) {
		if (node.textContent === text) {
			node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
			return;
		}
	}
	throw new Error(`No control labeled ${text}`);
}

describe('RV-B10 study log default', () => {
	it('logs the next lesson when Study starts open, and nothing when it is opened by hand', () => {
		const seen: VisitShare[] = [];
		const root = window.document.createElement('div');
		window.document.body.append(root);
		const share = mountShareFields(root, shareOptions({ lessonExpanded: true }), (next) => { seen.push(next); });
		assert.equal(share.lesson, LESSON_1);
		assert.equal(share.lessonFrom, 'Intro');
		assert.equal(share.lessonTo, 'Outro');
		assert.equal(seen.at(-1)?.lesson, LESSON_1);
		assert.equal(root.querySelector('.rv-study-label')?.textContent?.includes('No study'), false);
		assert.equal(root.querySelector('.rv-study-skip')?.textContent, "Didn't study");
		clickText(root, "Didn't study");
		assert.equal(seen.at(-1)?.lesson, '');

		const plainSeen: VisitShare[] = [];
		const plain = window.document.createElement('div');
		window.document.body.append(plain);
		const plainShare = mountShareFields(plain, shareOptions(), (next) => { plainSeen.push(next); });
		assert.equal(plainShare.lesson, '');
		clickText(plain, 'Study');
		assert.equal(plainShare.lesson, '');
		assert.equal(plainSeen.length, 0);
		assert.equal(plain.querySelector('.rv-study-skip')?.textContent, 'Did study');
		assert.equal(plain.querySelector('.rv-study-label')?.textContent, 'No study');
		root.remove();
		plain.remove();
	});

	it('defaults the next log to lesson 02 after lesson 01 was finished', () => {
		const prefill = studyPrefill({ lesson: LESSON_1, to: 'Outro' });
		assert.equal(prefill.lesson, LESSON_2);
		assert.equal(prefill.from, 'Intro');
		const seen: VisitShare[] = [];
		const root = window.document.createElement('div');
		window.document.body.append(root);
		mountShareFields(root, shareOptions({ lessonExpanded: true, lessonPrefill: prefill }), (next) => { seen.push(next); });
		assert.equal(seen.at(-1)?.lesson, LESSON_2);
		assert.equal(seen.at(-1)?.lessonFrom, 'Intro');
		assert.equal(seen.at(-1)?.lessonTo, 'Outro');
		root.remove();
	});
});

describe('RV-B12 change study slider', () => {
	it('hides the slider until a lesson is picked', () => {
		const root = window.document.createElement('div');
		window.document.body.append(root);
		mountShareFields(root, shareOptions(), () => {});
		clickText(root, 'Study');
		clickText(root, 'Change');
		const slider = window.document.querySelector('.rv-study-change-modal input.rv-study-slider');
		const ticks = window.document.querySelector('.rv-study-change-modal .rv-study-ticks');
		assert.ok(slider instanceof window.HTMLElement);
		assert.ok(ticks instanceof window.HTMLElement);
		assert.equal(slider.hidden, true);
		assert.equal(ticks.hidden, true);
		assert.equal(ticks.querySelector('.rv-study-tick'), null);
		const lesson = window.document.querySelector('.rv-study-change-list button');
		assert.ok(lesson instanceof window.HTMLElement);
		lesson.click();
		assert.equal(slider.hidden, false);
		assert.equal(ticks.hidden, false);
		assert.ok(ticks.querySelector('.rv-study-tick'));
		window.document.querySelector('.rv-study-change-modal')?.remove();
		root.remove();
	});
});

describe('RV-B14 lesson pills and ticks', () => {
	it('ellipsizes the pill label and keeps tick labels inside their slots', () => {
		const css = source('styles.css');
		assert.match(css, /\.rv-study-change-list > button > \.rv-study-change-label \{[^}]*display:\s*block;[^}]*min-width:\s*0;[^}]*text-overflow:\s*ellipsis;/);
		assert.match(css, /\.rv-study-tick \{[^}]*max-width:\s*calc\(\(100% - var\(--rv-thumb, 16px\)\) \/ max\(var\(--tick-count, 2\) - 1, 1\) \* 0\.62\);/);
		assert.match(css, /\.rv-study-tick \{[^}]*text-overflow:\s*ellipsis;/);
		assert.match(css, /\.rv-study-tick:first-child:not\(:last-child\) \{[^}]*max-width:\s*none;/);
		assert.match(css, /\.rv-study-tick:first-child:not\(:last-child\) \{[^}]*overflow:\s*visible;/);
		assert.match(css, /\.rv-study-tick:last-child:not\(:first-child\) \{[^}]*max-width:\s*none;/);
		assert.match(css, /\.rv-study-tick:last-child:not\(:first-child\) \{[^}]*overflow:\s*visible;/);
		assert.match(css, /\.rv-study-tick:last-child:not\(:first-child\) \{[^}]*text-overflow:\s*clip;/);
		const root = window.document.createElement('div');
		window.document.body.append(root);
		mountShareFields(root, shareOptions({ lessonExpanded: true }), () => {});
		clickText(root, 'Change');
		const label = window.document.querySelector('.rv-study-change-label');
		assert.ok(label instanceof window.HTMLElement);
		assert.equal(label.parentElement?.tagName, 'BUTTON');
		const ticks = window.document.querySelector('.rv-study-ticks');
		assert.ok(ticks instanceof window.HTMLElement);
		assert.ok(Number(ticks.style.getPropertyValue('--tick-count')) > 1);
		window.document.querySelector('.rv-study-change-modal')?.remove();
		root.remove();
	});
});

describe('RV-181 study slider thumb', () => {
	it('uses the menu ink and keeps the chosen stop after max grows from 0', () => {
		const css = source('styles.css');
		assert.match(css, /input\.rv-study-slider\[type="range"\]::-webkit-slider-thumb \{[^}]*background:\s*var\(--rv-menu-ink, #1f8a4c\);/);
		assert.match(css, /input\.rv-study-slider\[type="range"\]::-moz-range-thumb \{[^}]*background:\s*var\(--rv-menu-ink, #1f8a4c\);/);
		assert.doesNotMatch(css, /input\.rv-study-slider\[type="range"\]::-webkit-slider-thumb \{[^}]*var\(--interactive-accent\)/);
		assert.doesNotMatch(css, /input\.rv-study-slider\[type="range"\]::-moz-range-thumb \{[^}]*var\(--interactive-accent\)/);
		assert.match(css, /\.rv-study-tick:first-child:not\(:last-child\)::before \{[^}]*transform:\s*translateX\(-0\.5px\);/);
		assert.match(css, /\.rv-study-tick:last-child:not\(:first-child\)::before \{[^}]*transform:\s*translateX\(0\.5px\);/);
		assert.doesNotMatch(css, /\.rv-snooze-slider \{[^}]*--rv-menu-ink/);

		const clamped = window.document.createElement('input');
		clamped.type = 'range';
		clamped.max = '0';
		clamped.value = '4';
		assert.equal(clamped.value, '0');
		assignStudySlider(clamped, 4, 7);
		assert.equal(clamped.max, '7');
		assert.equal(clamped.value, '4');

		const modal = window.document.createElement('div');
		modal.className = 'modal';
		modal.style.setProperty('--rv-menu-ink', '#d63c3c');
		modal.style.setProperty('--rv-modal-accent', '#d63c3c');
		const root = window.document.createElement('div');
		modal.append(root);
		window.document.body.append(modal);
		mountShareFields(root, shareOptions(), () => {});
		clickText(root, 'Study');
		const study = root.querySelector('.rv-study-panel');
		assert.ok(study instanceof window.HTMLElement);
		assert.equal(study.style.getPropertyValue('--rv-menu-ink').trim(), '#d63c3c');
		clickText(root, 'Change');
		const panel = window.document.querySelector('.rv-study-change-modal');
		assert.ok(panel instanceof window.HTMLElement);
		assert.equal(panel.style.getPropertyValue('--rv-menu-ink').trim(), '#d63c3c');
		const slider = panel.querySelector('input.rv-study-slider');
		assert.ok(slider instanceof window.HTMLInputElement);
		assert.equal(slider.hidden, true);
		assert.equal(slider.max, '0');
		const lesson = panel.querySelector('.rv-study-change-list button');
		assert.ok(lesson instanceof window.HTMLElement);
		lesson.click();
		assert.equal(slider.hidden, false);
		assert.equal(slider.max, '7');
		assert.equal(slider.value, '0');
		slider.value = '4';
		slider.dispatchEvent(new window.Event('input'));
		assert.equal(slider.value, '4');
		assert.equal(panel.querySelector('.rv-study-start-label')?.textContent, 'Start at 4');
		const current = panel.querySelector('.rv-study-tick.is-current');
		assert.equal(current?.textContent, '4');
		panel.remove();
		modal.remove();
	});

	it('seeds the in-modal slider on the current stop for partway and next', () => {
		const modal = window.document.createElement('div');
		modal.className = 'modal';
		modal.style.setProperty('--rv-menu-ink', '#d6a100');
		const root = window.document.createElement('div');
		modal.append(root);
		window.document.body.append(modal);
		const share = {
			...emptyShare(),
			lesson: '37 What the Bible Says About Work and Money',
			lessonFrom: 'Intro',
			lessonTo: '4',
		};
		mountShareFields(root, shareOptions({ showLesson: true, optionalLesson: false, initial: share }), () => {});
		const panel = root.querySelector('.rv-study-panel');
		assert.ok(panel instanceof window.HTMLElement);
		assert.equal(panel.style.getPropertyValue('--rv-menu-ink').trim(), '#d6a100');
		const slider = root.querySelector('input.rv-study-slider');
		assert.ok(slider instanceof window.HTMLInputElement);
		assert.equal(slider.max, '7');
		assert.equal(slider.value, '4');
		clickText(root, 'Finished');
		assert.equal(root.querySelector('input.rv-study-slider'), null);
		clickText(root, 'Partway');
		const again = root.querySelector('input.rv-study-slider');
		assert.ok(again instanceof window.HTMLInputElement);
		assert.equal(again.max, '7');
		assert.equal(again.value, '1');
		clickText(root, 'Next lesson');
		const next = root.querySelector('input.rv-study-slider');
		assert.ok(next instanceof window.HTMLInputElement);
		assert.equal(next.max, '6');
		assert.equal(next.value, '0');
		modal.remove();
	});
});

describe('RV-B15 snoozed visit gradient', () => {
	it('keeps the slate accent and lets the five buttons step', () => {
		const css = source('styles.css');
		assert.doesNotMatch(css, /\.rv-dashboard\.is-snoozed \.mb-button-group[\s\S]*?#6b7a99 !important/);
		assert.match(css, /\.rv-dashboard\.is-snoozed button\.rv-locator-urgency \{[^}]*color:\s*#6b7a99 !important;/);
		assert.match(css, /\.rv-dashboard \.mb-button-group\.mb-button-group > span\.mb-button\.rv-visit-btn:nth-child\(1\) > button\.mb-button-inner \{[^}]*clamp\(0\.46, l, 0\.80\)/);
		assert.match(css, /\.rv-dashboard \.mb-button-group\.mb-button-group > span\.mb-button\.rv-visit-btn:nth-child\(5\) > button\.mb-button-inner \{[^}]*clamp\(0\.34, calc\(l - 0\.24\), 0\.56\)/);
	});
});
