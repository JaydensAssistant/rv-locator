import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { appendBadge, clearBadgeStrokeCache, pinBadgeRings } from '../src/glancable-view';
import { revealHubCard } from '../src/hub-layout';
import { clampMapSplit, mergeSettings } from '../src/types';

function source(file: string): string {
	return readFileSync(file, 'utf8');
}

describe('RV-B56 rings stay thick on the hub and the note', () => {
	it('strokes a hub card after it is inserted with the same width as the note', () => {
		clearBadgeStrokeCache();
		const dom = new JSDOM('<!doctype html><body></body>');
		const win = dom.window;
		globalThis.HTMLElement = win.HTMLElement;
		globalThis.Element = win.Element;
		globalThis.SVGElement = win.SVGElement;
		const real = win.getComputedStyle.bind(win);
		win.getComputedStyle = ((elt: Element) => {
			const style = real(elt);
			if (elt instanceof win.HTMLElement && elt.style.visibility === 'hidden' && (elt.style.borderTopWidth === '2px' || elt.style.borderWidth === '2px')) {
				return { borderTopWidth: '1.02px' } as CSSStyleDeclaration;
			}
			return style;
		}) as typeof win.getComputedStyle;
		const fragment = win.document.createElement('div');
		const hub = appendBadge(fragment, { kind: 'urgency', glyphs: '○', band: 0, label: 'Urgency' });
		const ring = hub.querySelector('circle.is-ring');
		assert.ok(ring instanceof win.SVGElement);
		assert.equal(hub.dataset.rvStrokePx, undefined);
		const noteHost = win.document.createElement('div');
		noteHost.className = 'rv-qf-badges';
		win.document.body.appendChild(noteHost);
		const note = appendBadge(noteHost, { kind: 'urgency', glyphs: '○', band: 0, label: 'Urgency' });
		const noteRing = note.querySelector('circle.is-ring');
		win.document.body.appendChild(fragment);
		try {
			pinBadgeRings(win.document.body);
			assert.equal(hub.isConnected, true);
			assert.notEqual(hub.dataset.rvStrokePx, '2px');
			assert.equal(hub.dataset.rvStrokePx, note.dataset.rvStrokePx);
			assert.equal(hub.style.getPropertyValue('border-width'), note.style.getPropertyValue('border-width'));
			assert.equal(ring.style.getPropertyValue('stroke-width'), noteRing instanceof win.SVGElement ? noteRing.style.getPropertyValue('stroke-width') : '');
			assert.match(source('src/glancable-view.ts'), /strokeHubRings\(\)/);
			assert.match(source('src/map-view.ts'), /pinBadgeRings\(layer\)/);
		} finally {
			win.getComputedStyle = real;
			clearBadgeStrokeCache();
		}
	});
});

describe('RV-B57 the grip is the white pill', () => {
	it('uses the note capsule on the hub, the base, and the note', () => {
		const css = source('styles.css');
		const stacked = css.slice(css.indexOf('.rv-locator-view.is-hub-map.is-stacked .rv-hub-map-handle::before'), css.indexOf('.rv-locator-view.is-hub-map.is-stacked .rv-hub-map-handle::after'));
		assert.match(stacked, /width:\s*40px;\s*\n\theight:\s*5px;/);
		assert.match(stacked, /background:\s*#fff;/);
		assert.match(stacked, /box-shadow:\s*0 0 0 1px #000;/);
		const side = css.slice(css.indexOf('.rv-locator-view.is-side-map .rv-hub-map-handle::before'), css.indexOf('.rv-locator-view.is-side-map .rv-hub-map-handle::after'));
		assert.match(side, /width:\s*5px;\s*\n\theight:\s*40px;/);
		assert.match(side, /background:\s*#fff;/);
		const note = css.slice(css.indexOf('.workspace-leaf-content.is-note-map > .rv-note-map-handle::before'), css.indexOf('.workspace-leaf-content.is-note-map > .rv-note-map-handle::after'));
		assert.match(note, /width:\s*40px;\s*\n\theight:\s*5px;/);
		assert.match(note, /background:\s*#fff;/);
		assert.match(note, /box-shadow:\s*0 0 0 1px #000;/);
		assert.doesNotMatch(css, /\.rv-hub-map-handle[^,{]*\{[^}]*background-modifier-border/);
	});
});

describe('RV-B58 one remembered map size', () => {
	it('stores one split for the hub and the note and keeps both clamps', () => {
		assert.equal(mergeSettings({}).mapSplitRatio, 0.42);
		assert.equal(mergeSettings({ mapSplitRatio: 0.55 }).mapSplitRatio, 0.55);
		assert.equal(mergeSettings({ mapSplitRatio: 9 }).mapSplitRatio, 0.42);
		assert.equal(mergeSettings({ mapSplitRatio: -1 }).mapSplitRatio, 0.42);
		assert.equal(clampMapSplit(0.05, 'hub'), 0.05);
		assert.equal(clampMapSplit(0.05, 'note'), 0.18);
		assert.equal(clampMapSplit(0.9, 'note'), 0.72);
		const main = source('src/main.ts');
		const glance = source('src/glancable-view.ts');
		assert.match(main, /rememberMapSplit\(start \+ delta, 'note'\)/);
		assert.match(main, /commitMapSplit\(\)/);
		assert.match(glance, /rememberMapSplit\(start \+ delta, 'hub'\)/);
		assert.doesNotMatch(glance, /private hubMapRatio/);
		assert.doesNotMatch(main, /private noteMapRatio/);
	});
});

describe('RV-B59 a jump shades the card', () => {
	it('never adds rv-card-flash or an outline', () => {
		const css = source('styles.css');
		assert.doesNotMatch(css, /\.rv-card-flash/);
		const land = css.slice(css.indexOf('.rv-locator-card.rv-card-land::after'), css.indexOf('@keyframes rv-land-fade'));
		assert.match(land, /background:\s*var\(--rv-land/);
		assert.doesNotMatch(land, /outline|box-shadow/);
		const layout = source('src/hub-layout.ts');
		const reveal = layout.slice(layout.indexOf('export function revealHubCard'), layout.indexOf('export function shadeHubCard'));
		assert.match(reveal, /shadeHubCard\(card\)/);
		assert.doesNotMatch(reveal, /classList\.add\('rv-card-flash'\)/);
		const glance = source('src/glancable-view.ts');
		const flash = glance.slice(glance.indexOf('private flashCard'), glance.indexOf('private mapCell'));
		assert.match(flash, /revealHubCard\(this\.scrollEl, card\)/);
		assert.doesNotMatch(flash, /classList\.add\('rv-card-flash'\)/);
		assert.doesNotMatch(flash, /outline/);
		const dom = new JSDOM('<!doctype html><body></body>');
		const doc = dom.window.document;
		globalThis.HTMLElement = dom.window.HTMLElement;
		globalThis.Element = dom.window.Element;
		const scroll = doc.createElement('div');
		scroll.className = 'rv-locator-scroll';
		const card = doc.createElement('div');
		card.className = 'rv-locator-card';
		scroll.appendChild(card);
		doc.body.appendChild(scroll);
		revealHubCard(scroll, card);
		assert.equal(card.classList.contains('rv-card-land'), true);
		assert.equal(card.classList.contains('rv-card-flash'), false);
	});
});
