import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { applyLiveUrgency, urgencyStyleHosts, type NoteChromeHost } from '../src/note-chrome';
import { nextPresetSort, SORT_PRESETS } from '../src/active-layout';
import { DISTANCE_COLUMN_ID, URGENCY_COLUMN_ID } from '../src/constants';
import { annotateRowScores } from '../src/row-score';
import { sortRowsBy } from '../src/sort';
import { clearGlanceHold, heldGlanceGroups, rememberGlanceGroups } from '../src/glance-hold';
import { createdNewRvFile } from '../src/new-rv-launch';
import { NewRvIdentityModal, type NewRvIdentity } from '../src/new-rv-modal';
import { clearBadgeStrokeCache, NearbyGlancableView, pinBadgeStroke } from '../src/glancable-view';
import { hubGroupsFromCache, type HubCacheFile } from '../src/hub-cache';
import { alignHubCover, concealHubList, handoffCoverLanding, holdLeafForHubPaint, hubFrameReady, hubSwapDecision, isHubSwapFile, releaseHubSwapCover } from '../src/hub-cover';
import { hubClickFrames, hubReturnChoice, paintedHubLeaf } from '../src/hub-open';
import { embedCapCss, hubEmbedCapPx, landingScrollExact, viewportHeightPx, writeViewportHeight } from '../src/hub-layout';
import { createBarShell, paintSurfaceAccent, pinBarToScreen, placeBarOver, visibleBarSpacer } from '../src/bar-shell';
import { defaultUrgencyColors, hubAccentColor, URGENCY_PALETTES } from '../src/urgency-palette';
import { shouldHideMobileNav } from '../src/status-bar';
import { LESSONS, emptyShare, studyPrefill, type VisitShare } from '../src/catalog';
import { mountShareFields, type ShareFieldOptions } from '../src/catalog-fields';
import { assignStudySlider } from '../src/study-panel';
import { opticalChipGapPx, opticalModalGapPx } from '../src/icon-optical';
import type { RowModel } from '../src/model';
import { fitEndEllipsis, mountFittedTitle } from '../src/title-fit';
import { DEFAULT_SETTINGS } from '../src/types';
import { fillItemStrip } from '../src/visit-controls';
import { glanceSnapToken } from '../src/glancable-density';
import { matchesHubSearch } from '../src/glance-search';
import { revealNoteMatch } from '../src/note-hub-bar';
import { TFile, type QueryController } from 'obsidian';
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
		assert.equal(frames[0]?.cards, 8);
		const revealed = hubClickFrames({ existingLeaf: true, existingCards: 15, heldCards: 0 });
		assert.equal(revealed.length, 1);
		assert.equal(revealed[0]?.revealedExisting, true);
		assert.equal(revealed[0]?.cards, 15);
		const missed = hubClickFrames({ existingLeaf: false, existingCards: 0, heldCards: 0, cacheCards: 0 });
		assert.equal(missed[0]?.blankBodyVisible, true);
		console.log(`RV-B9-FRAMES ${JSON.stringify(frames)}`);
	});

	it('paints this view\'s own visible cards before the first yield', async () => {
		clearGlanceHold();
		const doc = window.document;
		const slices: number[] = [];
		(globalThis as { __rvOpenSlice?: (ms: number) => void }).__rvOpenSlice = (ms) => { slices.push(ms); };
		const rows = Array.from({ length: 20 }, (_, index) => ({
			...sampleRow(),
			path: `People/Lane ${index}.md`,
			name: `Lane ${index}`,
		}));
		const baseRows = Array.from({ length: 7 }, (_, index) => ({
			...sampleRow(),
			path: `Bases/Smoke ${index}.md`,
			name: `Smoke ${index} Dark`,
		}));
		rememberGlanceGroups([{ label: null, rows }]);
		const plugin = glancePlugin({ refresh: null });
		const warmupHost = doc.createElement('div');
		doc.body.append(warmupHost);
		const coldStart = performance.now();
		const cold = new NearbyGlancableView({} as QueryController, warmupHost, plugin);
		const coldMs = performance.now() - coldStart;
		const coldCard = warmupHost.querySelector('.rv-locator-card');
		assert.ok(coldCard instanceof window.HTMLElement);
		const firstNodes = coldCard.querySelectorAll('*').length;
		assert.equal(warmupHost.querySelectorAll('.rv-locator-card').length, 8);
		assert.equal(coldCard.querySelector('.rv-locator-file-link')?.textContent, 'Lane 0');
		assert.ok(coldCard.style.getPropertyValue('--rv-urgency-accent').length > 0);
		assert.ok(coldCard.querySelector('.rv-locator-card-foot')?.textContent);
		assert.equal(coldCard.querySelector('.rv-locator-card-actions'), null);
		cold.onunload();
		warmupHost.remove();

		const warmHost = doc.createElement('div');
		doc.body.append(warmHost);
		const warmStart = performance.now();
		const warm = new NearbyGlancableView({} as QueryController, warmHost, plugin);
		const warmMs = performance.now() - warmStart;
		assert.equal(warmHost.querySelectorAll('.rv-locator-card').length, 8);
		assert.ok(warmMs < Math.max(120, coldMs * 4), `warm first paint ${warmMs.toFixed(2)}ms`);
		const paths = [...warmHost.querySelectorAll('.rv-locator-card')].map((card) => card.getAttribute('data-rv-path'));
		assert.deepEqual(paths, rows.slice(0, 8).map((row) => row.path));
		await settleOwnCards(warmHost, 20);
		assert.equal(warmHost.querySelector('.is-stub'), null);
		assert.equal(warmHost.querySelectorAll('.rv-locator-card').length, 20);
		assert.ok(slices.length > 1);
		const later = slices.slice(1);
		const laterMax = Math.max(...later);
		const laterBudget = Math.max(80, (slices[0] ?? 0) * 4);
		console.log(`HUB-OPEN cold ${coldMs.toFixed(2)}ms warm ${warmMs.toFixed(2)}ms first-paint 8 cards ${firstNodes} nodes title+color+foot first-slice ${slices[0]?.toFixed(2)}ms later-max ${laterMax.toFixed(2)}ms budget ${laterBudget.toFixed(2)}ms`);
		assert.ok((slices[0] ?? 0) < Math.max(80, warmMs * 4), `first decoration ${slices[0]?.toFixed(2)}ms`);
		assert.ok(laterMax < laterBudget, `later slice ${laterMax.toFixed(2)}ms budget ${laterBudget.toFixed(2)}ms`);

		rememberGlanceGroups([{ label: null, rows: baseRows }], [], 'Ministry/One.base');
		const baseHost = doc.createElement('div');
		doc.body.append(baseHost);
		const base = new NearbyGlancableView({} as QueryController, baseHost, glancePlugin({ refresh: null }, {
			glanceSurfacePath: () => 'Ministry/One.base',
		}));
		const baseNames = [...baseHost.querySelectorAll('.rv-locator-file-link')].map((card) => card.textContent);
		assert.equal(baseNames.length, 7);
		assert.equal(baseNames[0], 'Smoke 0 Dark');
		assert.equal(baseNames.some((name) => name?.startsWith('Lane')), false);

		const emptyHost = doc.createElement('div');
		doc.body.append(emptyHost);
		const empty = new NearbyGlancableView({} as QueryController, emptyHost, glancePlugin({ refresh: null }, {
			glanceSurfacePath: () => 'Ministry/Other.base',
		}));
		assert.equal(emptyHost.querySelector('.rv-locator-card'), null);
		assert.equal(emptyHost.querySelector('.rv-locator-glancable')?.classList.contains('is-glance-pending'), true);

		const main = source('src/main.ts');
		const glance = source('src/glancable-view.ts');
		assert.doesNotMatch(main, /card-hold|holdCardsFor|seedOpenLeaf/);
		assert.doesNotMatch(glance, /parkCardList|claimCardList/);
		const opened = glance.slice(glance.indexOf('onOpen(): void'), glance.indexOf('override onunload'));
		assert.match(opened, /adoptHeldGlance\(\)/);
		assert.doesNotMatch(opened, /\bawait\b/);

		warm.onunload();
		base.onunload();
		empty.onunload();
		warmHost.remove();
		baseHost.remove();
		emptyHost.remove();
		delete (globalThis as { __rvOpenSlice?: (ms: number) => void }).__rvOpenSlice;
		clearGlanceHold();
	});

	it('paints the first cards of the settled sort and never a misordered frame', async () => {
		clearGlanceHold();
		const later = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
		const people: Array<[string, number]> = [
			['Eve Carter', 40],
			['Green Lane', 20],
			['Red Lane', 90],
			['Smoke Dark', 10],
			['Yellow Lane', 70],
			['Blue Shore', 30],
			['Cedar House', 50],
			['Dawn Park', 15],
			['Ivy Court', 55],
			['Oak Street', 25],
			['Pine Road', 35],
			['Alpha Snooze', 200],
		];
		const rows = people.map(([name, days]) => ({
			...sampleRow(),
			path: `People/${name}.md`,
			name,
			cells: [
				{ id: 'note.priority', text: '3', title: 'Priority', kind: 'text' as const, numeric: true },
				{ id: 'note.last spoke', text: 'spoke', title: 'Last Spoke', kind: 'text' as const, numeric: false, daysSince: days },
			],
		}));
		const settings = { ...DEFAULT_SETTINGS, distanceTest: true };
		const expected = sortRowsBy(
			rows.map((row) => annotateRowScores(
				row,
				null,
				settings,
				null,
				new Date(),
				row.path.endsWith('Alpha Snooze.md') ? later : null,
			)),
			[{ property: URGENCY_COLUMN_ID, direction: 'DESC' }],
			null,
			DISTANCE_COLUMN_ID,
		).map((row) => row.path);
		assert.equal(expected[0], 'People/Red Lane.md');
		assert.equal(expected[expected.length - 1], 'People/Alpha Snooze.md');
		assert.notDeepEqual(expected, rows.map((row) => row.path));

		const plugin = glancePlugin({ refresh: null }, {
			nearbySort: { property: URGENCY_COLUMN_ID, direction: 'DESC' },
			settings,
			snoozeUntilFor: (path: string) => path.endsWith('Alpha Snooze.md') ? later : null,
			hubCacheModel: () => ({ columns: [], groups: [{ label: null, rows }] }),
		});
		const seedHost = window.document.createElement('div');
		window.document.body.append(seedHost);
		const seeded = new NearbyGlancableView({} as QueryController, seedHost, plugin);
		(seeded as unknown as { renderBody(): void }).renderBody();
		const cached = heldGlanceGroups()?.flatMap((group) => group.rows.map((row) => row.path)) ?? [];
		assert.deepEqual(cached, expected);
		await settleOwnCards(seedHost, expected.length);
		const settled = [...seedHost.querySelectorAll('.rv-locator-card')].map((card) => card.getAttribute('data-rv-path'));
		assert.deepEqual(settled, expected);
		seeded.onunload();
		seedHost.remove();

		const host = window.document.createElement('div');
		window.document.body.append(host);
		const frames: string[][] = [];
		const sample = (): void => {
			frames.push([...host.querySelectorAll('.rv-locator-card')].map((card) => card.getAttribute('data-rv-path') ?? ''));
		};
		new NearbyGlancableView({} as QueryController, host, plugin);
		sample();
		assert.deepEqual(frames[0], expected.slice(0, 8));
		for (let turn = 0; turn < 40; turn += 1) {
			const cards = host.querySelectorAll('.rv-locator-card');
			sample();
			if (cards.length >= expected.length && !host.querySelector('.is-stub')) break;
			await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
		}
		for (const frame of frames) {
			assert.deepEqual(frame, expected.slice(0, frame.length), frame.join(' > '));
		}
		assert.deepEqual(frames[frames.length - 1], expected);

		const leaf = window.document.createElement('div');
		leaf.className = 'workspace-leaf';
		const leafContent = window.document.createElement('div');
		leafContent.className = 'workspace-leaf-content';
		const viewContent = window.document.createElement('div');
		viewContent.className = 'view-content';
		leafContent.append(viewContent);
		leaf.append(leafContent);
		const note = window.document.createElement('div');
		note.className = 'workspace-leaf mod-active';
		const shell = window.document.createElement('div');
		shell.className = 'rv-map-shell';
		const bar = window.document.createElement('div');
		bar.className = 'rv-bar-shell';
		window.document.body.append(leaf, note, shell, bar);
		new NearbyGlancableView({} as QueryController, viewContent, plugin);
		const card = viewContent.querySelector('.rv-locator-card');
		assert.ok(card instanceof window.HTMLElement);
		assert.equal(card.closest('.workspace-leaf'), leaf);
		assert.equal(card.closest('.rv-map-shell'), null);
		assert.equal(card.closest('.rv-bar-shell'), null);
		assert.equal(note.querySelector('.rv-locator-card'), null);
		assert.equal(shell.querySelector('.rv-locator-card'), null);
		assert.equal(bar.querySelector('.rv-locator-card'), null);
		const mode = window.document.createElement('div');
		mode.className = 'markdown-reading-view rv-hub-fill';
		mode.style.display = 'none';
		leaf.append(mode);
		concealHubList(leaf);
		const hiddenList = viewContent.querySelector('.rv-locator-glancable');
		assert.ok(hiddenList instanceof window.HTMLElement);
		assert.equal(hiddenList.hasAttribute('hidden'), true);
		assert.equal(mode.classList.contains('rv-hub-fill'), false);
		assert.equal(card.closest('.workspace-leaf'), leaf);

		const glance = source('src/glancable-view.ts');
		const opening = glance.slice(glance.indexOf('private openingRows'), glance.indexOf('private paintStubCard'));
		const firstPaint = glance.slice(glance.indexOf('private paintFirstCards'), glance.indexOf('private openingRows'));
		assert.doesNotMatch(opening, /rankedGroups|sortedGroups/);
		assert.doesNotMatch(firstPaint, /rankedGroups|sortedGroups/);
		const css = source('styles.css');
		assert.match(css, /\.rv-locator-modal \.rv-suggest-host \{[^}]*position:\s*relative/);
		assert.match(css, /\.rv-suggest-panel \{[^}]*position:\s*absolute !important/);
		assert.match(css, /z-index:\s*46/);
		assert.match(css, /\.rv-locator-glancable\[hidden\] \{[^}]*display:\s*none !important/);
		const main = source('src/main.ts');
		const hook = main.slice(main.indexOf('proto.openFile = function'), main.indexOf('proto.setViewState = function'));
		assert.ok(hook.indexOf('beginBarNav(file)') < hook.indexOf('openFile.call'));
		assert.ok(hook.indexOf('leaveHubForNote') >= 0 && hook.indexOf('leaveHubForNote') < hook.indexOf('openFile.call'));
		assert.match(hook, /quiesceHubWork\(\)/);
		assert.match(glance, /cancelScheduledFill\(\)/);
		assert.doesNotMatch(source('src/nearby-view.ts'), /nextPresetSort\(current, preset\)/);

		host.remove();
		leaf.remove();
		note.remove();
		shell.remove();
		bar.remove();
		clearGlanceHold();
	});

	it('keeps the Urgency list on the saved direction', async () => {
		clearGlanceHold();
		const urgent = SORT_PRESETS.find((preset) => preset.id === 'urgency');
		const city = SORT_PRESETS.find((preset) => preset.id === 'city');
		assert.ok(urgent && city);
		const afterCity = nextPresetSort({ property: urgent.property, direction: 'DESC' }, city);
		assert.equal(afterCity.property, city.property);
		assert.equal(afterCity.direction, 'ASC');
		const afterUrgent = nextPresetSort(afterCity, urgent);
		assert.equal(afterUrgent.property, urgent.property);
		assert.equal(afterUrgent.direction, 'DESC');
		const flipped = nextPresetSort(afterUrgent, urgent);
		assert.equal(flipped.direction, 'ASC');

		const people: Array<[string, number]> = [
			['Smoke Dark', 10],
			['Red Lane', 90],
			['Dawn Park', 15],
		];
		const rows = people.map(([name, days]) => ({
			...sampleRow(),
			path: `People/${name}.md`,
			name,
			cells: [
				{ id: 'note.priority', text: '3', title: 'Priority', kind: 'text' as const, numeric: true },
				{ id: 'note.last spoke', text: 'spoke', title: 'Last Spoke', kind: 'text' as const, numeric: false, daysSince: days },
			],
		}));
		const settings = { ...DEFAULT_SETTINGS, distanceTest: true };
		const orderFor = (direction: 'ASC' | 'DESC') => sortRowsBy(
			rows.map((row) => annotateRowScores(row, null, settings, null, new Date(), null)),
			[{ property: URGENCY_COLUMN_ID, direction }],
			null,
			DISTANCE_COLUMN_ID,
		).map((row) => row.path);
		assert.equal(orderFor('DESC')[0], 'People/Red Lane.md');
		assert.equal(orderFor('ASC')[0], 'People/Smoke Dark.md');
		const bucket = { refresh: null as (() => void) | null };
		const plugin = glancePlugin(bucket, {
			nearbySort: { property: URGENCY_COLUMN_ID, direction: 'DESC' },
			settings,
			snoozeUntilFor: () => null,
			hubCacheModel: () => ({ columns: [], groups: [{ label: null, rows }] }),
		});
		const host = window.document.createElement('div');
		window.document.body.append(host);
		const view = new NearbyGlancableView({} as QueryController, host, plugin);
		(view as unknown as { renderBody(): void }).renderBody();
		await settleOwnCards(host, 3);
		assert.equal(host.querySelector('.rv-locator-card')?.getAttribute('data-rv-path'), 'People/Red Lane.md');
		(plugin as unknown as { nearbySort: { property: string; direction: 'ASC' | 'DESC' } }).nearbySort = {
			property: URGENCY_COLUMN_ID,
			direction: 'ASC',
		};
		bucket.refresh?.();
		await settleOwnCards(host, 3);
		const painted = [...host.querySelectorAll('.rv-locator-card')].map((card) => card.getAttribute('data-rv-path'));
		assert.deepEqual(painted, orderFor('ASC'));
		host.remove();
		clearGlanceHold();
	});

	it('writes the New RV file when Create is tapped', async () => {
		const notices: string[] = [];
		(globalThis as { __rvNotice?: (message: string) => void }).__rvNotice = (message) => { notices.push(message); };
		const content = window.document.createElement('div');
		window.document.body.append(content);
		let identity: NewRvIdentity | null = null;
		const modal = new NewRvIdentityModal({} as never, {
			defaultPriority: 4,
			companions: [],
			publications: [],
			media: [],
			lessons: [],
		}, (value) => { identity = value; });
		const live = modal as unknown as { contentEl: HTMLElement };
		live.contentEl = content;
		modal.open();
		const name = content.querySelector<HTMLInputElement>('input[placeholder="Optional (e.g. Maria)"]');
		const address = content.querySelector<HTMLInputElement>('input[placeholder="Required (e.g. 123 Oak St)"]');
		const woman = content.querySelector<HTMLButtonElement>('[data-gender="Woman"]');
		const create = [...content.querySelectorAll('button')].find((button) => button.textContent?.includes('Create'));
		assert.ok(name && address && woman && create);
		name.value = 'Smoke Eleven';
		name.dispatchEvent(new window.Event('input', { bubbles: true }));
		address.value = '11 Dark St';
		address.dispatchEvent(new window.Event('input', { bubbles: true }));
		woman.click();
		create.click();
		assert.equal(identity?.name, 'Smoke Eleven');
		assert.equal(identity?.address, '11 Dark St');
		assert.equal(notices.length, 0);
		const files = new Map<string, string>();
		const template = Object.assign(new TFile(), { path: 'Templates/99 New RV.md' });
		const written = await createdNewRvFile(async () => {
			const path = 'People/Smoke Eleven.md';
			files.set(path, identity?.name ?? '');
			return Object.assign(new TFile(), { path, basename: 'Smoke Eleven' });
		}, template);
		assert.ok(written instanceof TFile);
		assert.equal(written.path, 'People/Smoke Eleven.md');
		assert.equal(files.get('People/Smoke Eleven.md'), 'Smoke Eleven');
		assert.match(source('src/main.ts'), /createdNewRvFile\(/);
		content.remove();
		delete (globalThis as { __rvNotice?: (message: string) => void }).__rvNotice;
	});
});

