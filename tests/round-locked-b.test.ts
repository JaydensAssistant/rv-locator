import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { appendBadge, clearBadgeStrokeCache, pinBadgeRings } from '../src/glancable-view';
import { applyNoteMapFrame, mapBandPx, mapPanePx, revealHubCard, STACKED_HANDLE_PX, writeMapBand } from '../src/hub-layout';
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

describe('RV-B60 title icons share one 18px box', () => {
	it('sizes the status glyph like the campaign glyph, including icon-size', () => {
		const css = source('styles.css');
		assert.match(css, /\.rv-dashboard \.rv-dash-status,\s*\n\.rv-dashboard \.rv-dash-status svg,[\s\S]{0,80}width:\s*18px;\s*height:\s*18px;\s*--icon-size:\s*18px;/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-status-icon svg[\s\S]{0,600}--icon-size:/);
		assert.match(css, /\.rv-locator-card-name \.rv-locator-campaign-mark svg \{[^}]*--icon-size:/);
		assert.match(css, /\.inline-title \.rv-note-status svg \{[^}]*--icon-size:\s*1em;/);
	});
});

describe('RV-B61 the divider is the note\'s 3px bar', () => {
	it('uses a 3px black bar and a 44px hit on the hub and the base', () => {
		assert.equal(STACKED_HANDLE_PX, 3);
		const css = source('styles.css');
		const stacked = css.slice(css.indexOf('.rv-locator-view.is-hub-map.is-stacked .rv-hub-map-handle {'), css.indexOf('.rv-locator-view.is-hub-map.is-stacked .rv-hub-map-handle::before'));
		assert.match(stacked, /flex:\s*0 0 3px/);
		assert.match(stacked, /height:\s*3px/);
		assert.match(stacked, /background:\s*#000/);
		assert.doesNotMatch(stacked, /linear-gradient/);
		const side = css.slice(css.indexOf('.rv-locator-view.is-side-map .rv-hub-map-handle {'), css.indexOf('.rv-locator-view.is-side-map .rv-hub-map-handle::before'));
		assert.match(side, /flex:\s*0 0 3px/);
		assert.match(side, /width:\s*3px/);
		assert.match(side, /background:\s*#000/);
		assert.match(css, /\.rv-hub-map-handle::before \{[^}]*background:\s*#fff/);
		assert.match(css, /\.rv-hub-map-handle::after \{[^}]*width:\s*44px;[^}]*height:\s*44px/);
	});
});

describe('RV-B62 the note map stays on the note, at the hub\'s pixel height', () => {
	it('refuses is-note-map on a hub leaf and shares one pixel band', () => {
		const dom = new JSDOM('<!doctype html><body></body>');
		const doc = dom.window.document;
		globalThis.HTMLElement = dom.window.HTMLElement;
		globalThis.Element = dom.window.Element;
		const hub = doc.createElement('div');
		hub.className = 'workspace-leaf-content is-note-map is-note-map-side';
		const view = doc.createElement('div');
		view.className = 'view-content';
		const glance = doc.createElement('div');
		glance.className = 'rv-locator-view';
		view.appendChild(glance);
		hub.appendChild(view);
		applyNoteMapFrame(hub, 393);
		assert.equal(hub.classList.contains('is-note-map'), false);
		assert.equal(hub.classList.contains('is-note-map-side'), false);
		const note = doc.createElement('div');
		note.className = 'workspace-leaf-content';
		applyNoteMapFrame(note, 393);
		assert.equal(note.classList.contains('is-note-map'), true);
		assert.equal(note.classList.contains('is-note-map-side'), false);
		const ratio = 0.50667;
		const leaf = doc.createElement('div');
		const header = doc.createElement('div');
		header.className = 'view-header';
		leaf.appendChild(header);
		leaf.getBoundingClientRect = () => ({ width: 393, height: 807.6, top: 0, left: 0, bottom: 807.6, right: 393, x: 0, y: 0, toJSON() { return {}; } }) as DOMRect;
		header.getBoundingClientRect = () => ({ width: 393, height: 45, top: 0, left: 0, bottom: 45, right: 393, x: 0, y: 0, toJSON() { return {}; } }) as DOMRect;
		const pane = mapPanePx(leaf, false);
		assert.equal(pane, 807.6 - 45);
		const px = mapBandPx(pane, ratio);
		assert.equal(px, Math.round(pane * ratio));
		const noteHost = doc.createElement('div');
		const hubHost = doc.createElement('div');
		writeMapBand(noteHost, pane, ratio, '--rv-note-map');
		writeMapBand(hubHost, pane, ratio, '--rv-map-size');
		assert.equal(noteHost.style.getPropertyValue('--rv-note-map'), `${px}px`);
		assert.equal(hubHost.style.getPropertyValue('--rv-map-size'), noteHost.style.getPropertyValue('--rv-note-map'));
		writeMapBand(hubHost, 0, ratio, '--rv-map-size');
		assert.equal(hubHost.style.getPropertyValue('--rv-map-size'), '51%');
		const main = source('src/main.ts');
		const glanceSrc = source('src/glancable-view.ts');
		const map = source('src/map-view.ts');
		assert.match(main, /leafHoldsHub\(content\)/);
		assert.match(main, /this\.noteMapHost\(\) !== content/);
		assert.match(main, /paintNoteMapBand\(content\)/);
		assert.match(glanceSrc, /querySelector\('\.rv-hub-swap-cover'\)/);
		assert.match(glanceSrc, /writeMapBand\(this\.root/);
		assert.doesNotMatch(map, /applyNoteMapFrame/);
	});
});
