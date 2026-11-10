import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { APP_TABS, appBarSlotPx, appendAppSlot, dismissOpenMenus, keepMenuOnScreen } from '../src/app-bar';
import { appendBadge, clearBadgeStrokeCache, pinBadgeRings } from '../src/glancable-view';
import { applyNoteMapFrame, hubUsesStackedMap, mapBandPx, mapPanePx, revealHubCard, STACKED_HANDLE_PX, writeMapBand } from '../src/hub-layout';
import { mountNoteHubBar, openNoteFind, revealNoteMatch } from '../src/note-hub-bar';
import { buildCountySuggestUrl, countyGeocodeText } from '../src/address';
import { claimParkedMap, lockHandedMapBand, parkMapNode, seatMapGrip } from '../src/map-handoff';
import { alignHubCover } from '../src/hub-cover';
import { editVisit, listVisits, visitWhenFrom } from '../src/visit-editor';
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
		assert.equal(url.searchParams.get('type'), 'county');
		assert.equal(url.searchParams.get('text'), 'Citrus County, Florida');
		assert.doesNotMatch(url.pathname, /autocomplete/);
		const main = source('src/main.ts');
		assert.match(main, /planned\.hits\.length === 0\) return \{ hits: \[\], allowBroad: true/);
		assert.match(main, /return await this\.homeProximity\(\)/);
		assert.doesNotMatch(main, /suggestBias\(\): Promise<GeocodeBias \| null> \{\s*return this\.currentMapFix\(\)/);
		assert.match(source('src/address-suggest.ts'), /hits\.length === 0\) \{\s*this\.cache\.delete\(key\)/);
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

	it('leaves the body Last Attempted line to the template', () => {
		const template = source('extras/templater-metabind/New RV.md');
		assert.match(template, /\*\*Last Attempted\*\*/);
		assert.match(template, /INPUT\[dateTime:\["Last Attempted"\]\]/);
		const src = ['src/visit-log.ts', 'src/visit-editor.ts', 'src/main.ts', 'src/note-chrome.ts'].map((file) => source(file)).join('\n');
		assert.doesNotMatch(src, /\*\*Last Attempted\*\*/);
	});
});
