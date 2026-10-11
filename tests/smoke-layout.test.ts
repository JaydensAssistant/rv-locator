import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { decorateAttemptLog, isLogCalloutTitle } from '../src/attempt-digest';
import { stampAgeCount } from '../src/dates';
import { decorateNoteChrome, type NoteChromeHost } from '../src/note-chrome';
import { shouldHideStatusBar } from '../src/status-bar';
import { refreshStampAgeLabels } from '../src/rv-note-view';
import { DEFAULT_SETTINGS } from '../src/types';
import { decorateVisitControls } from '../src/visit-controls';

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

});
