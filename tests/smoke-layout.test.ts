import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { decorateAttemptLog, isLogCalloutTitle } from '../src/attempt-digest';
import { stampAgeCount } from '../src/dates';
import { applyLiveUrgency, decorateNoteChrome, type NoteChromeHost } from '../src/note-chrome';
import { shouldHideStatusBar } from '../src/status-bar';
import { refreshStampAgeLabels } from '../src/rv-note-view';
import { DEFAULT_SETTINGS } from '../src/types';
import { decorateVisitControls, rehoistVisitNotes } from '../src/visit-controls';
import { placeGlanceStage } from '../src/hub-layout';
import { ancestorTileBackground, RvMapView, tileReady, unloadedAncestorTile } from '../src/map-view';
import type { MapPin } from '../src/map-pins';
import { popupClearOfChrome } from '../src/map-pins';
import { coveredCampaignFor } from '../src/schedule';
import { maskStampText, maskTitleElement, rvDisplayTitle } from '../src/stamp-mask';
import { tileKey } from '../src/tile-index';
import { readFileSync } from 'node:fs';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
const hostGlobals = globalThis as typeof globalThis & Record<string, unknown>;
hostGlobals.window = window;
hostGlobals.document = window.document;
hostGlobals.HTMLElement = window.HTMLElement;
hostGlobals.HTMLInputElement = window.HTMLInputElement;
hostGlobals.HTMLAnchorElement = window.HTMLAnchorElement;
hostGlobals.Element = window.Element;
hostGlobals.Node = window.Node;
hostGlobals.NodeFilter = window.NodeFilter;
hostGlobals.Document = window.Document;
hostGlobals.requestAnimationFrame = window.requestAnimationFrame.bind(window);
hostGlobals.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

