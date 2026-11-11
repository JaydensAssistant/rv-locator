import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { closedPickParts } from '../src/catalog-fields';
import { homeCountyHits, placeFilterParam } from '../src/home-base';
import { earthIsOn } from '../src/map-pins';
import { mountAlwaysChevron } from '../src/suggest-field';
import { mountClosedTitle } from '../src/title-fit';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const { window } = dom;
const hostGlobals = globalThis as typeof globalThis & Record<string, unknown>;
hostGlobals.window = window;
hostGlobals.document = window.document;
hostGlobals.HTMLElement = window.HTMLElement;
hostGlobals.MouseEvent = window.MouseEvent;
hostGlobals.HTMLInputElement = window.HTMLInputElement;

function source(path: string): string {
	return readFileSync(path, 'utf8');
}

describe('RV-237 home county place filter', () => {
	it('keeps vault addresses first and marks only a home county as near', () => {
		assert.equal(placeFilterParam([' place:citrus ', 'marion', 'marion']), 'place:citrus|place:marion');
		const planned = homeCountyHits(
			[
				{ formattedAddress: '9 Other Rd', lat: 1, lon: 1, county: 'Lake' },
				{ formattedAddress: '10 Vault Rd', lat: 2, lon: 2 },
			],
			[
				{ formattedAddress: '20 Home St', lat: 3, lon: 3, county: 'Marion County' },
				{ formattedAddress: '30 Away St', lat: 4, lon: 4, county: 'Orange' },
			],
			['Citrus', 'Marion'],
		);
		assert.deepEqual(planned.hits.map((hit) => hit.formattedAddress), ['9 Other Rd', '10 Vault Rd', '20 Home St']);
		assert.deepEqual(planned.near, ['10 vault rd', '20 home st']);
		const main = source('src/main.ts');
		const home = main.slice(main.indexOf('async suggestAddressHome'), main.indexOf('private vaultAddressHits'));
		assert.match(home, /placeFilterParam\(ids\)/);
		assert.match(home, /homeCountyHits\(vault, remote, counties\)/);
		assert.match(home, /near: planned\.near/);
		assert.equal(home.includes('countyFilter'), false);
		assert.equal(home.includes('filter=county'), false);
		assert.match(source('src/address-suggest.ts'), /result\.near \?\? hits/);
	});
});

describe('RV-B43 earth state', () => {
	it('shades each earth from its own flag and closes a lit earth', () => {
		const note = { hubMapOpen: false, noteMapOpen: true, focusPath: 'People/A.md' };
		assert.equal(earthIsOn('note', note, 'People/A.md'), true);
		assert.equal(earthIsOn('note', note, 'People/B.md'), false);
		assert.equal(earthIsOn('hub', note), false);
		assert.equal(earthIsOn('card', note, 'People/A.md'), false);
		const hub = { hubMapOpen: true, noteMapOpen: false, focusPath: 'People/A.md' };
		assert.equal(earthIsOn('hub', hub), true);
		assert.equal(earthIsOn('card', hub, 'People/A.md'), true);
		assert.equal(earthIsOn('card', hub, 'People/B.md'), false);
		assert.equal(earthIsOn('note', hub, 'People/A.md'), false);
		const main = source('src/main.ts');
		const keep = main.slice(main.indexOf('keepMapWithNote(path: string)'), main.indexOf('toggleCardEarth'));
		assert.match(keep, /this\.hubMapOpen = false/);
		assert.match(keep, /this\.noteMapOpen = true/);
		assert.match(keep, /this\.mapFocusPath = path/);
		assert.match(keep, /this\.focusMapPin\(path, true\)/);
		assert.match(keep, /this\.paintEarthStates\(\)/);
		const card = main.slice(main.indexOf('toggleCardEarth(path: string)'), main.indexOf('async openMapSoon'));
		assert.match(card, /earthIsOn\('card'/);
		assert.match(card, /this\.hubMapOpen = false/);
		const openMap = main.slice(main.indexOf('async openMapSoon'), main.indexOf('private noteMapHandle'));
		assert.equal(openMap.includes('this.hubMapOpen = true'), false);
		assert.match(openMap, /this\.noteMapOpen = true/);
		assert.match(openMap, /this\.noteMapOpen = false/);
		assert.match(openMap, /paintEarthStates\(\)/);
		assert.match(source('src/nearby-view.ts'), /this\.plugin\.keepMapWithNote\(path\)/);
		assert.match(source('src/glancable-view.ts'), /toggleCardEarth\(row\.path\)/);
		assert.match(source('src/main.ts'), /earthIsOn\('note', this\.earthFlags\(\), notePath\)/);
		assert.match(source('src/bar-shell.ts'), /rv-note-bar-earth/);
		assert.match(source('src/note-chrome.ts'), /Address copied/);
		const css = source('styles.css');
		assert.equal(css.includes('body.rv-map-open .rv-dashboard a.rv-map-button'), false);
	});
});

describe('RV-229 and RV-B42 modal chrome', () => {
	it('paints general sliders from the modal accent and beats the phone title and blur', () => {
		const css = source('styles.css');
		assert.match(css, /body\.is-phone \.modal\.rv-locator-modal \.modal-title,\s*body\.is-phone \.prompt\.rv-locator-modal \.modal-title[\s\S]*?max-width:\s*none !important;/);
		assert.match(css, /body\.is-mobile\.is-floating-nav \.modal\.rv-locator-modal \.modal-header-button\.mod-raised[\s\S]*?backdrop-filter:\s*none !important;\s*-webkit-backdrop-filter:\s*none !important;/);
		assert.match(css, /\.modal-header-button:focus-visible,[\s\S]*?outline:\s*none !important;/);
		assert.match(css, /input\[type="range"\]:not\(\.rv-study-slider\) \{[^}]*background-image: linear-gradient\(to right, var\(--rv-modal-accent\)/);
		assert.match(css, /input\.rv-study-slider\[type="range"\]::-webkit-slider-thumb \{[^}]*background:\s*var\(--rv-menu-ink\)/);
		assert.match(css, /input\.rv-study-slider\[type="range"\]::-webkit-slider-runnable-track \{[^}]*background:\s*var\(--background-modifier-border\)/);
		assert.match(css, /\.checkbox-container\.is-enabled\s*\{[^}]*background-color:\s*var\(--rv-modal-accent\) !important;/);
		assert.match(css, /\.rv-visit-tab \{[^}]*flex:\s*1 1 0;/);
		assert.match(css, /\.modal-close-button \{[^}]*background:\s*transparent !important;/);
	});
});

describe('RV-B37 Day row', () => {
	it('gives the date and the three selects one 44px height and room for two digits', () => {
		const css = source('styles.css');
		assert.match(css, /\.rv-when-row \.setting-item-control > input\[type="date"\] \{[^}]*height:\s*44px !important;[^}]*min-height:\s*44px !important;/);
		assert.match(css, /\.rv-when-row \.setting-item-control > select:not\(\.is-measuring\) \{[^}]*flex:\s*1 1 2\.75rem !important;[^}]*height:\s*44px !important;[^}]*padding-left:\s*0\.2rem !important;[^}]*padding-right:\s*0\.85rem !important;/);
		assert.match(css, /select\[aria-label="AM or PM"\]:not\(\.is-measuring\) \{[^}]*height:\s*44px !important;/);
		assert.match(source('src/visit-modals.ts'), /setAttribute\('aria-label', 'Minute'\)/);
	});
});

