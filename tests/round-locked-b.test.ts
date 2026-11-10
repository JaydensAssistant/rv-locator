import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { APP_TABS, appBarSlotPx, appendAppSlot, dismissOpenMenus, keepMenuOnScreen } from '../src/app-bar';
import { appendBadge, clearBadgeStrokeCache, pinBadgeRings } from '../src/glancable-view';
import { applyNoteMapFrame, hubUsesStackedMap, mapBandPx, mapPanePx, revealHubCard, STACKED_HANDLE_PX, writeMapBand } from '../src/hub-layout';
import { mountNoteHubBar, openNoteFind, revealNoteMatch } from '../src/note-hub-bar';
import { buildAutocompleteUrl, buildCountySuggestUrl, countyGeocodeText, countyPlaceCacheKey, readCountyPlaceId } from '../src/address';
import { placeFilterParam } from '../src/home-base';
import { claimParkedMap, holdMapHeight, lockHandedMapBand, mapFrameOk, parkMapNode, pinHeldMapBand, relayMap, seatMapGrip } from '../src/map-handoff';
import { alignHubCover, holdLeafForHubPaint, releaseHubSwapCover } from '../src/hub-cover';
import { applyVisitChangeFrontmatter, editVisit, listVisits, removeVisit, visitFacts, visitWhenFrom } from '../src/visit-editor';
import { applyVisitBody, applyVisitFrontmatter, type VisitOutcome } from '../src/visit-log';
import { readVisitControls } from '../src/visit-modals';
import { hubAccentColor } from '../src/urgency-palette';
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
		assert.equal(hubHost.style.getPropertyValue('--rv-map-size'), `${px}px`);
		const fresh = doc.createElement('div');
		writeMapBand(fresh, 0, ratio, '--rv-map-size');
		assert.equal(fresh.style.getPropertyValue('--rv-map-size'), '51%');
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