const proto = window.HTMLElement.prototype as HTMLElement & Record<string, (...args: never[]) => unknown>;
proto.addClass = function addClass(this: HTMLElement, cls: string) {
	this.classList.add(...cls.split(/\s+/).filter(Boolean));
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
proto.setAttr = function setAttr(this: HTMLElement, name: string, value: string) {
	this.setAttribute(name, value);
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

const LONG = 'Mon, 10:40am — Oct 6, 2025 · «book» «Enjoy Life Forever!—An Interactive Bible Course» · «film» «Why Study the Bible When Life Is Hard and Long» · «lesson» «01 How Can the Bible Help You Understand a Very Long Lesson Title»';

function chromeHost(frontmatter: Record<string, unknown>, writes: { count: number }): NoteChromeHost {
	return {
		frontmatter: () => frontmatter,
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
		setAddress: () => { writes.count += 1; },
		openMap: () => {},
		openCompanion: () => {},
		campaignMark: () => null,
		noteTitle: () => 'Long Titles',
		renameNote: () => {},
		mapOpen: () => false,
		ghostIcon: () => null,
	};
}

function visitRoot(headingText: string, note: string | null, logTitle: string): HTMLElement {
	const root = window.document.createElement('div');
	root.className = 'markdown-rendered rv-dashboard';
	root.innerHTML = `
		<h5>${headingText}</h5>
		${note == null ? '' : `<p>${note}</p>`}
		<div class="callout" data-callout="example">
			<div class="callout-title"><div class="callout-title-inner">Return Suggestions</div></div>
			<div class="callout-content">
				<div class="callout" data-callout="note">
					<div class="callout-title"><div class="callout-title-inner">${logTitle}</div></div>
					<div class="callout-content">
						<ul><li>Mon, 10:40am — Oct 6, 2025 — success — covered Convention</li></ul>
					</div>
				</div>
			</div>
		</div>`;
	return root;
}

describe('smoke layout', () => {
	it('accepts Log and Attempt Log as the same callout', () => {
		assert.equal(isLogCalloutTitle('Log'), true);
		assert.equal(isLogCalloutTitle('Attempt Log'), true);
		assert.equal(isLogCalloutTitle('Return Suggestions'), false);
	});

	it('keeps rendered ages as Nd', () => {
		const today = new Date(2026, 9, 11, 12, 0, 0);
		assert.equal(stampAgeCount('Mon, 10:40am — Oct 6, 2025 40 days ago', today), '370d');
		assert.equal(stampAgeCount('Sat, 10:40am — Oct 11, 2026 Today', today), '0d');
	});

	it('hides the status bar only for the note class or a standalone base', () => {
		assert.equal(shouldHideStatusBar(false, false, false), false);
		assert.equal(shouldHideStatusBar(false, true, false), false);
		assert.equal(shouldHideStatusBar(false, true, true), true);
		assert.equal(shouldHideStatusBar(true, false, false), true);
	});

	it('replaces the raw visit heading with one row, a note box, and a first campaign chip', () => {
		const root = visitRoot(LONG, 'Showed the video and started lesson 1.', 'Log');
		decorateAttemptLog(root);
		decorateVisitControls(root, () => 1, () => {});
		decorateVisitControls(root, () => 1, () => {});
		const heading = root.querySelector('h5');
		assert.ok(heading);
		const source = heading?.querySelector('.rv-stamp-source');
		assert.ok(source);
		assert.match(source?.textContent ?? '', /Enjoy Life Forever/);
		const visible = heading?.cloneNode(true) as HTMLElement;
		visible.querySelector('.rv-stamp-source')?.remove();
		assert.equal((visible.textContent ?? '').includes('2025'), false);
		assert.equal((visible.textContent ?? '').includes('«'), false);
		assert.match(visible.querySelector('.rv-stamp-when')?.textContent ?? '', /Mon, 10:40am/);
		assert.match(visible.querySelector('.rv-stamp-count')?.textContent ?? '', /^\d+d$/);
		assert.equal(heading?.querySelectorAll('.rv-stamp-row').length, 1);
		const box = heading?.nextElementSibling;
		assert.equal(box?.classList.contains('rv-visit-note-box'), true);
		const strip = box?.querySelector('.rv-item-strip');
		assert.equal(strip?.classList.contains('is-ghost'), false);
		const chips = strip?.querySelectorAll('.rv-item') ?? [];
		assert.equal(chips.length, 4);
		assert.match(chips[0]?.textContent ?? '', /Convention/);
		const types = strip?.querySelectorAll('.rv-type') ?? [];
		assert.ok(types.length >= 1);
		for (const type of Array.from(types)) assert.match(type.textContent ?? '', /^ (Video|Study)$/);
		assert.equal(box?.querySelector('p')?.textContent, 'Showed the video and started lesson 1.');
		assert.equal(root.querySelectorAll('.rv-item-strip').length, 1);
		assert.equal(root.querySelector('.callout[data-callout="note"]')?.classList.contains('rv-locator-attempt-log'), true);
		assert.ok(root.querySelector('.rv-log-covered'));
		assert.match(root.querySelector('.rv-locator-attempt-log li')?.textContent ?? '', /success —/);
		const today = new Date();
		refreshStampAgeLabels(root, today);
		assert.match(heading?.querySelector('.rv-stamp-count')?.textContent ?? '', /^\d+d$/);
		assert.equal((heading?.querySelector('.rv-stamp-count')?.textContent ?? '').includes('days'), false);
	});

	it('hoists the note box out of the heading wrapper and backfills a campaign chip from a separate log', () => {
		const preview = window.document.createElement('div');
		preview.className = 'markdown-preview-view';
		const headingHost = window.document.createElement('div');
		headingHost.className = 'el-h5';
		headingHost.innerHTML = `<h5>${LONG}</h5>`;
		const note = window.document.createElement('div');
		note.className = 'el-p';
		note.innerHTML = '<p>Showed the video and started lesson 1.</p>';
		const log = window.document.createElement('div');
		log.className = 'callout';
		log.dataset.callout = 'note';
		log.innerHTML = `<div class="callout-title"><div class="callout-title-inner">Log</div></div><div class="callout-content"><ul><li>Mon, 10:40am — Oct 6, 2025 — success — covered Convention</li></ul></div>`;
		preview.append(headingHost, note);
		decorateVisitControls(headingHost, () => 1, () => {});
		assert.equal(headingHost.nextElementSibling?.querySelector('.rv-item.is-campaign') ?? null, null);
		preview.append(log);
		decorateVisitControls(log, () => 1, () => {});
		const box = headingHost.nextElementSibling;
		assert.equal(box?.classList.contains('rv-visit-note-box'), true);
		assert.equal(box?.contains(note), true);
		assert.equal(box?.querySelector('.el-p p')?.textContent, 'Showed the video and started lesson 1.');
		const first = box?.querySelector('.rv-item-strip .rv-item');
		assert.equal(first?.classList.contains('is-campaign'), true);
		assert.match(first?.textContent ?? '', /Convention/);
		assert.equal(box?.contains(log), false);
	});

	it('pulls a live-preview note line into the same box as the strip', () => {
		const editor = window.document.createElement('div');
		editor.className = 'cm-editor';
		const line = window.document.createElement('div');
		line.className = 'cm-line';
		line.innerHTML = `<h5>${LONG}</h5>`;
		const note = window.document.createElement('div');
		note.className = 'cm-line';
		note.textContent = 'Showed the video and started lesson 1.';
		const log = window.document.createElement('div');
		log.className = 'callout';
		log.dataset.callout = 'note';
		log.innerHTML = `<div class="callout-title"><div class="callout-title-inner">Log</div></div><div class="callout-content"><ul><li>Mon, 10:40am — Oct 6, 2025 — success — covered Convention</li></ul></div>`;
		editor.append(line, note, log);
		decorateVisitControls(line, () => 1, () => {});
		decorateVisitControls(log, () => 1, () => {});
		const box = line.nextElementSibling;
		assert.equal(box?.classList.contains('rv-visit-note-box'), true);
		assert.equal(box?.contains(note), true);
		assert.match(box?.querySelector('.rv-item.is-campaign')?.textContent ?? '', /Convention/);
	});

	it('reparents a scroller when its previous stage is disconnected', () => {
		const root = window.document.createElement('div');
		window.document.body.appendChild(root);
		const scroll = window.document.createElement('div');
		const orphan = window.document.createElement('div');
		orphan.appendChild(scroll);
		const stage = placeGlanceStage(root, scroll, null);
		assert.equal(stage.parentElement, root);
		assert.equal(scroll.parentElement, stage);
		stage.remove();
		assert.equal(stage.isConnected, false);
		const again = placeGlanceStage(root, scroll, stage);
		assert.equal(again, stage);
		assert.equal(stage.parentElement, root);
		assert.equal(scroll.parentElement, stage);
		assert.equal(root.querySelectorAll('.rv-locator-stage').length, 1);
	});

	it('keeps a parent tile until the new tile has pixels, and zooms a stack from the floored zoom', () => {
		const srcs = new Map<string, string>([[tileKey(11, 1, 2), 'https://tiles.example/old.png']]);
		const parent = ancestorTileBackground(12, 3, 5, srcs);
		assert.equal(parent?.url, 'https://tiles.example/old.png');
		assert.equal(parent?.size, '200% 200%');
		assert.equal(ancestorTileBackground(12, 0, 0, new Map()), null);
		const img = window.document.createElement('img');
		img.classList.add('is-ready');
		assert.equal(tileReady(img), false);
		const map = readFileSync('src/map-view.ts', 'utf8');
		assert.match(map, /const buffer = 2/);
		assert.match(map, /is-holding/);
		assert.match(map, /if \(!visibleReady\) return;/);
		assert.match(map, /Math\.floor\(this\.zoom\)/);
		assert.match(map, /addEventListener\('pointerup'/);
		assert.match(map, /zoomToRevealPin\(zed\)/);
	});

	it('keeps a 5px ghost strip inside the note box when a visit has no items', () => {
		const root = visitRoot('Tue, 6:15pm — Aug 12, 2026', null, 'Attempt Log');
		decorateVisitControls(root, () => null, () => {});
		assert.equal(root.querySelector('.rv-stamp-when')?.textContent, 'Tue, 6:15pm');
		const strip = root.querySelector('.rv-item-strip');
		assert.equal(strip?.classList.contains('is-ghost'), true);
		assert.equal(strip?.parentElement?.classList.contains('rv-visit-note-box'), true);
		assert.equal(strip?.childElementCount, 0);
	});

	it('commits an address edit once when change and blur both fire', () => {
		const writes = { count: 0 };
		const root = window.document.createElement('div');
		root.innerHTML = `<div class="callout" data-callout="quote"><div class="callout-title"><div class="callout-title-inner">RV Dashboard</div></div><div class="callout-content"><p><strong>Hub:</strong> <strong>Address:</strong> <a href="#">🗺️</a></p></div></div>`;
		const data = {
			cssclasses: ['rv-dashboard'],
			Hub: ['[[Return Visits Hub]]'],
			Address: '10 Oak Hammock Ln',
			Status: 'Active',
			Priority: 1,
		};
		decorateNoteChrome(root, 'RVs/Long Titles.md', chromeHost(data, writes));
		const input = root.querySelector('input.rv-address-input');
		assert.ok(input instanceof window.HTMLInputElement);
		input.value = '11 Oak Hammock Ln';
		input.dispatchEvent(new window.Event('change'));
		input.dispatchEvent(new window.Event('blur'));
		assert.equal(writes.count, 1);
		const paragraph = root.querySelector('p.rv-hub-owned');
		assert.ok(paragraph?.querySelector('.rv-hub-add'));
		assert.ok(paragraph?.querySelector('a.rv-map-button'));
		assert.equal(paragraph?.querySelectorAll('.rv-map-button').length, 1);
	});

	it('hoists note sections that render before the heading, including a list, and again after a scroll re-render', () => {
		const preview = window.document.createElement('div');
		preview.className = 'markdown-preview-view';
		const sizer = window.document.createElement('div');
		sizer.className = 'markdown-preview-sizer';
		const headingSection = window.document.createElement('div');
		headingSection.className = 'markdown-preview-section';
		headingSection.innerHTML = `<div class="el-h5"><h5>${LONG}</h5></div>`;
		const first = window.document.createElement('div');
		first.className = 'markdown-preview-section';
		first.innerHTML = '<div class="el-p"><p>Showed the video and started lesson 1.</p></div>';
		const second = window.document.createElement('div');
		second.className = 'markdown-preview-section';
		second.innerHTML = '<div class="el-p"><p>Tuesday evenings work best for her.</p></div>';
		const list = window.document.createElement('div');
		list.className = 'markdown-preview-section';
		list.innerHTML = '<ul class="el-ul"><li>Keep going</li></ul>';
		sizer.append(headingSection, first, second, list);
		preview.append(sizer);
		decorateVisitControls(second, () => 4, () => {});
		decorateVisitControls(first, () => 3, () => {});
		decorateVisitControls(headingSection, () => 2, () => {});
		decorateVisitControls(list, () => 5, () => {});
		const box = headingSection.querySelector('.rv-visit-note-box');
		assert.ok(box);
		assert.equal(box?.contains(first), true);
		assert.equal(box?.contains(second), true);
		assert.equal(box?.contains(list), true);
		const paragraphs = box?.querySelectorAll('p') ?? [];
		assert.equal(paragraphs[0]?.textContent, 'Showed the video and started lesson 1.');
		assert.equal(paragraphs[1]?.textContent, 'Tuesday evenings work best for her.');
		assert.equal(box?.querySelector('li')?.textContent, 'Keep going');
		const fresh = window.document.createElement('div');
		fresh.className = 'markdown-preview-section';
		fresh.innerHTML = '<div class="el-p"><p>Showed the video and started lesson 1.</p></div>';
		sizer.append(fresh);
		decorateVisitControls(fresh, () => 6, () => {});
		assert.equal(box?.contains(fresh), true);
		assert.equal(box?.querySelector('.callout'), null);
	});

	it('hoists sibling paragraphs in the real preview sizer, including a paragraph that renders later', () => {
		const preview = window.document.createElement('div');
		preview.className = 'markdown-preview-view';
		const sizer = window.document.createElement('div');
		sizer.className = 'markdown-preview-sizer markdown-preview-section';
		const heading = window.document.createElement('div');
		heading.className = 'el-h5';
		heading.innerHTML = '<h5>Sun, 9:05am — Oct 11, 2026</h5>';
		sizer.append(heading);
		preview.append(sizer);
		decorateVisitControls(heading, () => 2, () => {}, () => 'Convention');
		const late = window.document.createElement('div');
		late.className = 'el-p';
		late.innerHTML = '<p>Showed the video and started lesson 1.</p>';
		const more = window.document.createElement('div');
		more.className = 'el-p';
		more.innerHTML = '<p>Tuesday evenings work best for her.</p>';
		const list = window.document.createElement('div');
		list.className = 'el-ul';
		list.innerHTML = '<ul><li>Keep going</li></ul>';
		sizer.append(late, more, list);
		rehoistVisitNotes(preview);
		const box = preview.querySelector('.rv-visit-note-box');
		assert.ok(box);
		assert.equal(box?.contains(late), true);
		assert.equal(box?.contains(more), true);
		assert.equal(box?.contains(list), true);
		assert.equal(box?.querySelector('.is-campaign')?.textContent?.includes('Convention'), true);
		assert.ok((box?.getBoundingClientRect().height ?? 0) >= 0);
		box?.remove();
		const fresh = window.document.createElement('div');
		fresh.className = 'el-p';
		fresh.innerHTML = '<p>Showed the video and started lesson 1.</p>';
		sizer.append(fresh);
		decorateVisitControls(preview, () => null, () => {}, () => 'Convention');
		const again = preview.querySelector('.rv-visit-note-box');
		assert.equal(again?.contains(fresh), true);
		assert.ok(again?.querySelector('.is-campaign'));
		const recycled = window.document.createElement('div');
		recycled.className = 'el-h5';
		recycled.innerHTML = '<h5 class="rv-visit-stamp"><span class="rv-stamp-row"><span class="rv-cal">OCT</span><span class="rv-stamp-when">Sun, 9:58am</span><span class="rv-stamp-count">0d</span></span><span class="rv-stamp-source">Sun, 9:58am — Oct 11, 2026</span></h5>';
		const recycledNote = window.document.createElement('div');
		recycledNote.className = 'el-p';
		recycledNote.innerHTML = '<p>Nobody answered.</p>';
		sizer.append(recycled, recycledNote);
		decorateVisitControls(preview, () => null, () => {}, () => '');
		const recycledBox = recycled.nextElementSibling;
		assert.equal(recycledBox?.classList.contains('rv-visit-note-box'), true);
		assert.equal(recycledBox?.contains(recycledNote), true);
	});

	it('paints the campaign chip from the note text when the Log is not in the DOM', () => {
		const markdown = [
			`##### ${LONG}`,
			'Showed the video.',
			'',
			'> [!note]- Log',
			'> - Mon, 10:40am — Oct 6, 2025 — success — covered Convention',
			'',
		].join('\n');
		const preview = window.document.createElement('div');
		preview.className = 'markdown-preview-view';
		const section = window.document.createElement('div');
		section.className = 'markdown-preview-section';
		section.innerHTML = `<div class="el-h5"><h5>${LONG}</h5></div>`;
		preview.append(section);
		const when = coveredCampaignFor(markdown, new Date(2025, 9, 6, 10, 40, 0, 0));
		assert.equal(when, 'Convention');
		const shared = [
			'##### Sun, 9:05am — Oct 11, 2026',
			'`INPUT[textArea:sVisit3Notes]`',
			'',
			'##### Sun, 9:05am — Oct 11, 2026',
			'`INPUT[textArea:sVisit1Notes]`',
			'',
			'> - Sun, 9:05am — Oct 11, 2026 — success — Alex',
			'> - Sun, 9:05am — Oct 11, 2026 — success — covered Convention',
		].join('\n');
		const stamp = new Date(2026, 9, 11, 9, 5, 0, 0);
		assert.equal(coveredCampaignFor(shared, stamp, 0), 'Convention');
		assert.equal(coveredCampaignFor(shared, stamp, 1), '');
		decorateVisitControls(section, () => 1, () => {}, () => 'Convention');
		const chip = section.querySelector('.rv-item.is-campaign');
		assert.ok(chip);
		assert.match(chip?.textContent ?? '', /Convention/);
		assert.equal(preview.querySelector('.callout'), null);
	});

	it('sets counter ink on the pill for each palette', () => {
		const root = window.document.createElement('div');
		root.className = 'markdown-preview-view';
		window.document.body.appendChild(root);
		window.document.body.classList.add('theme-light');
		const pill = window.document.createElement('span');
		pill.className = 'rv-stamp-count';
		pill.textContent = '370d';
		root.appendChild(pill);
		const host = chromeHost({
			Priority: 1,
			Status: 'Return visit',
			'Last Spoke': '2020-01-01T10:00:00',
		}, { count: 0 });
		applyLiveUrgency(root, 'RVs/Long Titles.md', { ...host, settings: { ...host.settings, urgencyPalette: 'default' } }, true);
		const traffic = pill.style.getPropertyValue('color');
		assert.equal(pill.style.getPropertyPriority('color'), 'important');
		assert.notEqual(traffic, '');
		applyLiveUrgency(root, 'RVs/Long Titles.md', { ...host, settings: { ...host.settings, urgencyPalette: 'sunset' } }, true);
		const sunset = pill.style.getPropertyValue('color');
		assert.equal(pill.style.getPropertyPriority('color'), 'important');
		assert.notEqual(sunset, traffic);
		root.remove();
	});

	it('finds a loaded ancestor ten zooms up and still returns null for an empty map', () => {
		const srcs = new Map<string, string>([[tileKey(2, 0, 0), 'https://tiles.example/far.png']]);
		const parent = ancestorTileBackground(12, 5, 7, srcs);
		assert.equal(parent?.url, 'https://tiles.example/far.png');
		assert.equal(ancestorTileBackground(12, 0, 0, new Map()), null);
		assert.match(unloadedAncestorTile(12, 5, 7)?.url ?? '', /tile\.openstreetmap\.org\/11\//);
		assert.equal(unloadedAncestorTile(0, 0, 0), null);
	});

	it('clamps a fullscreen card inside the visible window, not only the stage', () => {
		const low = popupClearOfChrome(
			{ x: 180, y: 40 },
			{ width: 280, height: 320 },
			{ width: 390, height: 900 },
			{ left: 0, top: 120, width: 390, height: 640 },
		);
		assert.equal(low.top >= 124, true);
		assert.equal(low.top + 320 <= 120 + 640, true);
		assert.equal(low.left >= 4, true);
		assert.equal(low.left + 280 <= 390 - 56, true);
	});

	it('zooms a count-4 stack at zoom 12 for mouse and touch on the hub map and the map leaf', () => {
		const card = {
			address: '10 Oak Hammock Ln',
			city: 'Orlando',
			study: false,
			spoke: '',
			attempted: '',
			studied: '',
			met: '',
			metWith: '',
			visits: '4',
			studyRatio: '',
			literature: '',
			media: '',
			lessons: [],
		};
		const pins: MapPin[] = [0, 1, 2, 3].map((index) => ({
			path: `RVs/pin-${index}.md`,
			name: index === 0 ? 'Avoid' : `Pin ${index}`,
			lat: 28.54,
			lon: -81.38,
			priority: 4 - index,
			urgency: 1,
			days: 10,
			color: '#d63c3c',
			glyph: '1',
			fresh: false,
			stateIcon: index === 0 ? 'ban' : null,
			shadeIcon: null,
			markText: null,
			rank: index,
			card,
		}));
		const host = {
			settings: { ...DEFAULT_SETTINGS, distanceTest: true },
			mapFocusPath: null,
			listMapPins: () => pins,
			openMapNote: () => {},
			openRoute: async () => {},
			currentMapFix: () => null,
			notifyPin: () => {},
		};
		const hasZoom = (root: HTMLElement, zoom: number): boolean => (
			[...root.querySelectorAll('img.rv-map-tile')].some((img) => img.getAttribute('src')?.includes(`/${zoom}/`) === true)
		);
		const tap = (root: HTMLElement, button: number): void => {
			const pin = root.querySelector('button.rv-map-pin');
			assert.ok(pin instanceof window.HTMLElement);
			assert.equal(pin.querySelector('.rv-pin-stack-count')?.textContent, '4');
			const point = { button, clientX: 20, clientY: 20, bubbles: true };
			pin.dispatchEvent(new window.MouseEvent('pointerdown', point));
			pin.dispatchEvent(new window.MouseEvent('pointerup', point));
			pin.dispatchEvent(new window.MouseEvent('click', point));
		};
		const open = (scope: 'hub' | 'split'): { root: HTMLElement; zoom: () => number; close: () => void } => {
			const root = window.document.createElement('div');
			window.document.body.appendChild(root);
			const map = Object.create(RvMapView.prototype) as RvMapView & { zoom: number; paint: () => void };
			map.contentEl = root;
			map.bindHost(host, scope);
			void map.onOpen();
			map.zoom = 12;
			map.paint();
			return { root, zoom: () => map.zoom, close: () => { void map.onClose(); root.remove(); } };
		};
		const hub = open('hub');
		assert.equal(hub.zoom(), 12);
		assert.equal(hasZoom(hub.root, 12), true);
		tap(hub.root, 0);
		assert.equal(hub.zoom(), 13);
		hub.close();
		const leaf = open('split');
		assert.equal(leaf.zoom(), 12);
		tap(leaf.root, -1);
		assert.equal(leaf.zoom(), 13);
		leaf.close();
	});

	it('hides the filename stamp in titles and keeps an end ellipsis for hub and address', () => {
		assert.equal(rvDisplayTitle('Maria on Lake Dr 2026-10-11 0905'), 'Maria on Lake Dr');
		assert.equal(rvDisplayTitle('Smoke Pair on Smoke Street 2026-10-11 1149 2'), 'Smoke Pair on Smoke Street 2');
		assert.equal(maskStampText('Maria on Lake Dr 2026-10-11 0905 - Vault', 'Maria on Lake Dr 2026-10-11 0905', 'Maria on Lake Dr'), 'Maria on Lake Dr - Vault');
		const header = window.document.createElement('div');
		header.className = 'view-header-title';
		header.textContent = 'Maria on Lake Dr 2026-10-11 0905';
		const inline = window.document.createElement('div');
		inline.className = 'inline-title';
		inline.append(window.document.createTextNode('Maria on Lake Dr 2026-10-11 0905'));
		const status = window.document.createElement('span');
		status.className = 'rv-note-status';
		status.textContent = 'Active';
		inline.append(status);
		const explorer = window.document.createElement('div');
		explorer.className = 'nav-file-title-content';
		explorer.textContent = 'Maria on Lake Dr 2026-10-11 0905';
		const search = window.document.createElement('div');
		search.className = 'search-result-file-title';
		search.textContent = 'Maria on Lake Dr 2026-10-11 0905';
		const suggestion = window.document.createElement('div');
		suggestion.className = 'suggestion-title';
		suggestion.textContent = 'Maria on Lake Dr 2026-10-11 0905';
		const pair = [{ stamped: 'Maria on Lake Dr 2026-10-11 0905', display: 'Maria on Lake Dr' }];
		maskTitleElement(header, pair);
		maskTitleElement(inline, pair);
		maskTitleElement(explorer, pair);
		maskTitleElement(search, pair);
		maskTitleElement(suggestion, pair);
		assert.equal(header.textContent, 'Maria on Lake Dr');
		assert.equal(inline.textContent, 'Maria on Lake Dr 2026-10-11 0905Active');
		assert.equal(explorer.textContent, 'Maria on Lake Dr 2026-10-11 0905');
		assert.equal(search.textContent, 'Maria on Lake Dr 2026-10-11 0905');
		assert.equal(suggestion.textContent, 'Maria on Lake Dr 2026-10-11 0905');
		const main = readFileSync('src/main.ts', 'utf8');
		assert.doesNotMatch(main, /nav-file-title-content|search-result-file-title|suggestion-title|file-explorer/);
		assert.doesNotMatch(main, /querySelector(?:All)?\([^)]*inline-title/);
		assert.match(main, /collisionSuffixOnly/);
		const script = readFileSync('extras/templater-metabind/newRv.js', 'utf8');
		assert.match(script, /alreadyStamped/);
		assert.match(script, /if \(alreadyStamped\)/);
		assert.match(script, /!alreadyStamped/);
		const chrome = readFileSync('src/note-chrome.ts', 'utf8');
		assert.match(chrome, /fitEndEllipsis\(link, text\)/);
		assert.match(chrome, /fitEndEllipsis\(label, full\)/);
		assert.doesNotMatch(chrome, /fitMiddleEllipsis/);
		const modals = readFileSync('src/visit-modals.ts', 'utf8') + readFileSync('src/modals.ts', 'utf8') + readFileSync('src/new-rv-modal.ts', 'utf8');
		assert.match(modals, /What publisher came with you\?/);
		assert.equal(modals.includes('Who came with you?'), false);
		const editor = readFileSync('src/visit-modals.ts', 'utf8');
		assert.match(editor, /is-miss-hidden/);
		const map = readFileSync('src/map-view.ts', 'utf8');
		assert.match(map, /resolvePaintedColor\(button, pin\.color/);
		assert.match(map, /event\.button > 0/);
		assert.match(map, /zoomToRevealPin\(zed\)/);
		assert.match(map, /rv-map-tile-back/);
		assert.match(map, /captureParentSettle/);
		const css = readFileSync('styles.css', 'utf8');
		assert.match(css, /\.rv-hub-line \{[^}]*grid-template-columns: max-content minmax\(0, 1fr\) 40px/s);
		assert.doesNotMatch(css, /Phone width: the label sits above/);
		assert.match(css, /grid-template-columns: subgrid/);
		assert.doesNotMatch(css, /display:\s*contents/);
		assert.match(css, /\.rv-item-strip\.is-two-line/);
		assert.match(css, /\.rv-locator-modal \.rv-study-toggle \{[^}]*border: 0 !important/s);
		assert.match(css, /position: sticky;\s*\n\tbottom: 0/);
	});

	it('zooms a stack from a touch pointer with a few pixels of jitter', () => {
		const card = {
			address: '10 Oak Hammock Ln',
			city: 'Orlando',
			study: false,
			spoke: '',
			attempted: '',
			studied: '',
			met: '',
			metWith: '',
			visits: '4',
			studyRatio: '',
			literature: '',
			media: '',
			lessons: [],
		};
		const pins: MapPin[] = [0, 1, 2, 3].map((index) => ({
			path: `RVs/jitter-${index}.md`,
			name: `Pin ${index}`,
			lat: 28.54,
			lon: -81.38,
			priority: 4,
			urgency: 1,
			days: 10,
			color: '#d63c3c',
			glyph: '1',
			fresh: false,
			stateIcon: null,
			shadeIcon: null,
			markText: null,
			rank: index,
			card,
		}));
		const root = window.document.createElement('div');
		window.document.body.appendChild(root);
		const map = Object.create(RvMapView.prototype) as RvMapView & { zoom: number; paint: () => void };
		map.contentEl = root;
		map.bindHost({
			settings: { ...DEFAULT_SETTINGS, distanceTest: true },
			mapFocusPath: null,
			listMapPins: () => pins,
			openMapNote: () => {},
			openRoute: async () => {},
			currentMapFix: () => null,
			notifyPin: () => {},
		}, 'hub');
		void map.onOpen();
		map.zoom = 12;
		map.paint();
		assert.ok(root.querySelectorAll('.rv-map-tile-back[data-rv-parent="1"]').length > 0);
		assert.ok((root.querySelector('.rv-map-settle')?.childElementCount ?? 0) > 0);
		const pin = root.querySelector('button.rv-map-pin');
		assert.ok(pin instanceof window.HTMLElement);
		const PointerEventCtor = window.PointerEvent ?? window.MouseEvent;
		pin.dispatchEvent(new PointerEventCtor('pointerdown', { button: 0, clientX: 30, clientY: 40, bubbles: true }));
		pin.dispatchEvent(new PointerEventCtor('pointerup', { button: -1, clientX: 32, clientY: 42, bubbles: true }));
		assert.equal(map.zoom, 13);
		void map.onClose();
		root.remove();
	});

});
