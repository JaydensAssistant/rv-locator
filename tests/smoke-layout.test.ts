import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { decorateAttemptLog, isLogCalloutTitle } from '../src/attempt-digest';
import { stampAgeCount } from '../src/dates';
import { applyLiveUrgency, decorateNoteChrome, type NoteChromeHost } from '../src/note-chrome';
import { shouldHideStatusBar } from '../src/status-bar';
import { refreshStampAgeLabels } from '../src/rv-note-view';
import { DEFAULT_SETTINGS } from '../src/types';
import { decorateReadingSurface, decorateVisitControls, readingDomIsStale, refitItemStrip, rehoistVisitNotes, visitLayoutMissing } from '../src/visit-controls';
import { clearVisitNoteCaches, mountRawVisitNotes, setActiveVisitNote } from '../src/visit-notes-field';
import { mountAlwaysChevron } from '../src/suggest-field';
import { armVisitNoteFocus, holdVisitNote, placeVisitNoteFocus, restoreHeldNote, visitNoteBusy } from '../src/visit-display';
import { correctedStrokePx, pinBadgeStroke } from '../src/glancable-view';
import { placeGlanceStage } from '../src/hub-layout';
import { ancestorTileBackground, RvMapView, tileReady, unloadedAncestorTile } from '../src/map-view';
import type { MapPin } from '../src/map-pins';
import { popupClearOfChrome } from '../src/map-pins';
import { contentBottom, fillToastText, placeBottomToast, toastBottomOffset, toastLineParts, watchBottomToast } from '../src/chrome-inset';
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

	it('drops the padded visit card and keeps the item strip or the ghost header', () => {
		const filled = visitRoot(LONG, 'Showed the video and started lesson 1.', 'Log');
		decorateVisitControls(filled, () => 1, () => {});
		const filledBox = filled.querySelector('.rv-visit-note-box');
		const filledStrip = filledBox?.querySelector(':scope > .rv-item-strip');
		assert.ok(filledBox);
		assert.equal(filledStrip?.classList.contains('is-ghost'), false);
		const titles = Array.from(filledStrip?.querySelectorAll('.rv-item') ?? []).map((node) => node.textContent ?? '');
		assert.ok(titles.some((text) => /Enjoy Life Forever/.test(text)));
		assert.ok(titles.some((text) => /Why Study the Bible/.test(text)));
		assert.ok(titles.some((text) => /How Can the Bible Help You/.test(text)));
		assert.equal(filledBox?.querySelector('p')?.textContent, 'Showed the video and started lesson 1.');

		const empty = visitRoot('Tue, 6:15pm — Aug 12, 2026', 'Nobody answered.', 'Log');
		decorateVisitControls(empty, () => null, () => {});
		const emptyBox = empty.querySelector('.rv-visit-note-box');
		const ghost = emptyBox?.querySelector(':scope > .rv-item-strip');
		assert.ok(emptyBox);
		assert.equal(ghost?.classList.contains('is-ghost'), true);
		assert.equal(ghost?.childElementCount, 0);
		assert.equal(emptyBox?.querySelector('p')?.textContent, 'Nobody answered.');

		const css = readFileSync('styles.css', 'utf8');
		const boxRule = css.match(/\.rv-visit-note-box \{([^}]*)\}/)?.[1] ?? '';
		assert.match(boxRule, /background:\s*transparent/);
		assert.match(boxRule, /border:\s*0/);
		assert.doesNotMatch(boxRule, /border-radius:\s*8px/);
		assert.doesNotMatch(boxRule, /border:\s*1px/);
		const noteRule = css.match(/\.rv-visit-note-box > :is\(p, div, \.el-p, blockquote\):not\(\.rv-item-strip\) \{([^}]*)\}/)?.[1] ?? '';
		assert.match(noteRule, /padding:\s*0/);
		assert.doesNotMatch(noteRule, /padding:\s*7px/);
		assert.equal(css.includes('.rv-visit-note-box textarea'), false);
		assert.match(css, /\.theme-light \.rv-visit-note-box/);
		assert.match(css, /\.theme-dark \.rv-visit-note-box/);
		assert.match(css, /\.rv-item-strip\.is-ghost \{[^}]*height:\s*5px/);
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
		header.setAttribute('contenteditable', 'true');
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
		assert.equal(header.textContent, 'Maria on Lake Dr 2026-10-11 0905');
		assert.equal(inline.textContent, 'Maria on Lake Dr 2026-10-11 0905Active');
		assert.equal(explorer.textContent, 'Maria on Lake Dr 2026-10-11 0905');
		assert.equal(search.textContent, 'Maria on Lake Dr 2026-10-11 0905');
		assert.equal(suggestion.textContent, 'Maria on Lake Dr 2026-10-11 0905');
		const main = readFileSync('src/main.ts', 'utf8');
		assert.doesNotMatch(main, /nav-file-title-content|search-result-file-title|suggestion-title|file-explorer/);
		assert.doesNotMatch(main, /querySelector(?:All)?\([^)]*inline-title/);
		assert.equal(main.includes('view-header-title'), false);
		assert.equal(main.includes('view-header-breadcrumb'), false);
		assert.match(main, /collisionSuffixOnly/);
		const script = readFileSync('extras/templater-metabind/newRv.js', 'utf8');
		assert.match(script, /alreadyStamped/);
		assert.match(script, /if \(alreadyStamped\)/);
		assert.match(script, /!alreadyStamped/);
		assert.equal(script.includes('templateFile'), false);
		const newRv = readFileSync('extras/templater-metabind/New RV.md', 'utf8');
		assert.match(newRv, /templateFile: Templates\/RV Log Home\.md/);
		assert.match(newRv, /templateFile: Templates\/RV Log Miss\.md/);
		assert.equal(newRv.includes('99 RV Log'), false);
		const chrome = readFileSync('src/note-chrome.ts', 'utf8');
		assert.match(chrome, /link\.textContent = text/);
		assert.doesNotMatch(chrome, /fitEndEllipsis\(link, text\)/);
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

	it('keeps a toast above the phone nav and the desktop status bar', () => {
		const phoneNav = { top: 760, bottom: 844, left: 0, right: 390, width: 390, height: 84 };
		assert.equal(contentBottom(844, [phoneNav], 0), 760);
		assert.equal(toastBottomOffset(844, 760), 96);
		assert.equal(844 - 96, 748);
		assert.equal(760 - 748, 12);
		const status = { top: 778, bottom: 800, left: 400, right: 800, width: 400, height: 22 };
		assert.equal(contentBottom(800, [status], 0), 778);
		assert.equal(800 - toastBottomOffset(800, 778) < 778, true);
		assert.equal(contentBottom(844, [], 34), 810);
		assert.equal(contentBottom(844, [phoneNav, { top: 700, bottom: 748, left: 0, right: 390, width: 390, height: 48 }], 0), 700);
		Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
		const nav = window.document.createElement('div');
		nav.className = 'mobile-navbar';
		nav.getBoundingClientRect = () => ({ ...phoneNav, x: 0, y: 760, toJSON() { return phoneNav; } }) as DOMRect;
		window.document.body.appendChild(nav);
		const toast = window.document.createElement('div');
		toast.className = 'rv-nh-toast';
		placeBottomToast(toast);
		assert.equal(toast.style.bottom, '96px');
		nav.remove();
	});

	it('remeasures a toast for half a second and follows the nav as it settles, hides, and shows', async () => {
		Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
		const nav = window.document.createElement('div');
		nav.className = 'mobile-navbar';
		let top = 844;
		let height = 0;
		const box = () => ({ top, bottom: top + height, left: 0, right: 390, width: 390, height, x: 0, y: top, toJSON() { return { top, height }; } });
		nav.getBoundingClientRect = () => box() as DOMRect;
		window.document.body.appendChild(nav);
		const toast = window.document.createElement('div');
		toast.className = 'rv-nh-toast';
		window.document.body.appendChild(toast);
		const stop = watchBottomToast(toast);
		assert.equal(toast.style.bottom, '12px');
		top = 760;
		height = 52;
		await new Promise<void>((resolve) => { window.requestAnimationFrame(() => resolve()); });
		assert.equal(toast.style.bottom, '96px');
		assert.equal(844 - 96 <= 760 - 12, true);
		top = 820;
		height = 0;
		window.document.dispatchEvent(new window.Event('scroll'));
		assert.equal(toast.style.bottom, '12px');
		top = 760;
		height = 52;
		nav.className = 'mobile-navbar is-visible';
		await new Promise<void>((resolve) => { window.requestAnimationFrame(() => resolve()); });
		assert.equal(toast.style.bottom, '96px');
		toast.remove();
		stop();
		nav.remove();
	});

	it('keeps a visible space between the toast lead and name', () => {
		const css = readFileSync('styles.css', 'utf8');
		const flexText = css.match(/\.rv-nh-toast \.rv-toast-text \{[^}]*display:\s*flex;[^}]*\}/);
		assert.ok(flexText);
		assert.match(flexText[0], /gap:\s*0\.3em/);
		assert.match(flexText[0], /flex:\s*1 1 auto/);
		assert.match(flexText[0], /min-width:\s*0/);
		const main = readFileSync('src/main.ts', 'utf8');
		assert.equal(main.includes('` logged ·'), false);
		assert.match(main, /fillToastText\(text, `Not home logged · \$\{name\}`\)/);
		const home = 'Home logged on “Avoid”. Address was not changed.';
		const variants = [
			{ message: 'Not home logged · Avoid', lead: 'Not home', name: 'logged · Avoid' },
			{ message: home, lead: 'Home', name: 'logged on “Avoid”. Address was not changed.' },
			{ message: 'Undone', lead: 'Undone', name: '' },
			{ message: 'Logged success', lead: 'Logged', name: 'success' },
		];
		for (const sample of variants) {
			assert.deepEqual(toastLineParts(`  ${sample.message}  `), { lead: sample.lead, name: sample.name });
			const text = window.document.createElement('span');
			text.className = 'rv-toast-text';
			text.style.display = 'flex';
			text.style.gap = '0.3em';
			const nameEl = fillToastText(text, sample.message);
			assert.equal(text.querySelector('.rv-toast-lead')?.textContent, sample.lead);
			if (sample.name) {
				assert.equal(nameEl?.textContent, sample.name);
				assert.equal(/^\s/.test(nameEl?.textContent ?? ' '), false);
				assert.equal(nameEl?.className, 'rv-toast-name');
			} else {
				assert.equal(nameEl, null);
				assert.equal(text.querySelector('.rv-toast-name'), null);
			}
		}
		assert.deepEqual(toastLineParts('Not home  logged · Avoid'), { lead: 'Not home', name: 'logged · Avoid' });
	});

	it('clamps a fullscreen card inside a 4px margin above the nav on every edge', () => {
		const card = { width: 280, height: 200 };
		const stage = { width: 390, height: 844 };
		const visible = { left: 0, top: 0, width: 390, height: 756 };
		const edges = [
			{ x: 5, y: 400 },
			{ x: 372, y: 400 },
			{ x: 180, y: 8 },
			{ x: 180, y: 740 },
		];
		for (const anchor of edges) {
			const placed = popupClearOfChrome(anchor, card, stage, visible);
			assert.equal(placed.left >= 4, true, `left ${anchor.x}`);
			assert.equal(placed.top >= 4, true, `top ${anchor.y}`);
			assert.equal(placed.left + card.width <= 390 - 56, true, `right ${anchor.x}`);
			assert.equal(placed.top + card.height <= 756, true, `bottom ${anchor.y}`);
		}
		const desktop = popupClearOfChrome(
			{ x: 20, y: 760 },
			{ width: 280, height: 180 },
			{ width: 1280, height: 800 },
			{ left: 0, top: 0, width: 1280, height: 774 },
		);
		assert.equal(desktop.left >= 4, true);
		assert.equal(desktop.top >= 4, true);
		assert.equal(desktop.left + 280 <= 1280 - 56, true);
		assert.equal(desktop.top + 180 <= 774, true);
	});

	it('switches the open fullscreen card when another pin is tapped', () => {
		const facts = {
			address: '10 Oak Hammock Ln',
			city: 'Orlando',
			study: false,
			spoke: '',
			attempted: '',
			studied: '',
			met: '',
			metWith: '',
			visits: '1',
			studyRatio: '',
			literature: '',
			media: '',
			lessons: [],
		};
		const make = (path: string, name: string, lon: number): MapPin => ({
			path,
			name,
			lat: 28.54,
			lon,
			priority: 4,
			urgency: 1,
			days: 3,
			color: '#d63c3c',
			glyph: '1',
			fresh: false,
			stateIcon: null,
			shadeIcon: null,
			markText: null,
			rank: 0,
			card: facts,
		});
		const pins = [make('RVs/left.md', 'Left Edge', -81.381), make('RVs/right.md', 'Right Edge', -81.379)];
		for (const scope of ['hub', 'split'] as const) {
			let full = false;
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
				hubMapIsFullscreen: () => full,
				setHubMapFullscreen: (on: boolean) => { full = on; },
			}, scope);
			void map.onOpen();
			root.querySelector<HTMLElement>('.rv-map-fullscreen')?.click();
			map.zoom = 15;
			map.paint();
			const buttons = [...root.querySelectorAll<HTMLElement>('button.rv-map-pin')];
			assert.equal(buttons.length, 2);
			const boxes = [
				{ left: 0, top: 200, width: 42, height: 54 },
				{ left: 350, top: 200, width: 42, height: 54 },
			];
			buttons.forEach((button, index) => {
				const box = boxes[index] ?? boxes[0];
				button.getBoundingClientRect = () => ({
					left: box.left,
					top: box.top,
					right: box.left + box.width,
					bottom: box.top + box.height,
					width: box.width,
					height: box.height,
					x: box.left,
					y: box.top,
					toJSON() { return box; },
				}) as DOMRect;
			});
			const tap = (target: HTMLElement, x: number, y: number): void => {
				target.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: x, clientY: y }));
			};
			tap(buttons[0]!, 10, 220);
			assert.equal(root.querySelector('.rv-map-card .rv-locator-file-link')?.textContent, 'Left Edge');
			const card = root.querySelector<HTMLElement>('.rv-map-card');
			assert.ok(card);
			tap(card, 370, 220);
			assert.equal(root.querySelector('.rv-map-card .rv-locator-file-link')?.textContent, 'Right Edge');
			void map.onClose();
			root.remove();
		}
	});

	it('opens the file on the pin element under the pointer, including a hotter neighbor', () => {
		const facts = {
			address: '10 Oak Hammock Ln',
			city: 'Orlando',
			study: false,
			spoke: '',
			attempted: '',
			studied: '',
			met: '',
			metWith: '',
			visits: '1',
			studyRatio: '',
			literature: '',
			media: '',
			lessons: [],
		};
		const named = [
			['RVs/Avoid.md', 'Avoid', 1],
			['RVs/Token Edit.md', 'Token Edit', 5],
			['RVs/Crowd 080.md', 'Crowd 080', 2],
			['RVs/Three Items.md', 'Three Items', 4],
			['RVs/Cooldown.md', 'Cooldown', 1],
			['RVs/Toast Two.md', 'Toast Two', 5],
		] as const;
		const pins: MapPin[] = named.map(([path, name, urgency], index) => ({
			path,
			name,
			lat: 28.54,
			lon: -81.38 + index * 0.0015,
			priority: 4,
			urgency,
			days: 3,
			color: '#d63c3c',
			glyph: '1',
			fresh: false,
			stateIcon: null,
			shadeIcon: null,
			markText: null,
			rank: index,
			card: facts,
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
			hubMapIsFullscreen: () => true,
		}, 'hub');
		void map.onOpen();
		root.querySelector<HTMLElement>('.rv-map-fullscreen')?.click();
		map.zoom = 15;
		map.paint();
		const buttons = [...root.querySelectorAll<HTMLElement>('button.rv-map-pin')];
		assert.equal(buttons.length, named.length);
		const overlap = { left: 40, top: 200, right: 82, bottom: 254, width: 42, height: 54, x: 40, y: 200, toJSON() { return overlap; } };
		buttons.forEach((button) => {
			button.getBoundingClientRect = () => overlap as DOMRect;
		});
		const cardFile = (): string => root.querySelector('.rv-map-card .rv-locator-file-link')?.getAttribute('href') ?? '';
		buttons.forEach((button) => {
			const path = button.dataset.rvPath ?? '';
			assert.equal(named.some(([file]) => file === path), true);
			button.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 50, clientY: 220 }));
			assert.equal(cardFile(), path, button.getAttribute('aria-label') ?? path);
		});
		const avoid = buttons.find((button) => button.dataset.rvPath === 'RVs/Avoid.md');
		assert.ok(avoid);
		avoid.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 50, clientY: 220 }));
		assert.equal(cardFile(), 'RVs/Avoid.md');
		assert.equal(root.querySelector('.rv-map-card .rv-locator-file-link')?.textContent, 'Avoid');
		void map.onClose();
		root.remove();
	});

	it('zooms a stack to 13 on mouse and touch even when a card is already open', () => {
		const facts = {
			address: '10 Oak Hammock Ln',
			city: 'Orlando',
			study: false,
			spoke: '',
			attempted: '',
			studied: '',
			met: '',
			metWith: '',
			visits: '8',
			studyRatio: '',
			literature: '',
			media: '',
			lessons: [],
		};
		const pins: MapPin[] = Array.from({ length: 8 }, (_, index) => ({
			path: `RVs/stack-${index}.md`,
			name: index === 0 ? 'Token Edit' : `Stack ${index}`,
			lat: 28.54,
			lon: -81.38,
			priority: 5 - (index % 5),
			urgency: index === 0 ? 5 : 1,
			days: 4,
			color: '#d63c3c',
			glyph: '1',
			fresh: false,
			stateIcon: null,
			shadeIcon: null,
			markText: null,
			rank: index,
			card: facts,
		}));
		for (const scope of ['hub', 'split'] as const) {
			for (const button of [0, -1]) {
				let full = scope === 'hub';
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
					hubMapIsFullscreen: () => full,
					setHubMapFullscreen: (on: boolean) => { full = on; },
				}, scope);
				void map.onOpen();
				if (scope === 'split') root.querySelector<HTMLElement>('.rv-map-fullscreen')?.click();
				map.zoom = 15;
				map.paint();
				const first = root.querySelector<HTMLElement>('button.rv-map-pin');
				assert.ok(first);
				first.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button, clientX: 20, clientY: 20 }));
				assert.ok(root.querySelector('.rv-map-card'));
				map.zoom = 12;
				map.paint();
				const stack = root.querySelector<HTMLElement>('button.rv-map-pin');
				assert.ok(stack);
				assert.equal(stack.querySelector('.rv-pin-stack-count')?.textContent, '8');
				const badge = stack.querySelector('.rv-pin-stack-count');
				assert.ok(badge);
				const point = { bubbles: true, button, clientX: 48, clientY: 8 };
				badge.dispatchEvent(new window.MouseEvent('pointerdown', point));
				badge.dispatchEvent(new window.MouseEvent('pointerup', point));
				badge.dispatchEvent(new window.MouseEvent('click', point));
				assert.equal(map.zoom, 13);
				assert.equal(root.querySelector('.rv-map-card'), null);
				void map.onClose();
				root.remove();
			}
		}
	});

	it('recolors the note from a fresh Last Attempted while Last Spoke is still old', () => {
		const root = window.document.createElement('div');
		root.className = 'rv-dashboard';
		const stale = {
			cssclasses: ['rv-dashboard'],
			Status: 'Active',
			Priority: 1,
			'Last Spoke': '2019-01-01',
			'Last Attempted': '2019-01-01',
		};
		applyLiveUrgency(root, 'RVs/Ada.md', chromeHost(stale, { count: 0 }));
		const before = root.style.getPropertyValue('--rv-urgency-accent').toLowerCase();
		const now = new Date();
		const freshStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T08:00:00`;
		const fresh = { ...stale, 'Last Attempted': freshStamp };
		applyLiveUrgency(root, 'RVs/Ada.md', chromeHost(fresh, { count: 0 }));
		const after = root.style.getPropertyValue('--rv-urgency-accent').toLowerCase();
		assert.equal(before, '#d63c3c');
		assert.equal(after, '#1f8a4c');
	});

	it('focuses the first visit note and puts the caret back if it falls on the body', () => {
		const root = window.document.createElement('div');
		root.className = 'markdown-preview-view rv-dashboard';
		root.innerHTML = '<h5>Mon, 10:40am — Oct 6, 2025</h5><textarea class="rv-visit-note"></textarea>';
		window.document.body.appendChild(root);
		const area = placeVisitNoteFocus(root, 'Mon, 10:40am — Oct 6, 2025', 0);
		assert.ok(area instanceof window.HTMLTextAreaElement);
		assert.equal(window.document.activeElement, area);
		area.blur();
		assert.notEqual(window.document.activeElement, area);
		restoreHeldNote();
		assert.equal(window.document.activeElement, area);
		root.remove();
	});

	it('opens the Taken popover on mouse hover', () => {
		const root = window.document.createElement('div');
		root.innerHTML = '<div class="callout" data-callout="rv"><div class="callout-title"><div class="callout-title-inner">Quick Facts</div></div><div class="callout-content"></div></div>';
		const data = {
			cssclasses: ['rv-dashboard'],
			Status: 'Active',
			Priority: 1,
			Taken: ['Ada Publisher', 'Bea Publisher'],
		};
		decorateNoteChrome(root, 'RVs/Ada.md', chromeHost(data, { count: 0 }));
		const taken = root.querySelector('.rv-qf-companion .rv-qf-value');
		assert.ok(taken instanceof window.HTMLElement);
		taken.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
		const pop = window.document.querySelector('.rv-title-popover');
		assert.ok(pop);
		assert.match(pop?.textContent ?? '', /Ada Publisher/);
		assert.match(pop?.textContent ?? '', /Bea Publisher/);
		pop?.remove();
	});

	it('turns strip overflow into a +n chip and keeps the campaign chip', () => {
		const root = visitRoot(LONG, 'Talked.', 'Log');
		decorateVisitControls(root, () => null, () => {});
		const strip = root.querySelector('.rv-item-strip');
		assert.ok(strip instanceof window.HTMLElement);
		const chips = () => Array.from(strip.querySelectorAll(':scope > .rv-item:not(.rv-item-more)'));
		assert.equal(chips().length, 4);
		Object.defineProperty(strip, 'clientWidth', { configurable: true, get: () => 90 });
		Object.defineProperty(strip, 'scrollWidth', {
			configurable: true,
			get: () => chips().filter((chip) => !chip.hasAttribute('hidden')).length * 80,
		});
		refitItemStrip(strip);
		const more = strip.querySelector('.rv-item-more');
		assert.ok(more);
		assert.match(more?.textContent ?? '', /^\+\d+$/);
		assert.ok(strip.querySelector(':scope > .rv-item.is-campaign:not([hidden])'));
		more?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		const pop = window.document.querySelector('.rv-title-popover');
		assert.ok(pop);
		assert.match(pop?.textContent ?? '', /Enjoy Life Forever|Why Study the Bible|How Can the Bible/);
		pop?.remove();
	});

	it('corrects a zoomed badge stroke back to 2px and keeps ghosts dashed', () => {
		assert.equal(correctedStrokePx(2), '2px');
		assert.equal(correctedStrokePx(1.01587), '3.938px');
		// 3.938px was the wrong divisor: Obsidian used it as 3.04762px (6 device px).
		assert.equal(correctedStrokePx(3.04762, 3.938), '2.584px');
		const button = window.document.createElement('button');
		button.className = 'rv-locator-urgency is-ghost';
		window.document.body.appendChild(button);
		pinBadgeStroke(button);
		assert.equal(button.style.getPropertyValue('border-style'), 'dashed');
		assert.equal(button.style.getPropertyPriority('border-width'), 'important');
		assert.equal(button.style.getPropertyValue('border-width'), '2px');
		const pin = window.document.createElement('button');
		pin.className = 'rv-locator-map-pin';
		window.document.body.appendChild(pin);
		pinBadgeStroke(pin);
		assert.equal(pin.style.getPropertyValue('border-width'), '2px');
		assert.equal(pin.style.getPropertyPriority('border-width'), 'important');
		button.remove();
		pin.remove();
	});

	it('focuses the visit textarea after the Templater prompt closes', async () => {
		hostGlobals.MutationObserver = window.MutationObserver;
		const root = window.document.createElement('div');
		window.document.body.appendChild(root);
		const prompt = window.document.createElement('input');
		prompt.className = 'templater-prompt-input';
		window.document.body.appendChild(prompt);
		prompt.focus();
		const stop = armVisitNoteFocus(root);
		const area = window.document.createElement('textarea');
		root.appendChild(area);
		const enter = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
		prompt.dispatchEvent(enter);
		assert.equal(enter.defaultPrevented, false);
		assert.equal(window.document.activeElement, prompt);
		await new Promise((resolve) => window.setTimeout(resolve, 0));
		assert.notEqual(window.document.activeElement, area);
		prompt.remove();
		await new Promise((resolve) => window.setTimeout(resolve, 20));
		assert.equal(window.document.activeElement, area);
		stop();
		root.remove();
	});

	it('moves focus from the note title onto the visit textarea', async () => {
		hostGlobals.MutationObserver = window.MutationObserver;
		const root = window.document.createElement('div');
		const title = window.document.createElement('div');
		title.className = 'view-header-title';
		title.contentEditable = 'true';
		window.document.body.append(title, root);
		title.focus();
		const stop = armVisitNoteFocus(root);
		const area = window.document.createElement('textarea');
		root.appendChild(area);
		await new Promise((resolve) => window.setTimeout(resolve, 20));
		assert.equal(window.document.activeElement, area);
		stop();
		title.remove();
		root.remove();
	});

	it('wraps the address in the callout and stacks the note map from the leaf width', () => {
		const css = readFileSync('styles.css', 'utf8');
		assert.match(css, /grid-template-columns: max-content minmax\(0, 1fr\) 28px !important/);
		assert.match(css, /a\.rv-address-link:not\(\[hidden\]\) \{[^}]*white-space: nowrap !important/);
		assert.match(css, /a\.rv-address-link:not\(\[hidden\]\) \{[^}]*overflow: hidden !important/);
		assert.match(css, /a\.rv-address-link:not\(\[hidden\]\) \{[^}]*text-overflow: ellipsis !important/);
		assert.doesNotMatch(css, /\.rv-qf-label \{[^}]*text-overflow:\s*ellipsis/);
		const chrome = readFileSync('src/note-chrome.ts', 'utf8');
		const show = chrome.slice(chrome.indexOf('function showAddressLink'), chrome.indexOf('function labeledStrong'));
		assert.match(show, /white-space', 'nowrap'/);
		assert.match(show, /overflow', 'hidden'/);
		assert.match(show, /text-overflow', 'ellipsis'/);
		assert.doesNotMatch(show, /white-space', 'normal'/);
		assert.match(css, /grid-column: 3 !important;[\s\S]{0,800}min-height: 28px !important/);
		assert.match(css, /max-height: 28px !important/);
		assert.match(css, /\.rv-fit-stem[\s\S]*color: var\(--rv-urgency-accent, var\(--text-normal\)\) !important/);
		assert.match(css, /\.is-note-map-side/);
		assert.doesNotMatch(css, /body\.is-phone \.workspace-leaf-content\.is-note-map/);
		const main = readFileSync('src/main.ts', 'utf8');
		assert.match(main, /frontmatterFromMarkdown\(data\)/);
		assert.match(main, /is-note-map-side/);
		const activate = main.slice(main.indexOf('private async activateNewRvNote'), main.indexOf('private noteMapHost'));
		assert.match(activate, /openFile/);
		assert.match(activate, /setActiveLeaf/);
		assert.match(activate, /await this\.openInReadingView/);
		assert.match(main, /source: false/);
		assert.match(css, /--rv-pair-label: 56px/);
		assert.match(css, /padding: 4px !important/);
		assert.match(css, /> \.callout-content \{[^}]*padding: 0 !important/);
		assert.match(css, /input\.rv-address-input\[hidden\],\s*a\.rv-address-link\[hidden\] \{\s*display: none !important;/);
		const visit = readFileSync('src/visit-display.ts', 'utf8');
		const arm = visit.slice(visit.indexOf('export function armVisitNoteFocus'), visit.indexOf('export function placeVisitNoteFocus'));
		assert.match(arm, /templater-prompt-input/);
		assert.doesNotMatch(arm, /setTimeout/);
	});

	it('binds each reading-view box to its own visit key', () => {
		const css = readFileSync('styles.css', 'utf8');
		const controls = readFileSync('src/visit-controls.ts', 'utf8');
		assert.match(css, /\.rv-visit-note-box code\.mb-input \{[^}]*font-size:\s*0/);
		assert.doesNotMatch(css, /display:\s*contents/);
		assert.doesNotMatch(controls, /parentElement\?\.querySelector\(':scope > \.rv-visit-note-box/);
		const preview = window.document.createElement('div');
		preview.className = 'markdown-preview-view markdown-reading-view';
		const sizer = window.document.createElement('div');
		sizer.className = 'markdown-preview-sizer markdown-preview-section';
		const visits = [
			['Sun, 9:05am — Oct 11, 2026', 'sVisit5Notes', 'newest'],
			['Sat, 8:00am — Oct 4, 2026', 'sVisit4Notes', 'middle'],
			['Fri, 7:00pm — Sep 26, 2026', 'sVisit3Notes', 'oldest'],
		] as const;
		const section = (html: string): HTMLElement => {
			const block = window.document.createElement('div');
			block.className = 'markdown-preview-section';
			block.innerHTML = html;
			return block;
		};
		for (const [stamp, key] of visits) {
			sizer.append(
				section(`<div class="el-h5"><h5>${stamp}</h5></div>`),
				section(`<div class="el-p"><p><code>INPUT[textArea:${key}]</code></p></div>`),
			);
		}
		preview.appendChild(sizer);
		window.document.body.appendChild(preview);
		assert.equal(visitLayoutMissing(preview), true);
		decorateVisitControls(preview, () => null, () => {});
		rehoistVisitNotes(preview);
		assert.equal(visitLayoutMissing(preview), false);
		const boxes = Array.from(preview.querySelectorAll('.rv-visit-note-box'));
		assert.equal(boxes.length, 3);
		const seqs = boxes.map((box) => box.querySelector('[data-rv-seq]')?.getAttribute('data-rv-seq') ?? '');
		assert.equal(new Set(seqs).size, 3);
		assert.equal(seqs[0] === seqs[1] && seqs[1] === seqs[2], false);
		assert.equal(boxes[0]?.textContent?.includes('sVisit5Notes'), true);
		assert.equal(boxes[1]?.textContent?.includes('sVisit4Notes'), true);
		assert.equal(boxes[1]?.textContent?.includes('sVisit5Notes'), false);
		assert.equal(boxes[2]?.textContent?.includes('sVisit3Notes'), true);
		// Meta Bind replaces the declaration after the first paint and leaves no bind attribute.
		preview.querySelectorAll('code').forEach((code) => {
			code.textContent = '';
			const wrap = window.document.createElement('div');
			wrap.className = 'mb-input-wrapper mb-input-type-textArea';
			const meta = window.document.createElement('textarea');
			meta.className = 'mb-input-textarea';
			wrap.appendChild(meta);
			code.appendChild(wrap);
		});
		const leak = window.document.createElement('span');
		leak.textContent = 'INPUT[textArea:sVisit5Notes]';
		sizer.prepend(leak);
		// A reading rebuild drops the captured key. Meta Bind has already removed the declaration.
		boxes.forEach((box) => box.removeAttribute('data-rv-visit-key'));
		const front = new Map(visits.map((row) => [row[1], row[2]]));
		const writes: Array<[string, string]> = [];
		const mount = (root: HTMLElement): void => {
			mountRawVisitNotes(root, (key) => front.get(key) ?? '', (key, value) => {
				writes.push([key, value]);
				front.set(key, value);
			}, visits.map((row) => row[1]));
		};
		sizer.querySelectorAll(':scope > .markdown-preview-section').forEach((node) => {
			if (node instanceof window.HTMLElement) mount(node);
		});
		mount(preview);
		const areas = boxes.map((box) => box.querySelector('textarea.rv-native-notes-area'));
		assert.equal(areas.length, 3);
		assert.equal(preview.querySelectorAll('.rv-visit-note-box').length, 3);
		const keys = areas.map((area) => area?.getAttribute('data-rv-native-notes'));
		assert.deepEqual(keys, ['sVisit5Notes', 'sVisit4Notes', 'sVisit3Notes']);
		assert.deepEqual(areas.map((area) => area?.getAttribute('data-rv-note-key')), ['sVisit5Notes', 'sVisit4Notes', 'sVisit3Notes']);
		assert.deepEqual(areas.map((area) => (area as HTMLTextAreaElement).value), ['newest', 'middle', 'oldest']);
		const second = areas[1] as HTMLTextAreaElement;
		second.focus();
		second.value = 'middle typed';
		second.setSelectionRange(7, 7);
		second.dispatchEvent(new window.Event('input', { bubbles: true }));
		const third = areas[2] as HTMLTextAreaElement;
		third.focus();
		third.value = 'box3 typed';
		third.setSelectionRange(4, 4);
		third.dispatchEvent(new window.Event('input', { bubbles: true }));
		// A click inside the debounce window moves the caret after the save was scheduled.
		third.setSelectionRange(2, 2);
		third.dispatchEvent(new window.KeyboardEvent('keyup', { bubbles: true }));
		mount(preview);
		const held = boxes[2]?.querySelector('textarea.rv-native-notes-area');
		assert.equal(held, third);
		assert.equal(third.selectionStart, 2);
		assert.equal(third.selectionEnd, 2);
		assert.equal(third.value, 'box3 typed');
		third.remove();
		mount(preview);
		const restored = boxes[2]?.querySelector('textarea.rv-native-notes-area');
		assert.ok(restored instanceof window.HTMLTextAreaElement);
		assert.notEqual(restored, third);
		assert.equal(preview.ownerDocument.activeElement, restored);
		assert.equal(restored.selectionStart, 2);
		assert.equal(restored.selectionEnd, 2);
		assert.equal(restored.value, 'box3 typed');
		assert.notEqual(restored.selectionStart, restored.value.length);
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				assert.deepEqual(writes, [
					['sVisit4Notes', 'middle typed'],
					['sVisit3Notes', 'box3 typed'],
				]);
				assert.equal(front.get('sVisit5Notes'), 'newest');
				assert.equal(restored.selectionStart, 2);
				assert.equal(restored.selectionEnd, 2);
				preview.remove();
				resolve();
			}, 450);
		});
	});

	it('keeps each note\'s visit text and writes on that file', () => {
		const main = readFileSync('src/main.ts', 'utf8');
		assert.match(main, /private onNoteOpened[\s\S]{0,120}clearVisitNoteCaches\(\)/);
		assert.match(main, /active-leaf-change', \(\) => \{\s*clearVisitNoteCaches\(\)/);
		assert.match(main, /onunload\(\): void \{\s*this\.unloaded = true;\s*clearVisitNoteCaches\(\)/);
		assert.match(main, /releaseClosedVisitNotes\(open\)/);
		assert.match(main, /getActiveFile\(\)\?\.path \?\? ''\) !== shown\) return/);
		clearVisitNoteCaches();
		const stamps = [
			['Sun, 9:05am — Oct 11, 2026', 'sVisit5Notes'],
			['Sat, 8:00am — Oct 4, 2026', 'sVisit4Notes'],
			['Fri, 7:00pm — Sep 26, 2026', 'sVisit3Notes'],
		] as const;
		const preview = window.document.createElement('div');
		preview.className = 'markdown-preview-view markdown-reading-view';
		const sizer = window.document.createElement('div');
		sizer.className = 'markdown-preview-sizer markdown-preview-section';
		preview.appendChild(sizer);
		window.document.body.appendChild(preview);
		const fill = (values: Record<string, string>): Map<string, string> => {
			const front = new Map(Object.entries(values));
			sizer.replaceChildren();
			for (const [stamp, key] of stamps) {
				const heading = window.document.createElement('div');
				heading.className = 'markdown-preview-section';
				heading.innerHTML = `<div class="el-h5"><h5>${stamp}</h5></div>`;
				const note = window.document.createElement('div');
				note.className = 'markdown-preview-section';
				note.innerHTML = `<div class="el-p"><p><code>INPUT[textArea:${key}]</code></p></div>`;
				sizer.append(heading, note);
			}
			decorateVisitControls(preview, () => null, () => {});
			rehoistVisitNotes(preview);
			preview.querySelectorAll('code').forEach((code) => {
				code.textContent = '';
				const wrap = window.document.createElement('div');
				wrap.className = 'mb-input-wrapper mb-input-type-textArea';
				const meta = window.document.createElement('textarea');
				meta.className = 'mb-input-textarea';
				wrap.appendChild(meta);
				code.appendChild(wrap);
			});
			preview.querySelectorAll('.rv-visit-note-box').forEach((box) => box.removeAttribute('data-rv-visit-key'));
			return front;
		};
		const boFront = fill({ sVisit5Notes: 'bo newest', sVisit4Notes: 'bo middle', sVisit3Notes: 'bo oldest' });
		const boWrites: Array<[string, string]> = [];
		const mount = (path: string, front: Map<string, string>, writes: Array<[string, string]>): void => {
			setActiveVisitNote(path);
			mountRawVisitNotes(preview, (key) => front.get(key) ?? '', (key, value) => {
				writes.push([key, value]);
				front.set(key, value);
			}, stamps.map((row) => row[1]), path);
		};
		try {
			mount('Bo.md', boFront, boWrites);
			const boAreas = Array.from(preview.querySelectorAll('textarea.rv-native-notes-area')) as HTMLTextAreaElement[];
			assert.deepEqual(boAreas.map((area) => area.value), ['bo newest', 'bo middle', 'bo oldest']);
			assert.deepEqual(boAreas.map((area) => area.dataset.rvNoteFile), ['Bo.md', 'Bo.md', 'Bo.md']);
			assert.deepEqual(boAreas.map((area) => area.dataset.rvNoteKey), ['sVisit5Notes', 'sVisit4Notes', 'sVisit3Notes']);
			const boBox = boAreas[1];
			assert.ok(boBox);
			boBox.focus();
			boBox.value = 'from bo';
			boBox.setSelectionRange(4, 4);
			boBox.dispatchEvent(new window.Event('input', { bubbles: true }));
			clearVisitNoteCaches();
			setActiveVisitNote('Pat.md');
			preview.dataset.rvNoteFile = 'Pat.md';
			assert.equal(visitNoteBusy(preview), false);
			const earlyWrites: Array<[string, string]> = [];
			const earlyFront = new Map([
				['sVisit5Notes', 'pat newest'],
				['sVisit4Notes', 'pat middle'],
				['sVisit3Notes', 'pat oldest'],
			]);
			mount('Pat.md', earlyFront, earlyWrites);
			const carried = Array.from(preview.querySelectorAll('textarea.rv-native-notes-area')) as HTMLTextAreaElement[];
			assert.deepEqual(carried.map((area) => area.value), ['pat newest', 'pat middle', 'pat oldest']);
			assert.equal(carried.some((area) => area.value.includes('from bo')), false);
			assert.deepEqual(carried.map((area) => area.dataset.rvNoteFile), ['Pat.md', 'Pat.md', 'Pat.md']);
			assert.deepEqual(carried.map((area) => area.dataset.rvNoteKey), ['sVisit5Notes', 'sVisit4Notes', 'sVisit3Notes']);
			const patFront = fill({ sVisit5Notes: 'pat newest', sVisit4Notes: 'pat middle', sVisit3Notes: 'pat oldest' });
			const patWrites: Array<[string, string]> = [];
			mount('Pat.md', patFront, patWrites);
			const patAreas = Array.from(preview.querySelectorAll('textarea.rv-native-notes-area')) as HTMLTextAreaElement[];
			assert.equal(preview.querySelectorAll('h5.rv-visit-stamp').length, 3);
			assert.deepEqual(patAreas.map((area) => area.value), ['pat newest', 'pat middle', 'pat oldest']);
			assert.equal(patAreas.some((area) => area.value.includes('from bo')), false);
			assert.deepEqual(patAreas.map((area) => area.dataset.rvNoteFile), ['Pat.md', 'Pat.md', 'Pat.md']);
			assert.deepEqual(patAreas.map((area) => area.dataset.rvNoteKey), ['sVisit5Notes', 'sVisit4Notes', 'sVisit3Notes']);
			const patBox = patAreas[1];
			assert.ok(patBox);
			patBox.focus();
			patBox.value = 'from pat';
			patBox.setSelectionRange(4, 4);
			patBox.dispatchEvent(new window.Event('input', { bubbles: true }));
			return new Promise<void>((resolve, reject) => {
				setTimeout(() => {
					try {
						assert.deepEqual(boWrites, []);
						assert.deepEqual(patWrites, [['sVisit4Notes', 'from pat']]);
						assert.equal(patFront.get('sVisit3Notes'), 'pat oldest');
						assert.equal(boFront.get('sVisit4Notes'), 'bo middle');
						clearVisitNoteCaches();
						const again = fill({
							sVisit5Notes: boFront.get('sVisit5Notes') ?? '',
							sVisit4Notes: boFront.get('sVisit4Notes') ?? '',
							sVisit3Notes: boFront.get('sVisit3Notes') ?? '',
						});
						const againWrites: Array<[string, string]> = [];
						mount('Bo.md', again, againWrites);
						const back = Array.from(preview.querySelectorAll('textarea.rv-native-notes-area')) as HTMLTextAreaElement[];
						assert.deepEqual(back.map((area) => area.value), ['bo newest', 'bo middle', 'bo oldest']);
						assert.equal(back.some((area) => area.value.includes('from pat')), false);
						assert.deepEqual(back.map((area) => area.dataset.rvNoteFile), ['Bo.md', 'Bo.md', 'Bo.md']);
						preview.remove();
						resolve();
					} catch (error) {
						reject(error);
					} finally {
						clearVisitNoteCaches();
						setActiveVisitNote('');
					}
				}, 450);
			});
		} catch (error) {
			clearVisitNoteCaches();
			setActiveVisitNote('');
			preview.remove();
			throw error;
		}
	});

	it('rebuilds every Reading visit box when one view opens A, then B, then C, then A', () => {
		const main = readFileSync('src/main.ts', 'utf8');
		assert.match(main, /scheduleReadingDecorate\(file\)/);
		assert.equal(main.includes('surfaceMatches'), false);
		const notes = [
			{
				path: 'A.md',
				stamps: [
					'Mon, 9:00am — Sep 1, 2026',
					'Tue, 10:00am — Sep 2, 2026',
					'Wed, 11:00am — Sep 3, 2026',
					'Thu, 12:00pm — Sep 4, 2026',
				],
			},
			{
				path: 'B.md',
				stamps: [
					'Fri, 1:00pm — Sep 5, 2026',
					'Sat, 2:00pm — Sep 6, 2026',
				],
			},
			{
				path: 'C.md',
				stamps: [
					'Sun, 3:00pm — Sep 7, 2026',
					'Mon, 4:00pm — Sep 8, 2026',
					'Tue, 5:00pm — Sep 9, 2026',
					'Wed, 6:00pm — Sep 10, 2026',
					'Thu, 7:00pm — Sep 11, 2026',
				],
			},
		] as const;
		const preview = window.document.createElement('div');
		preview.className = 'markdown-preview-view markdown-reading-view';
		const sizer = window.document.createElement('div');
		sizer.className = 'markdown-preview-sizer markdown-preview-section';
		preview.appendChild(sizer);
		window.document.body.appendChild(preview);
		let previous = '';
		const paint = (note: { path: string; stamps: readonly string[] }): void => {
			sizer.replaceChildren();
			for (const stamp of note.stamps) {
				const heading = window.document.createElement('div');
				heading.className = 'markdown-preview-section';
				heading.innerHTML = `<div class="el-h5"><h5>${stamp}</h5></div>`;
				const paragraph = window.document.createElement('div');
				paragraph.className = 'markdown-preview-section';
				paragraph.innerHTML = '<div class="el-p"><p><code>INPUT[textArea:sVisit1Notes]</code></p></div>';
				sizer.append(heading, paragraph);
			}
			if (previous) {
				const stale = window.document.createElement('textarea');
				stale.className = 'rv-native-notes-area';
				stale.dataset.rvNoteFile = previous;
				preview.dataset.rvNoteFile = previous;
				preview.appendChild(stale);
				stale.focus();
			}
			const markdown = note.stamps.map((stamp) => `##### ${stamp}`).join('\n');
			decorateReadingSurface(preview, markdown, {
				newestFirst: true,
				collapseOlder: true,
				limit: 3,
			}, note.path);
			const boxes = sizer.querySelectorAll('.rv-visit-note-box');
			assert.equal(boxes.length, note.stamps.length, note.path);
			assert.equal(sizer.querySelectorAll('h5.rv-visit-stamp').length, note.stamps.length, note.path);
			const older = preview.querySelector('.rv-older-visits');
			if (note.stamps.length > 3) assert.ok(older, note.path);
			else assert.equal(older, null, note.path);
			previous = note.path;
		};
		try {
			paint(notes[0]);
			paint(notes[1]);
			paint(notes[2]);
			paint(notes[0]);
		} finally {
			preview.remove();
		}
	});

	it('does not focus a textarea on a note switch, and one focused box does not block the others', () => {
		clearVisitNoteCaches();
		const preview = window.document.createElement('div');
		preview.className = 'markdown-preview-view markdown-reading-view';
		const sizer = window.document.createElement('div');
		sizer.className = 'markdown-preview-sizer';
		preview.appendChild(sizer);
		window.document.body.appendChild(preview);
		const paint = (stamps: readonly string[], keys: readonly string[]): void => {
			sizer.replaceChildren();
			stamps.forEach((stamp, index) => {
				const heading = window.document.createElement('div');
				heading.className = 'markdown-preview-section';
				heading.innerHTML = `<div class="el-h5"><h5>${stamp}</h5></div>`;
				const note = window.document.createElement('div');
				note.className = 'markdown-preview-section';
				note.innerHTML = `<div class="el-p"><p><code>INPUT[textArea:${keys[index]}]</code></p></div>`;
				sizer.append(heading, note);
			});
			preview.dataset.rvNoteFile = '';
			decorateVisitControls(preview, () => null, () => {});
			rehoistVisitNotes(preview);
		};
		const mount = (path: string, keys: readonly string[], front: Map<string, string>): void => {
			setActiveVisitNote(path);
			preview.dataset.rvNoteFile = path;
			mountRawVisitNotes(preview, (key) => front.get(key) ?? '', () => {}, keys, path);
		};
		const aStamps = ['Mon, 9:00am — Sep 1, 2026', 'Tue, 10:00am — Sep 2, 2026', 'Wed, 11:00am — Sep 3, 2026'] as const;
		const aKeys = ['sVisit1Notes', 'sVisit2Notes', 'sVisit3Notes'] as const;
		try {
			paint(aStamps, aKeys);
			const front = new Map(aKeys.map((key) => [key, '']));
			mount('A.md', aKeys, front);
			mount('A.md', aKeys, front);
			preview.querySelectorAll('textarea.rv-native-notes-area').forEach((node) => node.remove());
			mount('A.md', aKeys, front);
			assert.notEqual(window.document.activeElement?.tagName, 'TEXTAREA');
			const typed = preview.querySelector('textarea.rv-native-notes-area');
			assert.ok(typed instanceof window.HTMLTextAreaElement);
			typed.focus();
			typed.value = 'from a';
			typed.setSelectionRange(2, 2);
			typed.dispatchEvent(new window.Event('input', { bubbles: true }));
			clearVisitNoteCaches();
			setActiveVisitNote('B.md');
			const bStamps = ['Thu, 2:10pm — Sep 17, 2026', 'Fri, 3:10pm — Sep 18, 2026'] as const;
			const bKeys = ['sVisit1Notes', 'sVisit2Notes'] as const;
			paint(bStamps, bKeys);
			assert.equal(readingDomIsStale(preview, bStamps.map((stamp) => `##### ${stamp}`).join('\n')), false);
			assert.equal(readingDomIsStale(preview, aStamps.map((stamp) => `##### ${stamp}`).join('\n')), true);
			const raw = preview.querySelector('h5');
			assert.ok(raw instanceof window.HTMLElement);
			raw.textContent = bStamps[0];
			raw.classList.add('rv-visit-stamp');
			raw.dataset.rvNoteFile = 'B.md';
			preview.dataset.rvNoteFile = 'B.md';
			const stray = window.document.createElement('div');
			stray.className = 'rv-visit-note-box';
			raw.insertAdjacentElement('afterend', stray);
			assert.equal(visitLayoutMissing(preview), true);
			mount('B.md', bKeys, new Map(bKeys.map((key) => [key, 'b'])));
			assert.notEqual(window.document.activeElement?.tagName, 'TEXTAREA');
			assert.equal(sizer.querySelectorAll('h5.rv-visit-stamp').length, bStamps.length);
			const held = preview.querySelector('textarea.rv-native-notes-area');
			assert.ok(held instanceof window.HTMLTextAreaElement);
			held.focus();
			held.value = 'keep';
			held.setSelectionRange(1, 1);
			held.dispatchEvent(new window.Event('input', { bubbles: true }));
			held.dispatchEvent(new window.KeyboardEvent('keyup', { bubbles: true }));
			const focusedKey = held.dataset.rvNoteKey;
			const headings = Array.from(preview.querySelectorAll('h5'));
			const other = headings[1];
			assert.ok(other instanceof window.HTMLElement);
			other.classList.remove('rv-visit-stamp');
			other.querySelectorAll('.rv-stamp-row, .rv-stamp-source, .rv-visit-more').forEach((node) => node.remove());
			other.textContent = bStamps[1];
			decorateVisitControls(preview, () => null, () => {});
			rehoistVisitNotes(preview);
			assert.equal(other.classList.contains('rv-visit-stamp'), true);
			assert.equal(preview.querySelectorAll('h5.rv-visit-stamp').length, bStamps.length);
			assert.equal(window.document.activeElement, held);
			assert.equal(held.selectionStart, 1);
			held.remove();
			mount('B.md', bKeys, new Map([['sVisit1Notes', 'keep'], ['sVisit2Notes', 'b']]));
			const restored = Array.from(preview.querySelectorAll('textarea.rv-native-notes-area')).find((node) => node.dataset.rvNoteKey === focusedKey);
			assert.ok(restored instanceof window.HTMLTextAreaElement);
			assert.equal(window.document.activeElement, restored);
			assert.equal(restored.selectionStart, 1);
			assert.equal(restored.selectionEnd, 1);
			const untouched = window.document.createElement('textarea');
			untouched.className = 'rv-native-notes-area';
			preview.appendChild(untouched);
			holdVisitNote(untouched, 2500, false);
			untouched.blur();
			restoreHeldNote();
			assert.notEqual(window.document.activeElement, untouched);
		} finally {
			preview.remove();
			clearVisitNoteCaches();
		}
	});

	it('draws a centered chevron on the companion and literature dropdown', () => {
		const css = readFileSync('styles.css', 'utf8');
		const suggest = readFileSync('src/suggest-field.ts', 'utf8');
		assert.equal(suggest.includes('setIcon'), false);
		assert.match(suggest, /m6 9 6 6 6-6/);
		assert.match(css, /\.rv-locator-modal button\.rv-suggest-chevron > svg,\s*\.rv-suggest-chevron svg \{\s*display:\s*block;\s*width:\s*16px;\s*height:\s*16px;/);
		assert.match(css, /\.rv-locator-modal button\.rv-suggest-chevron,\s*button\.rv-suggest-chevron \{\s*display:\s*inline-flex;\s*align-items:\s*center;\s*justify-content:\s*center;/);
		const frame = window.document.createElement('div');
		frame.className = 'rv-locator-modal';
		const input = window.document.createElement('input');
		frame.appendChild(input);
		window.document.body.appendChild(frame);
		mountAlwaysChevron(input, () => ['Mom'], () => {});
		const button = frame.querySelector('button.rv-suggest-chevron');
		assert.ok(button instanceof window.HTMLButtonElement);
		assert.equal(button.getAttribute('aria-label'), 'Show suggestions');
		assert.equal(button.querySelector('path')?.getAttribute('d'), 'm6 9 6 6 6-6');
		const svg = button.querySelector('svg');
		assert.equal(svg?.getAttribute('width'), '16');
		assert.equal(svg?.getAttribute('height'), '16');
		assert.equal(button.childElementCount, 1);
		frame.remove();
	});

});