describe('RV-B65 both title icons stay the text color', () => {
	it('keeps the 18px box and drops the status glyph from the urgency color', () => {
		const css = source('styles.css');
		const at = css.indexOf('.rv-dashboard .rv-dash-status svg,');
		const size = css.slice(at, css.indexOf('}', at));
		assert.match(size, /width:\s*18px;/);
		assert.match(size, /--icon-size:\s*18px;/);
		assert.doesNotMatch(size, /--rv-urgency-accent/);
		const neutralAt = css.indexOf('.rv-dashboard .callout[data-callout="quote"] > .callout-title .rv-dash-status,');
		const neutral = css.slice(neutralAt, css.indexOf('}', neutralAt));
		assert.match(neutral, /\.rv-dash-status svg,/);
		assert.match(neutral, /\.rv-dash-campaign svg \{/);
		assert.match(css.slice(neutralAt, neutralAt + 700), /color:\s*var\(--text-normal\) !important;/);
	});
});

describe('RV-B63 the city sits right after the street', () => {
	it('shrinks only the street and never ellipsizes the city', () => {
		const css = source('styles.css');
		const street = css.slice(css.indexOf('.rv-locator-glancable .rv-locator-card-street {'), css.indexOf('.rv-locator-glancable .rv-locator-when {'));
		const city = css.slice(css.indexOf('.rv-locator-glancable .rv-locator-city-lg {'), css.indexOf('.rv-locator-glancable .rv-locator-distance-lg {'));
		assert.match(street, /flex:\s*0 1 auto;/);
		assert.match(street, /min-width:\s*0;/);
		assert.match(street, /text-overflow:\s*ellipsis;/);
		assert.doesNotMatch(street, /flex:\s*1 1000 auto;/);
		assert.match(city, /flex:\s*0 0 auto;/);
		assert.match(city, /text-overflow:\s*clip;/);
		assert.doesNotMatch(city, /text-overflow:\s*ellipsis;/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-place \{[^}]*gap:\s*4px;/);
		const cards = source('src/glance-card.ts');
		assert.match(cards, /rv-locator-card-street/);
		assert.match(cards, /rv-locator-city-lg/);
		assert.match(cards, /rv-locator-distance-lg/);
	});
});

describe('RV-B64 a card earth never lights', () => {
	it('keeps the tap and the note map button, and drops the card on color', () => {
		const glance = source('src/glancable-view.ts');
		const main = source('src/main.ts');
		const css = source('styles.css');
		assert.match(glance, /toggleCardEarth\(row\.path\)/);
		assert.doesNotMatch(glance, /classList\.toggle\('is-on'/);
		assert.doesNotMatch(css, /\.rv-locator-place-earth\.is-on/);
		assert.match(css, /\.rv-dashboard a\.rv-map-button\.is-on/);
		assert.match(main, /earthIsOn\('card'/);
		assert.match(main, /\.rv-card-earth\.is-on/);
		assert.doesNotMatch(main, /earthIsOn\('card', flags, node\.dataset\.rvPath/);
	});
});

describe('RV-B67 the hub accent is band 0', () => {
	it('follows the palette, including a custom color, and leaves modal fallbacks', () => {
		assert.equal(hubAccentColor('cotton-candy', ['#111', '#222', '#333', '#444']), '#14ac87');
		assert.equal(hubAccentColor('custom', ['#abcdef', '#222', '#333', '#444']), '#abcdef');
		assert.equal(hubAccentColor('default', ['#111', '#222', '#333', '#444']), '#1f8a4c');
		const mixed = hubAccentColor('accent', ['#111', '#222', '#333', '#444'], '#14ac87');
		assert.match(mixed, /#14ac87/);
		assert.doesNotMatch(mixed, /var\(--interactive-accent\)/);
		const css = source('styles.css');
		assert.match(css, /--interactive-accent:\s*var\(--rv-hub-accent, #1f8a4c\);/);
		assert.match(css, /\.rv-may-cell\.is-may \{[^}]*var\(--rv-hub-accent, #1f8a4c\)/);
		assert.match(css, /--rv-modal-accent, #1f8a4c/);
		assert.match(source('src/main.ts'), /paintHubAccent\(/);
		assert.match(source('src/map-pins.ts'), /status === 'Active' && colors\[0\]/);
	});
});

describe('RV-B66 the note shows the hub bar', () => {
	it('keeps five labeled slots under the map', () => {
		const dom = new JSDOM('<!doctype html><body></body>');
		globalThis.HTMLElement = dom.window.HTMLElement;
		globalThis.Element = dom.window.Element;
		const leaf = dom.window.document.createElement('div');
		const calls: string[] = [];
		const bar = mountNoteHubBar(leaf, 'People/Ada.md', {
			noteMapLit: () => true,
			toggleMap: (path) => calls.push(`map:${path}`),
			createNewRv: () => calls.push('new'),
			openCampaign: () => calls.push('flag'),
			openSearch: (path) => calls.push(`search:${path}`),
			openHub: (path) => calls.push(`hub:${path}`),
		});
		const labels = [...bar.querySelectorAll('.rv-app-slot')].map((button) => button.getAttribute('aria-label'));
		assert.deepEqual(labels, ['Hub', 'Search', 'Campaign', 'Map', 'New']);
		(bar.querySelector('[aria-label="Hub"]') as HTMLButtonElement).click();
		(bar.querySelector('[aria-label="Search"]') as HTMLButtonElement).click();
		(bar.querySelector('[aria-label="Map"]') as HTMLButtonElement).click();
		(bar.querySelector('[aria-label="Campaign"]') as HTMLButtonElement).click();
		(bar.querySelector('[aria-label="New"]') as HTMLButtonElement).click();
		assert.deepEqual(calls, ['hub:People/Ada.md', 'search:People/Ada.md', 'map:People/Ada.md', 'flag', 'new']);
		assert.equal(bar.querySelector('.rv-note-bar-earth')?.classList.contains('is-on'), true);
		const css = source('styles.css');
		assert.match(css, /var\(--rv-note-map, minmax\(120px, 42%\)\)/);
		assert.match(css, /\.is-note-map > \.rv-note-hub-bar \{[^}]*grid-row:\s*5;/);
		const main = source('src/main.ts');
		assert.match(main, /openNoteFind\(/);
		assert.match(main, /openNoteHub\(/);
		assert.doesNotMatch(main, /openNoteBarSearch\(/);
		assert.match(main, /openCampaignModal\(\)/);
		assert.match(main, /this\.syncNoteHubBar\(\)/);
	});
});

describe('RV-B68 the note bar stays one row', () => {
	it('drops the hub sortbar sticky top on the note bar and both map variants', () => {
		const css = source('styles.css');
		const at = (selector: string): string => {
			const start = css.indexOf(selector);
			assert.ok(start >= 0, selector);
			return css.slice(start, css.indexOf('}', start));
		};
		const parked = at('.workspace-leaf-content.is-rv-note > .rv-note-hub-bar {');
		assert.match(parked, /position:\s*absolute;/);
		assert.match(parked, /top:\s*auto;/);
		assert.match(parked, /height:\s*auto;/);
		assert.match(parked, /bottom:\s*0;/);
		assert.doesNotMatch(parked, /position:\s*sticky/);
		const stacked = at('.workspace-leaf-content.is-rv-note.is-note-map > .rv-note-hub-bar {');
		assert.match(stacked, /top:\s*auto;/);
		assert.match(stacked, /height:\s*auto;/);
		const side = at('.workspace-leaf-content.is-rv-note.is-note-map.is-note-map-side > .rv-note-hub-bar {');
		assert.match(side, /top:\s*auto;/);
		assert.match(side, /height:\s*auto;/);
	});
});

describe('RV-254 the tab bar', () => {
	it('uses the same five labels, a scrolling sort row, and the note urgency accent', () => {
		const nearby = source('src/nearby-view.ts');
		const css = source('styles.css');
		const bar = source('src/app-bar.ts');
		assert.match(bar, /label: 'Hub', icon: 'house'/);
		assert.match(bar, /label: 'New', icon: 'plus'/);
		assert.match(nearby, /APP_TABS/);
		assert.match(source('src/note-hub-bar.ts'), /APP_TABS/);
		assert.match(nearby, /door-open/);
		assert.match(nearby, /'urgency', 'distance', 'attempted', 'spoke', 'priority', 'met', 'city', 'ideality'/);
		assert.match(css, /\.rv-app-bar > \.rv-app-slot/);
		assert.match(css, /text-overflow:\s*clip/);
		assert.match(css, /\.rv-note-hub-bar \{[^}]*--interactive-accent:\s*var\(--rv-urgency-accent/);
		assert.doesNotMatch(css, /\.rv-note-hub-bar,\s*\n\.internal-embed/);
		assert.match(css, /\.is-rv-app > \.view-header/);
	});
});

describe('RV-252 in-note find', () => {
	it('selects a word in the note and does not open the hub', () => {
		const dom = new JSDOM('<!doctype html><body><div class="view-content"><p>64 South Harrison Street</p></div></body>');
		globalThis.HTMLElement = dom.window.HTMLElement;
		globalThis.Element = dom.window.Element;
		const leaf = dom.window.document.body;
		const content = leaf.querySelector('.view-content') as HTMLElement;
		const index = revealNoteMatch(content, 'Harrison', 0);
		assert.equal(index, 0);
		openNoteFind(leaf);
		assert.ok(leaf.querySelector('.rv-note-find-input'));
		assert.match(source('src/main.ts'), /openNoteFindFor\(/);
	});
});

describe('RV-B70 one grip', () => {
	it('seats the pinned grip instead of creating another', () => {
		const dom = new JSDOM('<!doctype html><body></body>');
		globalThis.HTMLElement = dom.window.HTMLElement;
		globalThis.Element = dom.window.Element;
		const doc = dom.window.document;
		const grip = doc.createElement('div');
		grip.className = 'rv-note-map-handle rv-map-grip is-pinned';
		doc.body.appendChild(grip);
		const stage = doc.createElement('div');
		stage.className = 'rv-locator-stage';
		const map = doc.createElement('div');
		map.className = 'rv-hub-map';
		stage.appendChild(map);
		doc.body.appendChild(stage);
		const seated = seatMapGrip(stage, map);
		assert.equal(seated, grip);
		assert.equal(stage.querySelectorAll('.rv-hub-map-handle, .rv-note-map-handle').length, 1);
		assert.equal(grip.className, 'rv-hub-map-handle');
		assert.equal(grip.classList.contains('is-pinned'), false);
	});
});

describe('RV-B74 county search', () => {
	it('asks geocode search for the county and falls back when the home pass is empty', () => {
		assert.equal(countyGeocodeText('Citrus County, Florida'), 'Citrus County, Florida');
		assert.equal(countyGeocodeText('Citrus'), 'Citrus County');
		const url = new URL(buildCountySuggestUrl('Citrus County, Florida', 'test-key'));
		assert.match(url.pathname, /\/v1\/geocode\/search$/);
		assert.equal(url.searchParams.get('type'), null);
		assert.equal(url.searchParams.get('text'), 'Citrus County, Florida');
		assert.doesNotMatch(url.pathname, /autocomplete/);
		const body = {
			results: [
				{ place_id: 'street-id', result_type: 'building', county: 'Citrus County', state: 'Florida', formatted: '64 South Harrison Street, Beverly Hills, FL 34465' },
				{ place_id: 'citrus-ia', result_type: 'county', county: 'Citrus County', state: 'Iowa', state_code: 'IA' },
				{ place_id: 'citrus-id', result_type: 'county', county: 'Citrus County', state: 'Florida', state_code: 'FL', formatted: 'Citrus County, FL, United States of America' },
				{ place_id: 'marion-id', result_type: 'county', name: 'Marion County', state: 'Florida', state_code: 'FL' },
			],
		};
		const citrus = readCountyPlaceId(body, 'Citrus County, Florida');
		const marion = readCountyPlaceId(body, 'Marion County, FL');
		assert.equal(citrus, 'citrus-id');
		assert.equal(marion, 'marion-id');
		assert.equal(countyPlaceCacheKey('Citrus County, Florida'), countyPlaceCacheKey('Citrus County, FL'));
		assert.notEqual(countyPlaceCacheKey('Marion County, Florida'), countyPlaceCacheKey('Marion County, Iowa'));
		const place = placeFilterParam([citrus ?? '', marion ?? '']);
		const filtered = new URL(buildAutocompleteUrl('64 South Harrison', 'test-key', 'global', { placeFilter: place }));
		assert.equal(filtered.searchParams.get('filter'), 'place:citrus-id|place:marion-id');
		assert.equal(filtered.searchParams.get('type'), null);
		const main = source('src/main.ts');
		const home = main.slice(main.indexOf('async suggestAddressHome'), main.indexOf('private vaultAddressHits'));
		assert.ok(home.indexOf('countyPlaceIds') < home.indexOf('placeFilterParam'));
		assert.match(home, /autocompleteAddress\(query, bias, false, false, place, 10\)/);
		assert.match(main, /countyPlaceCache\.set\(key, id\)/);
		assert.match(main, /text\.length < 3/);
		assert.match(main, /needle\.length < 3/);
		assert.match(main, /planned\.hits\.length === 0\) return \{ hits: \[\], allowBroad: true/);
		assert.match(main, /return await this\.homeProximity\(\)/);
		assert.doesNotMatch(main, /suggestBias\(\): Promise<GeocodeBias \| null> \{\s*return this\.currentMapFix\(\)/);
		assert.match(source('src/address-suggest.ts'), /hits\.length === 0\) \{\s*this\.cache\.delete\(key\)/);
		assert.doesNotMatch(source('src/address.ts'), /searchParams\.set\('type', 'county'\)/);
	});
});

describe('RV-B72 selection and the address copy button', () => {
	it('uses the urgency accent in notes and the hub accent in the hub', () => {
		const css = source('styles.css');
		assert.match(css, /\.theme-light \.workspace-leaf-content\.is-rv-note ::selection/);
		assert.match(css, /\.theme-light \.rv-locator-view ::selection/);
		assert.match(css, /var\(--rv-urgency-accent, #1f8a4c\) 45%, transparent\) !important/);
		assert.match(css, /var\(--rv-hub-accent, #1f8a4c\) 45%, transparent\) !important/);
		assert.match(source('src/note-chrome.ts'), /Address copied/);
		assert.match(source('src/note-chrome.ts'), /setIcon\(copy, 'copy'\)/);
		assert.match(css, /\.rv-closed-title \.rv-type \{\s*color:\s*var\(--text-faint\)/);
		assert.match(css, /padding-left:\s*12px !important/);
		assert.match(css, /\.rv-qf-search:focus[\s\S]*border-radius:\s*0 !important/);
	});
});

describe('the hub, bases, and note bars share one geometry', () => {
	it('is full width with five equal slots and the same labels', () => {
		assert.equal(appBarSlotPx(390), 78);
		assert.equal(APP_TABS.length, 5);
		const css = source('styles.css');
		const sortbar = css.slice(
			css.indexOf('.rv-locator-glancable .rv-locator-sortbar {'),
			css.indexOf('}', css.indexOf('.rv-locator-glancable .rv-locator-sortbar {')),
		);
		assert.match(sortbar, /padding:\s*2px 0 0/);
		assert.doesNotMatch(sortbar, /4px/);
		assert.match(css, /\.rv-app-bar > \.rv-app-slot \{[^}]*flex:\s*1 1 0/);
		const noteRule = css.slice(
			css.indexOf('.workspace-leaf-content.is-rv-note > .rv-note-hub-bar {'),
			css.indexOf('}', css.indexOf('.workspace-leaf-content.is-rv-note > .rv-note-hub-bar {')),
		);
		assert.match(noteRule, /width:\s*100%/);
		assert.match(noteRule, /padding:\s*2px 0/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-sortbar:has\(> \.rv-app-bar\) \{[^}]*padding-left:\s*0/);
		const dom = new JSDOM('<!doctype html><body></body>');
		globalThis.HTMLElement = dom.window.HTMLElement;
		globalThis.Element = dom.window.Element;
		const leaf = dom.window.document.createElement('div');
		const note = mountNoteHubBar(leaf, 'People/Ada.md', {
			noteMapLit: () => false,
			toggleMap: () => {},
			createNewRv: () => {},
			openCampaign: () => {},
			openSearch: () => {},
			openHub: () => {},
		});
		const hub = dom.window.document.createElement('div');
		hub.className = 'rv-locator-sortbar rv-app-bar';
		for (const tab of APP_TABS) appendAppSlot(hub, tab.label, tab.icon, { extra: tab.id === 'map' ? 'rv-hub-earth' : '' });
		const noteSlots = Array.from(note.querySelectorAll('.rv-app-slot'));
		const hubSlots = Array.from(hub.querySelectorAll('.rv-app-slot'));
		assert.equal(noteSlots.length, hubSlots.length);
		noteSlots.forEach((slot, index) => {
			const other = hubSlots[index];
			assert.ok(other instanceof dom.window.HTMLElement);
			assert.equal(slot.querySelector('.rv-app-label')?.textContent, other.querySelector('.rv-app-label')?.textContent);
			assert.equal(slot.getAttribute('aria-label'), other.getAttribute('aria-label'));
			assert.equal(slot.classList.contains('rv-app-slot'), true);
		});
		assert.match(source('src/nearby-view.ts'), /for \(const tab of APP_TABS\)/);
		assert.match(css, /html\.theme-light \.workspace-leaf-content\.is-rv-app > \.view-header :is\(/);
		assert.match(css, /\.is-rv-app > \.view-header :is\([\s\S]*button/);
		assert.equal(hubUsesStackedMap(false, 0, false, 390), true);
		assert.equal(hubUsesStackedMap(false, 0), false);
		assert.match(source('src/glancable-view.ts'), /if \(specified < STROKE_TARGET_PX\) resolved = '2px'/);
		assert.match(source('src/nearby-view.ts'), /scrollIntoView/);
		assert.match(source('src/nearby-view.ts'), /keepMenuOnScreen/);
		assert.match(source('src/main.ts'), /keepMenuOnScreen/);
		assert.match(source('src/home-base.ts'), /Keep the user's spelling/);
		assert.match(css, /\.rv-locator-view\.is-hub-map\.is-stacked \.rv-hub-map > \.rv-map-stage \{[^}]*min-height:\s*120px !important/);
		assert.match(css, /\.rv-locator-card-actions \{[^}]*z-index:\s*4/);
		assert.match(css, /\.rv-visit-more \{[^}]*z-index:\s*2/);
		assert.match(css, /\.rv-hub-chip \{[^}]*min-width:\s*2\.5rem/);
	});
});

describe('phone smoke after 0db3626', () => {
	it('keeps the map in the sized park and does not clear the pixel lock on a timer', () => {
		const dom = new JSDOM('<!doctype html><body></body>');
		globalThis.HTMLElement = dom.window.HTMLElement;
		globalThis.Element = dom.window.Element;
		const doc = dom.window.document;
		const map = doc.createElement('div');
		map.className = 'rv-hub-map';
		const stage = doc.createElement('div');
		stage.className = 'rv-map-stage';
		stage.style.height = '320px';
		map.appendChild(stage);
		doc.body.appendChild(map);
		const holder = parkMapNode(map);
		const claimed = claimParkedMap(doc, 'rv-note-map');
		assert.equal(claimed, map);
		assert.equal(map.parentElement, holder);
		assert.equal(holder.classList.contains('rv-map-park'), true);
		const glance = source('src/glancable-view.ts');
		const laid = glance.slice(glance.indexOf('private releaseHandedBandWhenLaidOut'), glance.indexOf('private releaseHubGrip'));
		assert.match(laid, /lockHandedMapBand\(map, height\)/);
		assert.doesNotMatch(laid, /releaseHandedBandLock\(\)/);
		assert.match(glance, /retireEmptyMapPark/);
	});

	it('gives Visit options a real box and lets the menu stay on screen', () => {
		const css = source('styles.css');
		assert.match(css, /\.rv-visit-more \{[^}]*min-width:\s*32px !important/);
		assert.match(css, /\.rv-visit-more \{[^}]*min-height:\s*32px !important/);
		assert.match(css, /\.rv-visit-more svg \{[^}]*width:\s*18px !important/);
		assert.match(source('src/visit-controls.ts'), /aria-label': label/);
		assert.match(source('src/main.ts'), /editVisit\(body, entry, added/);
		assert.match(source('src/main.ts'), /removeVisit\(body, entry\)/);
		const dom = new JSDOM('<!doctype html><body></body>');
		const win = dom.window;
		globalThis.HTMLElement = win.HTMLElement;
		Object.defineProperty(win, 'innerHeight', { value: 801, configurable: true });
		Object.defineProperty(win, 'innerWidth', { value: 390, configurable: true });
		const anchor = win.document.createElement('button');
		const menu = win.document.createElement('div');
		menu.className = 'menu';
		const box = { top: 700, bottom: 801.5, left: 8, right: 200, width: 192, height: 101.5, x: 8, y: 700, toJSON: () => ({}) };
		menu.getBoundingClientRect = () => box;
		win.document.body.append(anchor, menu);
		keepMenuOnScreen(anchor);
		const top = Number.parseFloat(menu.style.top);
		assert.ok(top + box.height <= 801 - 12);
	});

	it('stops the hub cover from taking taps and from offsetting a second card', () => {
		const css = source('styles.css');
		const cover = css.slice(css.indexOf('.workspace-leaf > .rv-hub-swap-cover {'), css.indexOf('.workspace-leaf > .rv-hub-swap-cover > .view-header'));
		assert.match(cover, /pointer-events:\s*none !important/);
		const snapshot = css.slice(css.indexOf('.rv-hub-snapshot-body {'), css.indexOf('.rv-hub-snapshot-body > .rv-locator-view'));
		assert.match(snapshot, /padding-top:\s*env\(safe-area-inset-top, 0px\)/);
		assert.doesNotMatch(snapshot, /\+ 6px/);
		assert.match(source('src/glancable-view.ts'), /dropDuplicateCards/);
		assert.match(css, /\.rv-closed-title \{[^}]*color:\s*var\(--text-faint\)/);
		assert.match(css, /\.rv-closed-title \{[^}]*font-weight:\s*400/);
		assert.match(css, /list-style-position:\s*inside !important/);
		assert.match(css, /\.rv-qf-value\.is-overflow \.rv-qf-search-wrap/);
		assert.match(css, /\.rv-qf-search-wrap,\s*\n\.rv-qf-search-wrap:focus-within \{[^}]*border:\s*0 !important/);
		assert.match(css, /\.rv-qf-search-wrap,\s*\n\.rv-qf-search-wrap:focus-within \{[^}]*border-radius:\s*0 !important/);
		assert.match(css, /\.rv-qf-search-wrap,\s*\n\.rv-qf-search-wrap:focus-within \{[^}]*box-shadow:\s*none !important/);
		assert.match(css, /\.rv-qf-label \.rv-qf-plus,\s*\n\.rv-qf-label \.rv-qf-chevron \{[^}]*min-height:\s*28px !important/);
		assert.match(source('src/glancable-view.ts'), /borderTopWidth/);
		assert.match(source('src/note-chrome.ts'), /:scope > \.rv-qf-row/);
		assert.match(source('src/app-bar.ts'), /const margin = 12/);
	});
});

describe('phone smoke after d0b76ff', () => {
	it('floors a map stage that light theme measures at 0 on the way onto a note', () => {
		const dom = new JSDOM('<!doctype html><body></body>');
		globalThis.HTMLElement = dom.window.HTMLElement;
		globalThis.Element = dom.window.Element;
		const doc = dom.window.document;
		const map = doc.createElement('div');
		map.className = 'rv-note-map';
		const stage = doc.createElement('div');
		stage.className = 'rv-map-stage';
		map.appendChild(stage);
		doc.body.appendChild(map);
		lockHandedMapBand(map, 0);
		assert.equal(stage.style.getPropertyValue('height'), '120px');
		assert.equal(stage.style.getPropertyValue('min-height'), '120px');
		assert.equal(map.style.getPropertyValue('display'), 'flex');
		const css = source('styles.css');
		assert.match(css, /\.rv-hub-map > \.rv-map-stage,\s*\n\.rv-note-map > \.rv-map-stage,\s*\n\.rv-map-park \.rv-map-stage \{[^}]*min-height:\s*120px !important/);
		const glance = source('src/glancable-view.ts');
		const laid = glance.slice(glance.indexOf('private releaseHandedBandWhenLaidOut'), glance.indexOf('private releaseHubGrip'));
		assert.match(laid, /lockHandedMapBand\(map, height\)/);
		assert.match(source('src/main.ts'), /lockHandedMapBand\(map, laid\)/);
	});

	it('rewrites the stamp line from the controls Save is showing', () => {
		const dom = new JSDOM(`<!doctype html><body>
			<input type="date" value="2026-09-20">
			<select aria-label="Hour"><option value="2" selected>2</option></select>
			<select aria-label="Minute"><option value="15" selected>15</option></select>
			<select aria-label="AM or PM"><option value="PM" selected>PM</option></select>
		</body>`);
		globalThis.HTMLElement = dom.window.HTMLElement;
		const shown = readVisitControls(dom.window.document.body, { dateText: '2026-09-26', hour: 10, minute: 0 });
		const when = visitWhenFrom(shown.dateText, shown.hour, shown.minute);
		assert.ok(when);
		assert.equal(when.getFullYear(), 2026);
		assert.equal(when.getMonth(), 8);
		assert.equal(when.getDate(), 20);
		assert.equal(when.getHours(), 14);
		assert.equal(when.getMinutes(), 15);
		const note = [
			'### Recent Notes:',
			'##### Sat, 10am — Sep 26, 2026 <span class="rv-stamp-ago">3 days ago</span>',
			'`INPUT[textArea:sVisit1Notes]`',
			'Kept note.',
			'',
			'> [!example] Return Suggestions',
			'> > [!note]- Attempt Log',
			'> >- Sat, 10am — Sep 26, 2026 — success',
		].join('\n');
		const entry = listVisits(note).find((visit) => visit.headingLine != null);
		assert.ok(entry);
		const next = editVisit(note, entry, { when, home: true, companion: '' }, new Date(2026, 8, 29, 12));
		assert.match(next, /##### Sun, 2:15pm — Sep 20, 2026/);
		assert.doesNotMatch(next, /##### Sat, 10am — Sep 26, 2026/);
		assert.match(next, /Kept note\./);
		assert.match(source('src/visit-modals.ts'), /readVisitControls\(this\.contentEl/);
	});

	it('lines the cover card up with the live card and lets the tap through', () => {
		const dom = new JSDOM('<!doctype html><body></body>');
		globalThis.HTMLElement = dom.window.HTMLElement;
		globalThis.Element = dom.window.Element;
		const doc = dom.window.document;
		const cover = doc.createElement('div');
		cover.className = 'rv-hub-swap-cover';
		const body = doc.createElement('div');
		body.className = 'rv-hub-snapshot-body';
		const coverCard = doc.createElement('div');
		coverCard.className = 'rv-locator-card';
		coverCard.setAttribute('data-rv-path', 'Red Lane.md');
		coverCard.getBoundingClientRect = () => ({ top: 105, bottom: 180, left: 0, right: 0, width: 0, height: 75, x: 0, y: 105, toJSON() { return {}; } });
		body.appendChild(coverCard);
		cover.appendChild(body);
		const live = doc.createElement('div');
		live.className = 'rv-locator-card';
		live.setAttribute('data-rv-path', 'Red Lane.md');
		live.getBoundingClientRect = () => ({ top: 117, bottom: 192, left: 0, right: 0, width: 0, height: 75, x: 0, y: 117, toJSON() { return {}; } });
		doc.body.append(cover, live);
		alignHubCover(doc);
		assert.equal(body.style.transform, 'translateY(12px)');
		const css = source('styles.css');
		assert.match(css, /\.workspace-leaf > \.rv-hub-swap-cover,\s*\n\.workspace-leaf > \.rv-hub-swap-cover \* \{[^}]*pointer-events:\s*none !important/);
	});

	it('puts Return Suggestions bullets on the 12px content edge', () => {
		const css = source('styles.css');
		assert.match(css, /\.callout\.rv-locator-return-suggestions :is\(ul, ol, li\),[\s\S]*?\.callout\.rv-locator-return-suggestions \.callout :is\(ul, ol, li\)[\s\S]*?\{[^}]*padding-inline-start:\s*0 !important[^}]*list-style-position:\s*inside !important/);
		assert.match(css, /callout\.rv-locator-return-suggestions > \.callout-content > :is\(ul, ol\) \{[^}]*width:\s*100%/);
	});

	it('keeps the menu box 12px inside the viewport, and opens again after one is already there', () => {
		const dom = new JSDOM('<!doctype html><body></body>');
		const win = dom.window;
		globalThis.HTMLElement = win.HTMLElement;
		Object.defineProperty(win, 'innerHeight', { value: 801, configurable: true });
		Object.defineProperty(win, 'innerWidth', { value: 390, configurable: true });
		const stale = win.document.createElement('div');
		stale.className = 'menu';
		win.document.body.appendChild(stale);
		dismissOpenMenus(win.document);
		assert.equal(win.document.querySelector('.menu'), null);
		const anchor = win.document.createElement('button');
		const menu = win.document.createElement('div');
		menu.className = 'menu';
		let height = 0;
		const box = () => ({ top: 700, bottom: 700 + height, left: 8, right: 200, width: 192, height, x: 8, y: 700, toJSON: () => ({}) });
		menu.getBoundingClientRect = () => box();
		win.document.body.append(anchor, menu);
		const queue: Array<() => void> = [];
		win.requestAnimationFrame = (fn: () => void) => {
			queue.push(fn);
			return queue.length;
		};
		keepMenuOnScreen(anchor);
		assert.equal(menu.style.maxHeight, '');
		height = 101.5;
		queue.shift()?.();
		const top = Number.parseFloat(menu.style.top);
		const maxHeight = Number.parseFloat(menu.style.maxHeight);
		assert.equal(menu.style.bottom, 'auto');
		assert.ok(top >= 12);
		assert.ok(top + maxHeight <= 801 - 12);
		assert.ok(Number.parseFloat(menu.style.left) >= 12);
		const urgency = source('src/main.ts');
		const fn = urgency.slice(urgency.indexOf('promptUrgencyMenu('), urgency.indexOf('private openSnoozeModal'));
		assert.ok(fn.indexOf('dismissOpenMenus') >= 0);
		assert.ok(fn.indexOf('dismissOpenMenus') < fn.indexOf('new Menu('));
	});

	it('RV-B78 leaves Met at the creation time on disk', () => {
		const created = '2026-09-02T16:32:00';
		const seeded = [
			'---',
			'Address: "12 Red Lane"',
			`Met: "${created}"`,
			'Last Spoke: "2026-09-02T16:32:00"',
			'Last Attempted: "2026-09-02T16:32:00"',
			'Visits: 1',
			'Successful Visits: 1',
			'Met With: "Ada"',
			'Taken:',
			'  - "Ada"',
			'---',
			'',
			'### Recent Notes:',
			'##### Wed, 4:32pm — Sep 2, 2026',
			'`INPUT[textArea:sVisit1Notes]`',
			'',
			'> [!note]- Log',
			'> - Wed, 4:32pm — Sep 2, 2026 — success',
			'',
		].join('\n');
		const dir = mkdtempSync(join(tmpdir(), 'rv-met-'));
		try {
			const home = writeLogged(dir, 'home.md', seeded, 'home', new Date(2026, 9, 15, 14, 30, 0), 'Sam');
			assert.equal(metLine(home), `Met: "${created}"`);
			assert.match(home, /Last Attempted: "2026-10-15T14:30:00"/);
			assert.match(home, /Visits: 2/);
			assert.match(home, /Met With: "Ada"/);
			assert.match(home, /"Sam"/);
			const miss = writeLogged(dir, 'miss.md', seeded, 'miss', new Date(2026, 9, 16, 9, 5, 0), 'Pat');
			assert.equal(metLine(miss), `Met: "${created}"`);
			assert.match(miss, /Last Attempted: "2026-10-16T09:05:00"/);
			assert.match(miss, /Last Spoke: "2026-09-02T16:32:00"/);
			assert.match(miss, /Met With: "Ada"/);
			assert.doesNotMatch(miss, /Pat/);
			const edited = writeChanged(dir, 'edit.md', seeded, (body, frontmatter) => {
				const entry = listVisits(body)[0];
				assert.ok(entry);
				const when = new Date(2026, 8, 20, 14, 15, 0);
				const added = { ...visitFacts(entry), when, home: true, companion: 'Sam' };
				applyVisitChangeFrontmatter(frontmatter, {
					removed: visitFacts(entry),
					added,
					remaining: [],
					removedNotesProperty: entry.notesProperty,
				});
				return editVisit(body, entry, added, new Date(2026, 8, 29, 12));
			});
			assert.equal(metLine(edited), `Met: "${created}"`);
			assert.match(edited, /##### Sun, 2:15pm — Sep 20, 2026/);
			assert.doesNotMatch(edited, /##### Wed, 4:32pm — Sep 2, 2026/);
			const deleted = writeChanged(dir, 'delete.md', seeded, (body, frontmatter) => {
				const entry = listVisits(body)[0];
				assert.ok(entry);
				applyVisitChangeFrontmatter(frontmatter, {
					removed: visitFacts(entry),
					remaining: [],
					removedNotesProperty: entry.notesProperty,
				});
				return removeVisit(body, entry);
			});
			assert.equal(metLine(deleted), `Met: "${created}"`);
			assert.doesNotMatch(deleted, /##### Wed, 4:32pm — Sep 2, 2026/);
			assert.match(deleted, /Last Attempted: ""/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
		assert.match(source('extras/templater-metabind/New RV.md'), /Met: "<% rv\.created %>"/);
		assert.doesNotMatch(source('src/visit-editor.ts'), /syncMet|earliestNonFutureVisit/);
		assert.doesNotMatch(source('src/main.ts'), /syncMet|Met becomes/);
		assert.match(source('src/main.ts'), /Met is not changed\. Met With is not changed\./);
		assert.match(source('src/note-chrome.ts'), /factDateRow\(content, 'home', 'Met', readProperty\(data, 'Met'\)\)/);
	});

	it('leaves the body Last Attempted line to the template', () => {
		const template = source('extras/templater-metabind/New RV.md');
		assert.match(template, /\*\*Last Attempted\*\*/);
		assert.match(template, /INPUT\[dateTime:\["Last Attempted"\]\]/);
		const src = ['src/visit-log.ts', 'src/visit-editor.ts', 'src/main.ts', 'src/note-chrome.ts'].map((file) => source(file)).join('\n');
		assert.doesNotMatch(src, /\*\*Last Attempted\*\*/);
	});
});

describe('phone smoke of f78cc45', () => {
	it('locks the hub map height in the same turn the bases file opens', () => {
		const dom = new JSDOM('<!doctype html><body></body>');
		globalThis.HTMLElement = dom.window.HTMLElement;
		globalThis.Element = dom.window.Element;
		const doc = dom.window.document;
		const rect = (height: number) => () => ({ top: 0, bottom: height, left: 0, right: 390, width: 390, height, x: 0, y: 0, toJSON() { return {}; } });
		const map = doc.createElement('div');
		map.className = 'rv-hub-map';
		const stage = doc.createElement('div');
		stage.className = 'rv-map-stage';
		stage.getBoundingClientRect = rect(317);
		map.appendChild(stage);
		const grip = doc.createElement('div');
		grip.className = 'rv-hub-map-handle';
		const hub = doc.createElement('div');
		hub.className = 'rv-locator-view is-hub-map is-stacked';
		hub.append(grip, map);
		doc.body.appendChild(hub);
		holdMapHeight(map);
		assert.equal(stage.style.getPropertyValue('height'), '317px');
		stage.getBoundingClientRect = rect(0);
		holdMapHeight(map);
		assert.equal(stage.style.getPropertyValue('height'), '317px');
		assert.equal(stage.style.getPropertyValue('min-height'), '317px');
		hub.style.setProperty('--rv-map-size', '42%');
		pinHeldMapBand(hub, map);
		assert.equal(hub.style.getPropertyValue('--rv-map-size'), '317px');
		assert.equal(hub.style.getPropertyValue('--rv-note-map'), '317px');
		pinHeldMapBand(hub, map);
		assert.equal(hub.style.getPropertyValue('--rv-map-size'), '317px');
		const fresh = doc.createElement('div');
		fresh.className = 'rv-hub-map';
		const bare = doc.createElement('div');
		bare.className = 'rv-map-stage';
		bare.getBoundingClientRect = rect(0);
		fresh.appendChild(bare);
		holdMapHeight(fresh);
		assert.equal(bare.style.getPropertyValue('height'), '120px');
		const bases = doc.createElement('div');
		bases.className = 'rv-locator-stage';
		bases.appendChild(fresh);
		const seated = seatMapGrip(bases, fresh);
		assert.equal(seated.classList.contains('rv-hub-map-handle'), true);
		assert.equal(bases.contains(seated), true);
		const main = source('src/main.ts');
		const retain = main.slice(main.indexOf('private retainMapForHub'), main.indexOf('parkOpenMap(): boolean'));
		assert.match(retain, /this\.parkOpenMap\(\)/);
		assert.doesNotMatch(retain, /if \(this\.noteMapOpen\) this\.parkOpenMap\(\)/);
		const park = main.slice(main.indexOf('parkOpenMap(): boolean'), main.indexOf('private dropParkedMap'));
		assert.match(park, /relayMap\(/);
		assert.doesNotMatch(park, /parkMapNode\(/);
		const relay = source('src/map-handoff.ts').slice(source('src/map-handoff.ts').indexOf('export function relayMap'), source('src/map-handoff.ts').indexOf('export function parkMapNode'));
		assert.ok(relay.indexOf('holdMapHeight(map)') < relay.indexOf('appendChild'));
		assert.match(source('src/glancable-view.ts'), /pinHeldMapBand\(root, map\)/);
	});

	it('hides the live list while the hub cover is up and still lets a card take the tap', () => {
		const dom = new JSDOM('<!doctype html><body></body>');
		const win = dom.window;
		globalThis.HTMLElement = win.HTMLElement;
		globalThis.Element = win.Element;
		globalThis.MutationObserver = win.MutationObserver;
		const doc = win.document;
		const leaf = doc.createElement('div');
		leaf.className = 'workspace-leaf';
		leaf.textContent = 'Return Visits';
		leaf.getBoundingClientRect = () => ({ top: 0, bottom: 799, left: 0, right: 390, width: 390, height: 799, x: 0, y: 0, toJSON() { return {}; } });
		const live = doc.createElement('div');
		live.className = 'workspace-leaf-content';
		const card = doc.createElement('button');
		card.className = 'rv-locator-card';
		card.textContent = 'Red Lane';
		let taps = 0;
		card.addEventListener('click', () => { taps += 1; });
		live.appendChild(card);
		leaf.appendChild(live);
		doc.body.appendChild(leaf);
		holdLeafForHubPaint(leaf);
		assert.equal(leaf.classList.contains('is-rv-cover-held'), true);
		assert.ok(leaf.querySelector(':scope > .rv-hub-swap-cover'));
		card.dispatchEvent(new win.Event('click', { bubbles: true }));
		assert.equal(taps, 1);
		releaseHubSwapCover(doc);
		assert.equal(leaf.classList.contains('is-rv-cover-held'), false);
		assert.equal(leaf.querySelector('.rv-hub-swap-cover'), null);
		const css = source('styles.css');
		const selector = '.workspace-leaf.is-rv-cover-held > :not(.rv-hub-swap-cover):not(.rv-hub-map):not(.rv-note-map)';
		const rule = css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)));
		assert.match(rule, /opacity:\s*0 !important/);
		assert.doesNotMatch(rule, /pointer-events/);
		assert.match(css, /\.workspace-leaf > \.rv-hub-swap-cover,\s*\n\.workspace-leaf > \.rv-hub-swap-cover \* \{[^}]*pointer-events:\s*none !important/);
		assert.match(css, /\.workspace-leaf > \.rv-hub-swap-cover \.rv-locator-card \* \{[^}]*pointer-events:\s*auto !important/);
	});

	it('keeps one connected stage through hub, base, and note', async () => {
		const dom = new JSDOM('<!doctype html><body></body>');
		const win = dom.window;
		globalThis.HTMLElement = win.HTMLElement;
		globalThis.Element = win.Element;
		globalThis.MutationObserver = win.MutationObserver;
		const doc = win.document;
		const leaf = doc.createElement('div');
		leaf.className = 'workspace-leaf';
		const hub = doc.createElement('div');
		hub.className = 'rv-locator-stage';
		const base = doc.createElement('div');
		base.className = 'rv-locator-stage';
		const note = doc.createElement('div');
		note.className = 'markdown-preview-view';
		const map = doc.createElement('div');
		map.className = 'rv-hub-map';
		const stage = doc.createElement('div');
		stage.className = 'rv-map-stage';
		stage.getBoundingClientRect = () => ({ top: 0, bottom: 316, left: 0, right: 390, width: 390, height: 316, x: 0, y: 0, toJSON() { return {}; } });
		map.appendChild(stage);
		hub.appendChild(map);
		leaf.append(hub, base, note);
		doc.body.appendChild(leaf);
		const frames: boolean[] = [];
		const sample = (): void => { frames.push(mapFrameOk(doc)); };
		const observer = new win.MutationObserver(() => sample());
		observer.observe(doc.body, { childList: true, subtree: true, attributes: true });
		const hops: Array<[HTMLElement, 'rv-hub-map' | 'rv-note-map']> = [
			[base, 'rv-hub-map'],
			[hub, 'rv-hub-map'],
			[note, 'rv-note-map'],
			[hub, 'rv-hub-map'],
			[base, 'rv-hub-map'],
		];
		for (const [host, className] of hops) {
			relayMap(map, host, className);
			sample();
			assert.equal(map.parentElement, host);
			assert.equal(doc.querySelectorAll('.rv-map-stage').length, 1);
			await Promise.resolve();
		}
		hub.style.opacity = '0';
		relayMap(map, hub, 'rv-hub-map');
		sample();
		await Promise.resolve();
		assert.equal(map.parentElement, leaf);
		assert.notEqual(map.parentElement, doc.body);
		assert.equal(map.closest('.rv-map-park'), null);
		assert.ok(frames.length > 0);
		assert.ok(frames.every((ok) => ok));
		observer.disconnect();
	});

	it('opens a cover card when the live list has no file link yet', () => {
		const dom = new JSDOM('<!doctype html><body></body>');
		const win = dom.window;
		globalThis.HTMLElement = win.HTMLElement;
		globalThis.Element = win.Element;
		globalThis.MutationObserver = win.MutationObserver;
		const doc = win.document;
		const leaf = doc.createElement('div');
		leaf.className = 'workspace-leaf';
		leaf.textContent = 'Return Visits Hub';
		leaf.getBoundingClientRect = () => ({ top: 0, bottom: 797, left: 0, right: 390, width: 390, height: 797, x: 0, y: 0, toJSON() { return {}; } });
		let under = 0;
		leaf.addEventListener('click', () => { under += 1; });
		doc.body.appendChild(leaf);
		let opened = '';
		holdLeafForHubPaint(leaf, {
			mount: (host) => {
				const actions = doc.createElement('div');
				actions.className = 'rv-locator-toolbar-actions';
				actions.appendChild(doc.createElement('button'));
				const card = doc.createElement('div');
				card.className = 'rv-locator-card';
				card.setAttribute('data-rv-path', 'People/Red Lane.md');
				card.textContent = 'Red Lane';
				host.append(actions, card);
				return () => {};
			},
			openCard: (path) => { opened = path; },
		});
		const cover = leaf.querySelector(':scope > .rv-hub-swap-cover');
		assert.ok(cover);
		assert.equal(doc.querySelectorAll('a.rv-locator-file-link').length, 0);
		const card = cover?.querySelector('.rv-locator-card');
		assert.ok(card);
		card?.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
		assert.equal(opened, 'People/Red Lane.md');
		assert.equal(under, 0);
	});
});

const CREATION_MET = '2026-09-02T16:32:00';

function metLine(text: string): string {
	return text.split('\n').find((line) => line.startsWith('Met:')) ?? '';
}

function writeLogged(dir: string, name: string, markdown: string, outcome: VisitOutcome, now: Date, companion: string): string {
	const { frontmatter, body } = splitNote(markdown);
	applyVisitFrontmatter(frontmatter, outcome, now, companion);
	return writeDisk(dir, name, frontmatter, applyVisitBody(body, outcome, now, companion));
}

function writeChanged(
	dir: string,
	name: string,
	markdown: string,
	change: (body: string, frontmatter: Record<string, unknown>) => string,
): string {
	const { frontmatter, body } = splitNote(markdown);
	const nextBody = change(body, frontmatter);
	assert.equal(frontmatter.Met, CREATION_MET);
	return writeDisk(dir, name, frontmatter, nextBody);
}

function writeDisk(dir: string, name: string, frontmatter: Record<string, unknown>, body: string): string {
	const file = join(dir, name);
	writeFileSync(file, renderNote(frontmatter, body));
	const disk = readFileSync(file, 'utf8');
	assert.equal(disk, readFileSync(file, 'utf8'));
	return disk;
}

function splitNote(text: string): { frontmatter: Record<string, unknown>; body: string } {
	const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
	if (!match) throw new Error('no frontmatter');
	return { frontmatter: parseFrontmatter(match[1] ?? ''), body: text.slice(match[0].length) };
}

function parseFrontmatter(block: string): Record<string, unknown> {
	const frontmatter: Record<string, unknown> = {};
	const lines = block.split('\n');
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		const match = /^([^:#][^:]*?):\s*(.*)$/.exec(line);
		if (!match) continue;
		const key = match[1]?.trim() ?? '';
		const raw = match[2] ?? '';
		if (raw === '') {
			const items: string[] = [];
			while (index + 1 < lines.length && /^\s+-\s+/.test(lines[index + 1] ?? '')) {
				index += 1;
				items.push((lines[index] ?? '').replace(/^\s+-\s+/, '').replace(/^"|"$/g, ''));
			}
			frontmatter[key] = items;
			continue;
		}
		if (/^-?\d+$/.test(raw)) frontmatter[key] = Number(raw);
		else frontmatter[key] = raw.replace(/^"|"$/g, '');
	}
	return frontmatter;
}

function renderNote(frontmatter: Record<string, unknown>, body: string): string {
	const lines = ['---'];
	for (const [key, value] of Object.entries(frontmatter)) {
		if (Array.isArray(value)) {
			lines.push(`${key}:`);
			for (const item of value) lines.push(`  - "${item}"`);
			continue;
		}
		if (typeof value === 'number') {
			lines.push(`${key}: ${value}`);
			continue;
		}
		lines.push(`${key}: "${value ?? ''}"`);
	}
	lines.push('---', '');
	return `${lines.join('\n')}${body.replace(/^\n/, '')}`;
}