async function settleOwnCards(root: ParentNode, count: number): Promise<void> {
	for (let turn = 0; turn < 40; turn += 1) {
		const cards = root.querySelectorAll('.rv-locator-card');
		if (cards.length >= count && !root.querySelector('.is-stub')) return;
		await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
	}
	throw new Error(`cards stayed at ${root.querySelectorAll('.rv-locator-card').length}`);
}

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
	it('paints vault-cache cards before Bases and patches one changed card', async () => {
		clearGlanceHold();
		let address = '1800 N Orange Ave, Orlando, FL';
		const bucket = { refresh: null as (() => void) | null };
		const parent = window.document.createElement('div');
		window.document.body.append(parent);
		const plugin = glancePlugin(bucket, {
			hubCacheModel: () => daleCache(address),
		});
		new NearbyGlancableView({} as QueryController, parent, plugin);
		await settleOwnCards(parent, 1);
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
		const openHook = main.slice(main.indexOf('proto.openFile = function'), main.indexOf('proto.setViewState = function'));
		assert.ok(openHook.indexOf('holdLeafForHubPaint') >= 0 && openHook.indexOf('holdLeafForHubPaint') < openHook.indexOf('openFile.call'));
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
			assert.equal(cover.querySelector('.rv-bar-spacer, .rv-app-slot'), null);
			assert.ok(cover.querySelector('.rv-locator-sortbar'));
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
		assert.equal(css.match(/--rv-hub-top:\s*calc\(env\(safe-area-inset-top, 0px\) \+ 6px\)/g)?.length, 1);
		assert.match(css, /\.markdown-preview-view\.rv-locator-full-base,\s*\n\.markdown-reading-view\.rv-locator-full-base \{\s*--view-top-spacing-markdown: env\(safe-area-inset-top, 0px\);\s*padding-top: var\(--rv-hub-top\) !important;\s*\}/);
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
		assert.match(css, /\.modal\.rv-locator-modal button\.rv-age-symbol \{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--rv-menu-ink\) !important;/);
		assert.match(css, /\.modal\.rv-locator-modal button\.rv-age-symbol \{[^}]*color:\s*var\(--rv-menu-ink\) !important;/);
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
		assert.match(css, /input\.rv-study-slider\[type="range"\]::-webkit-slider-thumb \{[^}]*background:\s*var\(--rv-menu-ink\);/);
		assert.match(css, /input\.rv-study-slider\[type="range"\]::-moz-range-thumb \{[^}]*background:\s*var\(--rv-menu-ink\);/);
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

describe('RV-B83 the bar follows the window', () => {
	it('rewrites the viewport height on resize and does not keep a pixel embed height', () => {
		const frame = source('src/glancable-view.ts');
		const embed = frame.slice(frame.indexOf('private sizeEmbedFrame'), frame.indexOf('private bindHubHandle'));
		assert.match(embed, /embedCapCss\(\)/);
		assert.match(embed, /removeProperty\('height'\)/);
		assert.match(embed, /removeProperty\('max-height'\)/);
		assert.doesNotMatch(embed, /setProperty\('height'/);
		const main = source('src/main.ts');
		const band = main.slice(main.indexOf('private bindViewportBand'), main.indexOf('registerEmbedRefit'));
		assert.match(band, /addEventListener\('resize', apply\)/);
		assert.match(band, /visualViewport\?\.addEventListener\('resize', apply\)/);
		assert.match(band, /visualViewport\?\.addEventListener\('scroll', apply\)/);
		assert.match(source('styles.css'), /\.is-embed-capped \{[^}]*height:\s*var\(--rv-embed-cap\) !important/);
		const doc = window.document;
		writeViewportHeight(doc, 520);
		assert.equal(doc.documentElement.style.getPropertyValue('--rv-vvh'), '520px');
		writeViewportHeight(doc, 794);
		assert.equal(doc.documentElement.style.getPropertyValue('--rv-vvh'), '794px');
		assert.equal(embedCapCss(), 'calc(var(--rv-vvh, 100dvh) - var(--rv-embed-top, 0px))');
		assert.equal(viewportHeightPx({ innerHeight: 794, visualViewport: { height: 520 } }), 520);
		assert.equal(viewportHeightPx({ innerHeight: 794, visualViewport: { height: 0 } }), 794);
		const bar = window.document.createElement('div');
		const spacer = window.document.createElement('div');
		window.document.body.append(bar, spacer);
		const place = (inner: number): void => {
			const embedTop = 48;
			const barPx = 52;
			const cap = inner - embedTop;
			spacer.getBoundingClientRect = () => ({
				top: embedTop + cap - barPx,
				left: 0,
				width: 379,
				height: barPx,
				bottom: inner,
				right: 379,
				x: 0,
				y: embedTop + cap - barPx,
				toJSON() { return {}; },
			}) as DOMRect;
			placeBarOver(bar, spacer);
			assert.equal(Math.round(parseFloat(bar.style.top) + barPx), inner);
		};
		place(520);
		place(794);
		place(379);
	});
});

describe('RV-B84 hub chrome uses the lowest urgency', () => {
	it('paints the hub map tab with the active palette band 0 and keeps urgency hexes in the palette', () => {
		const css = source('styles.css');
		assert.match(css, /\.rv-bar-shell:not\(\.is-note\)[\s\S]*?--interactive-accent:\s*var\(--rv-hub-accent\);/);
		assert.doesNotMatch(css, /var\(--rv-hub-accent,\s*#/);
		assert.doesNotMatch(css, /var\(--rv-urgency-accent,\s*#/);
		const hexes = new Set<string>();
		for (const palette of URGENCY_PALETTES) {
			for (const color of palette.colors) {
				if (color.startsWith('#')) hexes.add(color.toLowerCase());
			}
		}
		for (const color of defaultUrgencyColors()) hexes.add(color.toLowerCase());
		const files = readdirSync('src').filter((name) => name.endsWith('.ts') && name !== 'urgency-palette.ts');
		for (const name of files) {
			const text = readFileSync(`src/${name}`, 'utf8').toLowerCase();
			for (const hex of hexes) assert.equal(text.includes(hex), false, `${name} ${hex}`);
		}
		const sheet = css.toLowerCase();
		for (const hex of hexes) assert.equal(sheet.includes(hex), false, `styles.css ${hex}`);
		const paint = window.document.createElement('style');
		paint.textContent = '.rv-bar-shell:not(.is-note){--interactive-accent:var(--rv-hub-accent)}.rv-app-bar>.rv-app-slot.is-on{color:var(--interactive-accent)}';
		window.document.head.append(paint);
		const bar = createBarShell(window.document.body);
		bar.classList.remove('is-note');
		const map = bar.querySelector('.rv-bar-tab-map');
		assert.ok(map instanceof window.HTMLElement);
		map.classList.add('is-on');
		const cotton = hubAccentColor('cotton-candy', ['#111111', '#222222', '#333333', '#444444']);
		paintSurfaceAccent(bar, 'hub', cotton);
		const color = window.getComputedStyle(map).color.replace(/\s/g, '');
		assert.ok(color === 'rgb(20,172,135)' || color === '#14ac87', color);
		const traffic = hubAccentColor('default', ['#111111', '#222222', '#333333', '#444444']);
		paintSurfaceAccent(bar, 'hub', traffic);
		const next = window.getComputedStyle(map).color.replace(/\s/g, '');
		assert.ok(next === 'rgb(31,138,76)' || next === '#1f8a4c', next);
		paintSurfaceAccent(bar, 'note', '#d63c3c');
		assert.equal(window.getComputedStyle(map).color.replace(/\s/g, ''), 'rgb(214,60,60)');
		paintSurfaceAccent(bar, 'hub', traffic);
		assert.ok(window.getComputedStyle(map).color.replace(/\s/g, '') !== 'rgb(214,60,60)');
		assert.equal(bar.style.getPropertyValue('--rv-urgency-accent'), '');
		const note = window.document.createElement('div');
		const leaf = window.document.createElement('div');
		leaf.className = 'workspace-leaf-content';
		const workspace = window.document.createElement('div');
		workspace.className = 'workspace';
		leaf.append(note);
		workspace.append(leaf);
		window.document.body.append(workspace);
		const hosts = urgencyStyleHosts(note);
		assert.ok(hosts.includes(note));
		assert.ok(hosts.includes(leaf));
		assert.equal(hosts.includes(workspace), false);
		assert.equal(hosts.includes(window.document.body), false);
		assert.equal(hosts.includes(window.document.documentElement), false);
		paint.remove();
	});
});

describe('RV-B85 a return shades the card in the open turn', () => {
	it('paints through the target and keeps the shade when the card is replaced', () => {
		clearGlanceHold();
		const rows = Array.from({ length: 12 }, (_, index) => ({
			...sampleRow(),
			path: `People/Lane ${index}.md`,
			name: `Lane ${index}`,
		}));
		rememberGlanceGroups([{ label: null, rows }]);
		const parent = window.document.createElement('div');
		window.document.body.append(parent);
		const bucket = { refresh: null as (() => void) | null };
		const target = 'People/Lane 11.md';
		try {
			new NearbyGlancableView({} as QueryController, parent, glancePlugin(bucket, {
				peekHubArrival: () => target,
				takeHubArrival: () => target,
			}));
			const cards = parent.querySelectorAll('.rv-locator-card');
			assert.equal(cards.length, 12);
			const last = parent.querySelector('[data-rv-path="People/Lane 11.md"]');
			assert.ok(last instanceof window.HTMLElement);
			assert.equal(last.classList.contains('rv-card-land'), true);
			assert.equal(last.classList.contains('is-stub'), false);
		} finally {
			parent.remove();
			clearGlanceHold();
		}
		const glance = source('src/glancable-view.ts');
		const stub = glance.slice(glance.indexOf('private replaceStub'), glance.indexOf('private arrivalPaintCount'));
		assert.match(stub, /carryCardLand\(stub, fresh\)/);
		const main = source('src/main.ts');
		assert.doesNotMatch(main, /setTimeout\(\(\) => \{ this\.hubLinkOpen = false/);
		assert.match(main, /peekHubArrival\(\)/);
	});
});

describe('RV-B87 the return cover lands once', () => {
	it('does not chase a deep card, and history back keeps that card', () => {
		const choice = hubReturnChoice({ linkOpen: false, arrival: null, fromNotePath: 'People/Yellow Lane.md' });
		assert.deepEqual(choice, { arrival: 'People/Yellow Lane.md', listAtTop: false });
		assert.deepEqual(hubReturnChoice({ linkOpen: true, arrival: 'People/Yellow Lane.md', fromNotePath: 'People/Yellow Lane.md' }), {
			arrival: 'People/Yellow Lane.md',
			listAtTop: false,
		});
		assert.deepEqual(hubReturnChoice({ linkOpen: false, arrival: null, fromNotePath: null }), { arrival: null, listAtTop: true });
		const main = source('src/main.ts');
		const hook = main.slice(main.indexOf('proto.openFile = function'), main.indexOf('proto.setViewState = function'));
		assert.ok(hook.indexOf('hubReturnChoice') < hook.indexOf('noteDirectHubOpen()'));
		const historyAt = main.indexOf('proto.setViewState = function');
		const history = main.slice(historyAt, main.indexOf('this.register(() => {', historyAt));
		assert.match(history, /hubReturnChoice/);

		const cover = window.document.createElement('div');
		cover.className = 'rv-hub-swap-cover';
		const body = window.document.createElement('div');
		body.className = 'rv-hub-snapshot-body';
		const coverCard = window.document.createElement('div');
		coverCard.className = 'rv-locator-card rv-card-land';
		coverCard.setAttribute('data-rv-path', 'People/Yellow Lane.md');
		coverCard.getBoundingClientRect = () => ({ top: 389, bottom: 470, left: 0, right: 379, width: 379, height: 81, x: 0, y: 389, toJSON() { return {}; } });
		body.append(coverCard);
		cover.append(body);
		const live = window.document.createElement('div');
		live.className = 'rv-locator-card';
		live.setAttribute('data-rv-path', 'People/Yellow Lane.md');
		live.getBoundingClientRect = () => ({ top: 2807, bottom: 2888, left: 0, right: 379, width: 379, height: 81, x: 0, y: 2807, toJSON() { return {}; } });
		window.document.body.append(cover, live);
		alignHubCover(window.document);
		assert.equal(body.style.transform, '');
		cover.remove();
		live.remove();

		const scroll = window.document.createElement('div');
		scroll.className = 'rv-locator-scroll';
		let scrollTop = 0;
		const card = window.document.createElement('div');
		card.className = 'rv-locator-card';
		card.setAttribute('data-rv-path', 'People/Yellow Lane.md');
		scroll.append(card);
		scroll.getBoundingClientRect = () => ({ top: 48, bottom: 700, left: 0, right: 379, width: 379, height: 652, x: 0, y: 48, toJSON() { return {}; } });
		card.getBoundingClientRect = () => ({ top: 48 + 2400 - scrollTop, bottom: 48 + 2481 - scrollTop, left: 0, right: 379, width: 379, height: 81, x: 0, y: 0, toJSON() { return {}; } });
		Object.defineProperty(scroll, 'clientHeight', { configurable: true, get: () => 652 });
		Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => 652 });
		Object.defineProperty(scroll, 'scrollTop', { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } });
		const blocked = landingScrollExact(scroll, card, 389);
		assert.equal(blocked.reaches, false);
		assert.equal(blocked.scroll, 0);
		Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => 3200 });
		const open = landingScrollExact(scroll, card, 389);
		assert.equal(open.reaches, true);
		scroll.scrollTop = open.scroll;
		assert.ok(Math.abs(card.getBoundingClientRect().top - 389) <= 2);
		scroll.remove();
	});

	it('treats the window bar as the dock and waits until the live card can land', () => {
		window.document.querySelectorAll('.rv-bar-shell').forEach((node) => node.remove());
		const leaf = hubLeaf('Return Visits');
		paintHub(leaf, true);
		placeDock(leaf, 40);
		window.document.body.append(leaf);
		const bar = window.document.createElement('div');
		bar.className = 'rv-bar-shell';
		try {
		assert.equal(hubFrameReady(leaf, true), false);
		bar.getBoundingClientRect = () => ({ top: 742, bottom: 794, left: 0, right: 379, width: 379, height: 52, x: 0, y: 742, toJSON() { return {}; } });
		window.document.body.append(bar);
		assert.equal(hubFrameReady(leaf, true), true, 'the window bar is the dock');
		const cover = window.document.createElement('div');
		cover.className = 'rv-hub-swap-cover';
		const coverCard = window.document.createElement('div');
		coverCard.className = 'rv-locator-card rv-card-land';
		coverCard.setAttribute('data-rv-path', 'People/Yellow Lane.md');
		coverCard.getBoundingClientRect = () => ({ top: 389, bottom: 470, left: 0, right: 379, width: 379, height: 81, x: 0, y: 389, toJSON() { return {}; } });
		cover.append(coverCard);
		leaf.append(cover);
		assert.equal(hubFrameReady(leaf, true), false, 'the target card is not in the live list yet');
		const scroll = window.document.createElement('div');
		scroll.className = 'rv-locator-scroll';
		const live = window.document.createElement('div');
		live.className = 'rv-locator-card';
		live.setAttribute('data-rv-path', 'People/Yellow Lane.md');
		scroll.append(live);
		leaf.append(scroll);
		let scrollTop = 0;
		scroll.getBoundingClientRect = () => ({ top: 48, bottom: 700, left: 0, right: 379, width: 379, height: 652, x: 0, y: 48, toJSON() { return {}; } });
		live.getBoundingClientRect = () => ({ top: 48 + 2400 - scrollTop, bottom: 129, left: 0, right: 379, width: 379, height: 81, x: 0, y: 0, toJSON() { return {}; } });
		Object.defineProperty(scroll, 'clientHeight', { configurable: true, get: () => 652 });
		Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => 652 });
		Object.defineProperty(scroll, 'scrollTop', { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } });
		assert.equal(hubFrameReady(leaf, true), false, 'a clamped scroll is not a landing');
		Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => 3200 });
		assert.equal(hubFrameReady(leaf, true), true);
		coverCard.classList.add('rv-card-land');
		let landed = '';
		assert.equal(handoffCoverLanding(window.document, (path) => { landed = path; }), true);
		assert.equal(landed, 'People/Yellow Lane.md');
		assert.ok(Math.abs(live.getBoundingClientRect().top - 389) <= 2);
		assert.equal(live.classList.contains('rv-card-land'), true);
		} finally {
			bar.remove();
			leaf.remove();
		}
	});
});