describe('RV-B39 empty suggester', () => {
	it('draws no panel when the publisher list is empty and the field is empty', () => {
		const host = window.document.createElement('div');
		const input = window.document.createElement('input');
		host.appendChild(input);
		window.document.body.appendChild(host);
		mountAlwaysChevron(input, () => [], () => {});
		const panel = host.querySelector('.rv-suggest-panel');
		assert.ok(panel instanceof window.HTMLElement);
		host.querySelector('button.rv-suggest-chevron')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.equal(panel.hidden, true);
		assert.equal(panel.childElementCount, 0);
		input.value = 'Sister';
		input.dispatchEvent(new window.Event('input', { bubbles: true }));
		assert.equal(panel.hidden, true);
		host.remove();
	});
});

describe('RV-246 closed catalog field', () => {
	it('keeps the type and paints the extra count in the urgency accent', () => {
		const parts = closedPickParts([
			'Will Suffering Ever End? Tract',
			'Enjoy Life Forever!—Introductory Bible Lessons Brochure',
		], 'literature');
		assert.equal(parts.text, 'Will Suffering Ever End?');
		assert.equal(parts.suffix, 'Tract');
		assert.equal(parts.count, '+1');
		assert.equal(closedPickParts(['Enjoy Life Forever!—An Interactive Bible Course Book'], 'literature').count, '');
		const host = window.document.createElement('div');
		const input = window.document.createElement('input');
		input.value = 'Will Suffering Ever End? +1';
		host.appendChild(input);
		window.document.body.appendChild(host);
		mountClosedTitle(input, () => parts);
		const overlay = host.querySelector('.rv-closed-title');
		assert.equal(overlay?.querySelector('.rv-title-text')?.textContent, 'Will Suffering Ever End?');
		assert.equal(overlay?.querySelector('.rv-type')?.textContent, ' Tract');
		assert.equal(overlay?.querySelector('.rv-count-pill')?.textContent, '+1');
		assert.equal(overlay?.textContent?.includes('Will Suffering Ever End? +1'), false);
		const css = source('styles.css');
		assert.match(css, /\.rv-closed-title \.rv-type,[\s\S]*?flex:\s*0 0 auto;[\s\S]*?overflow:\s*visible;/);
		assert.match(css, /\.rv-closed-title \.rv-count-pill \{[^}]*color:\s*var\(--rv-modal-accent\);/);
		host.remove();
	});
});