describe('RV-B88 the open does not measure every badge', () => {
	it('strokes the rings from the document cache and shows the snapshot before the cover', () => {
		clearBadgeStrokeCache();
		const first = window.document.createElement('button');
		first.className = 'rv-locator-urgency';
		const ring = window.document.createElementNS('http://www.w3.org/2000/svg', 'circle');
		first.append(ring);
		window.document.body.append(first);
		pinBadgeStroke(first);
		const real = window.getComputedStyle.bind(window);
		let reads = 0;
		const added: HTMLElement[] = [];
		window.getComputedStyle = ((elt: Element) => {
			reads += 1;
			return real(elt);
		}) as typeof window.getComputedStyle;
		try {
			for (let index = 0; index < 8; index += 1) {
				const badge = window.document.createElement('button');
				badge.className = 'rv-locator-urgency';
				const mark = window.document.createElementNS('http://www.w3.org/2000/svg', 'circle');
				badge.append(mark);
				window.document.body.append(badge);
				added.push(badge);
				pinBadgeStroke(badge);
			}
			assert.equal(reads, 0);
		} finally {
			window.getComputedStyle = real;
			clearBadgeStrokeCache();
			first.remove();
			for (const badge of added) badge.remove();
		}
		const glance = source('src/glancable-view.ts');
		const stroke = glance.slice(glance.indexOf('function paintRingStroke'), glance.indexOf('export type BadgeIconName'));
		assert.doesNotMatch(stroke, /getComputedStyle/);
		const coverSource = source('src/hub-cover.ts');
		const build = coverSource.slice(coverSource.indexOf('const noteClone'), coverSource.indexOf('cover.addEventListener'));
		assert.ok(build.indexOf('cover.appendChild(noteClone)') < build.indexOf('park()'));
		assert.ok(build.indexOf('park()') < build.indexOf('options.mount'));
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

describe('RV-B89 attempt log bullet and padding', () => {
	it('hides Obsidian’s list bullet and pads the nested title and content', () => {
		const css = source('styles.css');
		assert.match(css, /\.callout\.rv-locator-attempt-log li::before \{[^}]*content:\s*'•'/);
		assert.match(css, /\.callout\.rv-locator-attempt-log \.list-bullet::after \{[^}]*display:\s*none !important/);
		const nested = css.slice(
			css.indexOf('.rv-dashboard .callout.rv-locator-return-suggestions .callout.rv-locator-attempt-log > .callout-content'),
			css.indexOf('.rv-dashboard .callout.rv-locator-return-suggestions .callout.rv-locator-attempt-log :is(ul, ol)'),
		);
		assert.match(nested, /padding-left:\s*12px !important/);
		assert.doesNotMatch(nested, /padding-left:\s*0 !important/);
		assert.match(css, /\.callout\.rv-locator-attempt-log :is\(ul, ol\) \{[^}]*padding-left:\s*0 !important/);
		assert.doesNotMatch(css, /margin-left:\s*-12px/);
	});
});

describe('RV-B90 hub return does not shift', () => {
	it('shares the header box, hides cover controls, and sorts the cover with the active sort', () => {
		const css = source('styles.css');
		const header = css.slice(
			css.indexOf('.workspace-leaf > .rv-hub-swap-cover > .view-header {'),
			css.indexOf('.rv-hub-snapshot-body {'),
		);
		assert.match(header, /position:\s*relative !important/);
		assert.doesNotMatch(header, /height:\s*var\(--header-height\)/);
		assert.doesNotMatch(header, /min-height:\s*var\(--header-height\)/);
		assert.match(header, /\.workspace-leaf > \.rv-hub-swap-cover > \.view-header :is\([\s\S]*button[\s\S]*display:\s*none !important/);
		const land = css.slice(css.indexOf('.theme-dark .rv-locator-card.rv-card-land'), css.indexOf('.theme-light .rv-locator-card.rv-card-land'));
		assert.match(land, /--rv-land:\s*rgba\(255, 255, 255, 0\.09\)/);
		assert.doesNotMatch(land, /outline:\s*1px/);

		const hubBar = css.slice(
			css.indexOf('.rv-locator-glancable.is-hub-map.is-stacked:not(.is-map-fullscreen) > .rv-locator-sortbar {'),
			css.indexOf('.rv-locator-glancable.is-stacked .rv-locator-sortbar {'),
		);
		const noteBar = css.slice(
			css.indexOf('.workspace-leaf-content.is-rv-note.is-note-map > .rv-bar-spacer {'),
			css.indexOf('.workspace-leaf-content.is-rv-note.is-note-map.is-note-map-side > .rv-bar-spacer {'),
		);
		assert.match(hubBar, /padding:\s*0/);
		assert.match(hubBar, /gap:\s*0/);
		assert.match(hubBar, /height:\s*var\(--rv-bar-band\)/);
		assert.match(noteBar, /height:\s*var\(--rv-bar-band\)/);
		assert.equal(css.match(/--rv-bar-band:\s*calc\(52px \+ env\(safe-area-inset-bottom, 0px\)\)/g)?.length, 1);

		const main = source('src/main.ts');
		const surface = main.slice(main.indexOf('glanceSurfacePath(surface: HTMLElement)'), main.indexOf('private pathForSurface'));
		assert.match(surface, /closest\('\.rv-hub-swap-cover'\)/);
		assert.match(surface, /coverHubPath/);
		assert.match(main, /hubCoverOptions\(file\.basename, file\.path\)/);
		const nearby = source('src/nearby-view.ts');
		const cached = nearby.slice(nearby.indexOf('protected loadCachedModel'), nearby.indexOf('protected adoptHeldGlance'));
		assert.match(cached, /this\.groups = this\.rankedGroups\(\)/);
		const glance = source('src/glancable-view.ts');
		const opening = glance.slice(glance.indexOf('private openingRows'), glance.indexOf('private paintStubCard'));
		assert.doesNotMatch(opening, /rankedGroups|sortedGroups/);

		clearGlanceHold();
		const later = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
		const people: Array<[string, number]> = [
			['Eve Carter', 40],
			['Red Lane', 90],
			['Alpha Snooze', 200],
		];
		const rows = people.map(([name, days]) => ({
			...sampleRow(),
			path: `People/${name}.md`,
			name,
			cells: [
				{ id: 'note.priority', text: '3', title: 'Priority', kind: 'text' as const, numeric: true },
				{ id: 'note.last spoke', text: 'spoke', title: 'Last Spoke', kind: 'text' as const, numeric: false, daysSince: days },
			],
		}));
		const settings = { ...DEFAULT_SETTINGS, distanceTest: true };
		const expected = sortRowsBy(
			rows.map((row) => annotateRowScores(
				row,
				null,
				settings,
				null,
				new Date(),
				row.path.endsWith('Alpha Snooze.md') ? later : null,
			)),
			[{ property: URGENCY_COLUMN_ID, direction: 'DESC' }],
			null,
			DISTANCE_COLUMN_ID,
		).map((row) => row.path);
		assert.equal(expected[0], 'People/Red Lane.md');
		assert.equal(expected[expected.length - 1], 'People/Alpha Snooze.md');
		const plugin = glancePlugin({ refresh: null }, {
			nearbySort: { property: URGENCY_COLUMN_ID, direction: 'DESC' },
			settings,
			snoozeUntilFor: (path: string) => path.endsWith('Alpha Snooze.md') ? later : null,
			hubCacheModel: () => ({ columns: [], groups: [{ label: null, rows }] }),
			glanceSurfacePath(surface: HTMLElement) {
				if (surface?.closest?.('.rv-hub-swap-cover')) return 'Hubs/Return Visits.md';
				return 'Hubs/Return Visits.md';
			},
		});
		const cover = window.document.createElement('div');
		cover.className = 'rv-hub-swap-cover';
		const coverHost = window.document.createElement('div');
		cover.append(coverHost);
		const liveHost = window.document.createElement('div');
		window.document.body.append(cover, liveHost);
		new NearbyGlancableView({} as QueryController, coverHost, plugin);
		clearGlanceHold();
		new NearbyGlancableView({} as QueryController, liveHost, plugin);
		const painted = (host: HTMLElement) => [...host.querySelectorAll('.rv-locator-card')].map((card) => card.getAttribute('data-rv-path'));
		const coverPaths = painted(coverHost);
		const livePaths = painted(liveHost);
		assert.deepEqual(coverPaths, expected);
		assert.deepEqual(livePaths, expected);
		assert.notDeepEqual(coverPaths, rows.map((row) => row.path));
		cover.remove();
		liveHost.remove();
		clearGlanceHold();
	});
});

describe('RV-265 hub search uses name and properties', () => {
	it('ANDs gender, decade, status, and exact age, and leaves in-note find on the body', () => {
		const woman = { name: 'Ada', gender: 'Woman', status: 'Study', age: 34 };
		const man = { name: 'Ben', gender: 'Man', status: 'Active', age: 34 };
		const older = { name: 'Cara', gender: 'Woman', status: 'Study', age: 41 };
		const exact = { name: 'Dee', gender: 'Woman', status: 'Inactive', age: 15 };
		assert.equal(matchesHubSearch(woman, 'woman 30s study'), true);
		assert.equal(matchesHubSearch(man, 'woman 30s study'), false);
		assert.equal(matchesHubSearch(older, 'woman 30s study'), false);
		assert.equal(matchesHubSearch(man, 'male'), true);
		assert.equal(matchesHubSearch(woman, 'female'), true);
		assert.equal(matchesHubSearch(exact, '15'), true);
		assert.equal(matchesHubSearch(woman, '15'), false);
		assert.equal(matchesHubSearch(woman, 'man'), false);
		assert.equal(matchesHubSearch({ name: 'Lane Woman', gender: 'Man', status: 'Active', age: 40 }, 'woman'), false);
		assert.equal(matchesHubSearch(woman, 'ada'), true);
		assert.equal(matchesHubSearch(exact, 'inactive'), true);

		clearGlanceHold();
		const rows = [woman, man, older].map((person) => ({
			...sampleRow(),
			path: `People/${person.name}.md`,
			name: person.name,
			gender: person.gender,
			status: person.status,
		}));
		const plugin = glancePlugin({ refresh: null }, {
			noteFrontmatter: (path: string) => {
				const person = [woman, man, older].find((item) => path.endsWith(`${item.name}.md`));
				if (!person) return null;
				return { Age: person.age, Gender: person.gender, Status: person.status, Notes: 'a man stopped by the study' };
			},
			hubCacheModel: () => ({ columns: [], groups: [{ label: null, rows }] }),
		});
		const host = window.document.createElement('div');
		window.document.body.append(host);
		const view = new NearbyGlancableView({} as QueryController, host, plugin);
		(view as unknown as { openGlanceSearch(): void }).openGlanceSearch();
		const input = host.querySelector('.rv-locator-search-input');
		assert.ok(input instanceof window.HTMLInputElement);
		assert.equal(input.parentElement?.classList.contains('rv-suggest-host'), true);
		assert.equal(host.querySelector('.rv-locator-search > button.rv-suggest-chevron') instanceof window.HTMLButtonElement, true);
		input.value = 'woman 30s study';
		input.dispatchEvent(new window.Event('input'));
		const shown = [...host.querySelectorAll('.rv-locator-card')].map((card) => card.getAttribute('data-rv-path'));
		assert.deepEqual(shown, ['People/Ada.md']);
		host.remove();
		clearGlanceHold();

		const note = window.document.createElement('div');
		note.textContent = 'a man stopped by the study';
		window.document.body.append(note);
		assert.equal(revealNoteMatch(note, 'man', 0), 0);
		assert.match(note.textContent ?? '', /man/);
		note.remove();
		const glance = source('src/glancable-view.ts');
		assert.doesNotMatch(glance.slice(glance.indexOf('private openingRows'), glance.indexOf('private paintStubCard')), /matchesGlanceQuery|loadSearchBodies/);
		assert.match(source('src/note-hub-bar.ts'), /function revealNoteMatch/);
	});
});

describe('RV-266 modal cancel is the left button', () => {
	it('puts Cancel first, hides the X when a footer exists, and keeps Keep and Stay', () => {
		const css = source('styles.css');
		assert.match(css, /\.rv-locator-modal \.rv-modal-actions button\.rv-modal-cancel \{[^}]*border:\s*1px solid var\(--background-modifier-border\) !important/);
		assert.match(css, /\.modal\.rv-locator-modal:has\(\.rv-modal-actions\) \.modal-close-button/);
		assert.doesNotMatch(css, /\.prompt(?![^,{]*rv-modal-actions)[^{]*\.prompt-close-button \{[^}]*display:\s*none/);
		const snooze = source('src/score-modals.ts');
		const footer = snooze.slice(snooze.indexOf("createDiv('rv-modal-actions is-footer')"), snooze.indexOf('clear.disabled'));
		assert.ok(footer.indexOf("text: 'Cancel'") < footer.indexOf("text: 'Clear'"));
		assert.ok(footer.indexOf("text: 'Clear'") < footer.indexOf('Update'));
		assert.match(snooze, /setButtonText\('Stay'\)/);
		const override = source('src/override-modal.ts');
		const slot = override.slice(override.indexOf("setClass('rv-modal-actions')"), override.indexOf('No overrides'));
		assert.ok(slot.indexOf("setButtonText('Cancel')") < slot.indexOf("setButtonText('Avoid')"));
		assert.ok(slot.indexOf("setButtonText('Avoid')") < slot.indexOf("setButtonText('Try')"));
		const campaign = source('src/campaign-modal.ts');
		const start = campaign.slice(campaign.indexOf('else {'), campaign.indexOf('private paintEndFooter'));
		assert.ok(start.indexOf("text: 'Cancel'") < start.indexOf("text: 'Start campaign'"));
		assert.match(campaign, /text: 'Keep'/);
		const bulk = source('src/modals.ts');
		const geocode = bulk.slice(bulk.indexOf('Counting notes'), bulk.indexOf('private async refreshPreview'));
		assert.ok(geocode.indexOf("'Cancel'") < geocode.indexOf("setButtonText('Start')"));
		assert.match(geocode, /dismissLabel\?\.\('Stop'\)/);
		assert.match(geocode, /dismissLabel\?\.\('Cancel'\)/);
		assert.doesNotMatch(geocode, /setButtonText\('Close'\)/);
		const visits = bulk.slice(bulk.indexOf('Choose folder'), bulk.indexOf("export type VisitMenuAnswer"));
		assert.ok(visits.indexOf("'Cancel'") < visits.indexOf("setButtonText('Fill')"));
		const wizard = source('src/setup-wizard.ts');
		const step1 = wizard.slice(wizard.indexOf('private async renderHome'), wizard.indexOf('private renderColors'));
		assert.ok(step1.indexOf("setButtonText('Cancel')") < step1.indexOf("setButtonText('Save and continue')"));
		const step2 = wizard.slice(wizard.indexOf('private renderColors'), wizard.indexOf('private async saveColorsAndContinue'));
		assert.ok(step2.indexOf("setButtonText('Cancel')") < step2.indexOf("setButtonText('Save and continue')"));
	});
});

describe('RV-267 hub search matches the suggester field', () => {
	it('shares the input and clear-button rules with the suggester', () => {
		const css = source('styles.css');
		const fieldStart = css.indexOf('.rv-suggest-host > input,\n.rv-locator-modal .rv-suggest-host > input,\n.rv-locator-search > .rv-locator-search-input {');
		const field = css.slice(fieldStart, css.indexOf('.rv-suggest-host > .rv-suggest-panel', fieldStart));
		assert.match(field, /\.rv-locator-search > \.rv-locator-search-input \{/);
		assert.match(field, /height:\s*40px/);
		assert.match(field, /border:\s*1px solid var\(--background-modifier-border\)/);
		assert.match(field, /border-right-width:\s*0/);
		assert.match(field, /border-radius:\s*6px 0 0 6px/);
		assert.match(field, /\.rv-locator-search > button\.rv-suggest-chevron,/);
		assert.match(field, /\.rv-suggest-host > button\.rv-suggest-chevron \{[^}]*border-radius:\s*0 6px 6px 0/);
		assert.match(css, /\.theme-dark \.rv-locator-search > \.rv-locator-search-input,[\s\S]*?background:\s*#2a2a2a/);
		assert.match(css, /\.theme-dark \.rv-locator-search > button\.rv-suggest-chevron,[\s\S]*?border-color:\s*var\(--rv-modal-accent\) !important/);
		assert.doesNotMatch(field, /#1f8a4c|#14ac87|#d63c3c/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-search\.rv-suggest-host \{[^}]*--rv-modal-accent:\s*var\(--rv-hub-accent\)/);
		assert.match(css, /\.rv-suggest-host > input::placeholder,\s*\n\.rv-locator-search > \.rv-locator-search-input::placeholder \{[^}]*color:\s*var\(--text-faint\)/);
	});
});

describe('RV-B91 cover stops above the tab bar', () => {
	it('reserves the shared bar band and sits under the bar', () => {
		const css = source('styles.css');
		const cover = css.slice(
			css.indexOf('.workspace-leaf > .rv-hub-swap-cover {'),
			css.indexOf('.workspace-leaf > .rv-hub-swap-cover > .view-header'),
		);
		assert.match(cover, /bottom:\s*var\(--rv-bar-band\) !important/);
		assert.match(cover, /height:\s*auto !important/);
		assert.doesNotMatch(cover, /inset:\s*0 !important/);
		assert.doesNotMatch(cover, /height:\s*100% !important/);
		const bar = css.slice(css.indexOf('.rv-bar-shell {'), css.indexOf('.workspace-drawer {'));
		assert.match(bar, /z-index:\s*calc\(var\(--layer-cover, 5\) \+ 1\)/);
		assert.match(bar, /bottom:\s*0 !important/);
		assert.match(bar, /height:\s*var\(--rv-bar-band\) !important/);
		assert.match(cover, /z-index:\s*1 !important/);
		assert.match(cover, /pointer-events:\s*none !important/);
		const hubBar = css.slice(
			css.indexOf('.rv-locator-glancable.is-hub-map.is-stacked:not(.is-map-fullscreen) > .rv-locator-sortbar {'),
			css.indexOf('.rv-locator-glancable.is-stacked .rv-locator-sortbar {'),
		);
		assert.match(hubBar, /height:\s*var\(--rv-bar-band\)/);
	});
});

describe('RV-B92 map open keeps the hub top', () => {
	it('uses the full-base top pad for the open map and leaves a standalone base at inset 0', () => {
		const css = source('styles.css');
		const open = css.slice(
			css.indexOf('.rv-locator-glancable.is-hub-map.is-stacked:not(.is-map-fullscreen) {'),
			css.indexOf('.rv-locator-glancable.is-hub-map.is-stacked:not(.is-map-fullscreen) > .rv-locator-stage'),
		);
		assert.match(open, /inset:\s*0/);
		assert.match(open, /\.markdown-preview-view\.rv-locator-full-base \.rv-locator-glancable\.is-hub-map\.is-stacked:not\(\.is-map-fullscreen\)/);
		assert.match(open, /top:\s*var\(--rv-hub-top\)/);
		assert.equal(css.match(/--rv-hub-top:\s*calc\(env\(safe-area-inset-top, 0px\) \+ 6px\)/g)?.length, 1);
		assert.match(css, /padding-top:\s*var\(--rv-hub-top\) !important/);
		const standalone = open.slice(0, open.indexOf('.markdown-preview-view.rv-locator-full-base'));
		assert.doesNotMatch(standalone, /top:\s*var\(--rv-hub-top\)/);
	});
});

describe('RV-268 shared top band', () => {
	it('gives hub, base, note, and the cover one band and no title text', () => {
		const css = source('styles.css');
		assert.equal(css.match(/--rv-top-band:/g)?.length, 1);
		assert.match(css, /--rv-top-band:\s*calc\(var\(--view-header-top-offset, env\(safe-area-inset-top, 0px\)\) \+ max\(0px, \(var\(--header-height, 40px\) - \(var\(--font-ui-medium, 16px\) \* 1\.4\)\) \/ 2\)\)/);
		const band = css.slice(
			css.indexOf('.workspace-leaf-content.is-rv-app > .view-header,'),
			css.indexOf('.workspace-leaf-content.is-rv-app > .view-header :is(.view-header-title'),
		);
		assert.match(band, /\.workspace-leaf > \.rv-hub-swap-cover > \.view-header \{[^}]*height:\s*var\(--rv-top-band\) !important/);
		assert.match(band, /min-height:\s*var\(--rv-top-band\) !important/);
		const titleAt = css.indexOf('.workspace-leaf-content.is-rv-app > .view-header :is(.view-header-title, .view-header-title-container)');
		const title = css.slice(titleAt, css.indexOf('.view-header-nav-buttons,', titleAt));
		assert.match(title, /font-size:\s*0 !important/);
		const painted = css.slice(
			css.indexOf("content: 'Return Visits'"),
			css.indexOf('body.is-phone .workspace-leaf > .rv-hub-swap-cover > .view-header .view-header-title'),
		);
		assert.match(painted, /content:\s*none !important/);
		assert.match(css, /content:\s*'Return Visits'/);
		assert.doesNotMatch(band, /#1f8a4c|#14ac87|#d63c3c/);

		const dom = new JSDOM(`<!DOCTYPE html><html style="--header-height:40px;--font-ui-medium:16px"><head><style>${css}</style></head><body class="is-phone">
			<div class="workspace-leaf-content is-rv-app"><div class="view-header" id="hub"><div class="view-header-title">Return Visits</div></div></div>
			<div class="workspace-leaf-content is-rv-app"><div class="view-header" id="base"><div class="view-header-title">Base</div></div></div>
			<div class="workspace-leaf-content is-rv-app is-rv-note"><div class="view-header" id="note"><div class="view-header-title">Ada</div></div></div>
			<div class="workspace-leaf"><div class="rv-hub-swap-cover" id="cover"><div class="view-header" id="cover-header"><div class="view-header-title">Return Visits</div></div></div></div>
			<div class="rv-bar-shell" id="bar"></div>
		</body></html>`);
		const styleOf = (id: string) => dom.window.getComputedStyle(dom.window.document.getElementById(id)!);
		const heights = ['hub', 'base', 'note', 'cover-header'].map((id) => styleOf(id).height);
		assert.deepEqual(heights, ['var(--rv-top-band)', 'var(--rv-top-band)', 'var(--rv-top-band)', 'var(--rv-top-band)']);
		for (const id of ['hub', 'base', 'note', 'cover-header']) {
			const title = dom.window.document.getElementById(id)!.querySelector('.view-header-title');
			assert.equal(dom.window.getComputedStyle(title!).fontSize, '0px');
		}
		assert.equal(styleOf('cover').bottom, 'var(--rv-bar-band)');
		assert.equal(styleOf('cover').zIndex, '1');
		assert.match(styleOf('bar').zIndex, /calc\(var\(--layer-cover,\s*5\) \+ 1\)|^6$/);
	});
});

describe('RV-B91 round 2 the bar stays on screen during the cover', () => {
	it('draws no cover bar, pins the shell, and shares the hub top', () => {
		const css = source('styles.css');
		const nearby = source('src/nearby-view.ts');
		const paint = nearby.slice(nearby.indexOf('private paintGlancableTabs'), nearby.indexOf('private barSlot'));
		assert.ok(paint.indexOf("closest('.rv-hub-swap-cover')") < paint.indexOf('ensureBarSpacer(this.sortEl)'));
		assert.match(paint, /querySelector\(':scope > \.rv-bar-spacer'\)\?\.remove\(\)/);
		assert.match(css, /\.workspace-leaf > \.rv-hub-swap-cover \.rv-locator-sortbar,\s*\n\.workspace-leaf > \.rv-hub-swap-cover \.rv-bar-spacer \{[^}]*display:\s*none !important/);
		const shell = css.slice(css.indexOf('.rv-bar-shell {'), css.indexOf('.workspace-drawer {'));
		assert.match(shell, /bottom:\s*0 !important/);
		assert.match(shell, /top:\s*auto !important/);
		assert.match(shell, /height:\s*var\(--rv-bar-band\) !important/);
		assert.match(shell, /z-index:\s*calc\(var\(--layer-cover, 5\) \+ 1\)/);
		assert.match(css, /\.rv-map-shell \{[^}]*z-index:\s*var\(--layer-cover, 5\)/);
		assert.match(css, /\.workspace-drawer \{[^}]*z-index:\s*var\(--layer-sidedock, 10\)/);
		assert.match(css, /\.modal-container,\s*\n\.prompt \{[^}]*z-index:\s*var\(--layer-modal, 50\)/);
		assert.match(css, /\.notice,\s*\n\.notice-container \{[^}]*z-index:\s*var\(--layer-notice, 60\)/);
		assert.match(css, /\.menu,\s*\n\.suggestion-container \{[^}]*z-index:\s*var\(--layer-menu, 65\)/);
		assert.match(css, /\.modal-container:has\(\.modal\.rv-locator-modal\) \{[^}]*z-index:\s*80/);
		const main = source('src/main.ts');
		const place = main.slice(main.indexOf('private placeBarNow'), main.indexOf('private watchBarSpacer'));
		assert.match(place, /pinBarToScreen\(bar\)/);
		assert.doesNotMatch(place, /placeBarOver|visibleBarSpacer/);
		const snapshot = css.slice(css.indexOf('.rv-hub-snapshot-body {'), css.indexOf('.rv-hub-snapshot-body > .rv-locator-view'));
		assert.match(snapshot, /padding-top:\s*var\(--rv-hub-top\)/);
		assert.doesNotMatch(snapshot, /env\(safe-area-inset-top/);
		assert.equal(css.match(/--rv-hub-top:/g)?.length, 1);
		const coverSrc = source('src/hub-cover.ts');
		const align = coverSrc.slice(coverSrc.indexOf('export function alignHubCover'), coverSrc.indexOf('function copyScroll'));
		assert.doesNotMatch(align, /translateY|COVER_NUDGE_PX/);
		assert.match(align, /removeProperty\('transform'\)/);

		const dom = new JSDOM('<!doctype html><body></body>');
		const win = dom.window;
		globalThis.HTMLElement = win.HTMLElement;
		globalThis.Element = win.Element;
		const doc = win.document;
		const cover = doc.createElement('div');
		cover.className = 'rv-hub-swap-cover';
		const coverSpacer = doc.createElement('div');
		coverSpacer.className = 'rv-bar-spacer';
		cover.appendChild(coverSpacer);
		const liveSpacer = doc.createElement('div');
		liveSpacer.className = 'rv-bar-spacer';
		doc.body.append(cover, liveSpacer);
		const box = (top: number) => ({ top, bottom: top + 52, left: 0, right: 379, width: 379, height: 52, x: 0, y: top, toJSON() { return {}; } });
		coverSpacer.getBoundingClientRect = () => box(690);
		liveSpacer.getBoundingClientRect = () => box(742);
		assert.equal(visibleBarSpacer(doc), liveSpacer);
		liveSpacer.remove();
		assert.equal(visibleBarSpacer(doc), null);

		const bar = doc.createElement('div');
		bar.className = 'rv-bar-shell';
		doc.body.appendChild(bar);
		placeBarOver(bar, coverSpacer);
		assert.equal(bar.style.top, '690px');
		pinBarToScreen(bar);
		assert.equal(bar.style.top, 'auto');
		assert.equal(bar.style.bottom, '0px');
		assert.equal(bar.style.left, '0px');
		assert.equal(bar.style.height, '');

		const body = doc.createElement('div');
		body.className = 'rv-hub-snapshot-body';
		body.style.transform = 'translateY(12px)';
		const coverCard = doc.createElement('div');
		coverCard.className = 'rv-locator-card';
		coverCard.setAttribute('data-rv-path', 'People/Ada.md');
		coverCard.getBoundingClientRect = () => box(100);
		body.appendChild(coverCard);
		cover.appendChild(body);
		const live = doc.createElement('div');
		live.className = 'rv-locator-card';
		live.setAttribute('data-rv-path', 'People/Ada.md');
		live.getBoundingClientRect = () => box(112);
		doc.body.appendChild(live);
		alignHubCover(doc);
		assert.equal(body.style.transform, '');
	});

	it('gives the cover header its own rule so an Obsidian header height cannot win', () => {
		const css = source('styles.css');
		const at = css.indexOf('html body.is-mobile .workspace-leaf .workspace-leaf-content.is-rv-app > .view-header,\nhtml body.is-mobile .workspace-leaf > .rv-hub-swap-cover > .view-header {');
		assert.ok(at > 0);
		const rule = css.slice(at, css.indexOf('.workspace-leaf-content.is-rv-app > .view-header :is(.view-header-title', at));
		assert.match(rule, /height:\s*var\(--rv-top-band\) !important/);
		assert.match(rule, /min-height:\s*var\(--rv-top-band\) !important/);
		assert.match(rule, /max-height:\s*var\(--rv-top-band\) !important/);
		assert.match(rule, /padding-top:\s*0 !important/);
		assert.doesNotMatch(rule, /height:\s*var\(--header-height\)/);
	});
});

describe('RV-268 the note band matches the hub', () => {
	it('counts the status-bar inset once and drops the note file margin', () => {
		const css = source('styles.css');
		const note = css.slice(css.indexOf('html body.is-mobile .workspace-leaf .workspace-leaf-content.is-rv-app > .view-content {'));
		assert.match(note, /html body\.is-mobile \.workspace-leaf \.workspace-leaf-content\.is-rv-app > \.view-content \{[^}]*padding-top:\s*0 !important/);
		assert.match(note, /--file-margins-y:\s*0px;/);
		assert.match(note, /padding-top:\s*var\(--rv-hub-top\) !important/);
		assert.doesNotMatch(note.slice(0, note.indexOf('margin-top: 6px')), /calc\(\s*var\(--file-margins\)[^)]*var\(--rv-hub-top\)/);
		assert.match(note, /margin-top:\s*6px !important/);
		assert.match(css, /margin-top:\s*-5px !important/);
		assert.equal(glanceSnapToken(0, '1', '28px'), glanceSnapToken(0, '1', '28px'));
		assert.notEqual(glanceSnapToken(0, '1', '28px'), glanceSnapToken(12, '1', '28px'));
		assert.notEqual(glanceSnapToken(0, '1', '28px'), glanceSnapToken(0, '0.86', '24px'));
	});
});

describe('RV-B91 cover cards resnap when the scale or gutter settles', () => {
	it('applies density before the snap and skips only a matching token', () => {
		const view = source('src/glancable-view.ts');
		const frame = view.slice(view.indexOf('private scheduleGlanceFrame'), view.indexOf('private strokeHubRings'));
		assert.match(frame, /this\.settleGlanceLayout\(\)/);
		const settle = view.slice(view.indexOf('private settleGlanceLayout'), view.indexOf('private applyColumnSnap'));
		assert.ok(settle.indexOf('this.applyDensity()') < settle.indexOf('this.applyColumnSnap()'));
		assert.ok(settle.indexOf('this.applyColumnSnap()') < settle.indexOf('this.snapCardFrames()'));
		const snap = view.slice(view.indexOf('private snapCardFrames'), view.indexOf('private rememberScrollbar'));
		assert.match(snap, /el\.dataset\.rvSnapToken === token/);
		assert.match(snap, /el\.dataset\.rvSnapToken = token/);
		const gutter = view.slice(view.indexOf('private measureGutter'), view.indexOf('private liveListScroller'));
		assert.match(gutter, /rv-hub-swap-cover/);
		assert.match(gutter, /liveListScroller\(\)/);
		const memory = view.slice(view.indexOf('private rememberScrollbar'), view.indexOf('private measureGutter'));
		assert.match(memory, /rv-hub-swap-cover'\)\) return/);
		assert.notEqual(glanceSnapToken(0, '1', '28px'), glanceSnapToken(0, '1', '22px'));
	});
});
