import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { companionChoices, publisherBands } from '../src/companions';
import { generalModalAccent, markModalTone } from '../src/modal-chrome';
import { mountAlwaysChevron } from '../src/suggest-field';
import { mountClosedTitle } from '../src/title-fit';
import { defaultUrgencyColors, urgencyInk } from '../src/urgency-palette';

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

describe('RV-231 RV-B36 priority badge', () => {
	it('clears the mobile button padding on the priority pill and keeps it a circle', () => {
		const css = source('styles.css');
		assert.match(css, /button\.rv-locator-priority-pill \{[^}]*width:\s*var\(--rv-control-size, 28px\) !important;[^}]*height:\s*var\(--rv-control-size, 28px\) !important;[^}]*padding:\s*0 !important;[^}]*border-radius:\s*999px !important;/);
	});
});

describe('RV-233 home log', () => {
	it('sends every Home write through logNoteHome', () => {
		const main = source('src/main.ts');
		const body = main.slice(main.indexOf('private async writeVisit'), main.indexOf('async logNoteMiss'));
		assert.match(body, /await this\.logNoteHome\(file\)/);
		assert.doesNotMatch(body, /promptLiterature/);
		assert.match(main, /void this\.writeVisit\(file, 'home'\)/);
	});
});

describe('RV-232 RV-238 suggester', () => {
	it('closes on the first literature pick and reopens a checklist', () => {
		assert.doesNotMatch(source('src/catalog-fields.ts'), /keepOpen:\s*true/);
		const host = window.document.createElement('div');
		const input = window.document.createElement('input');
		host.appendChild(input);
		window.document.body.appendChild(host);
		const picked: string[] = [];
		mountAlwaysChevron(input, () => ['Tract A', 'Tract B'], (value) => {
			if (picked.includes(value)) picked.splice(picked.indexOf(value), 1);
			else picked.push(value);
		}, undefined, undefined, { picked: () => picked });
		const panel = host.querySelector('.rv-suggest-panel');
		assert.ok(panel instanceof window.HTMLElement);
		host.querySelector('button.rv-suggest-chevron')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		const row = host.querySelector('.rv-suggest-option');
		assert.ok(row instanceof window.HTMLElement);
		row.dispatchEvent(new window.Event('pointerup', { bubbles: true }));
		row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.equal(panel.hidden, true);
		assert.deepEqual(picked, ['Tract A']);
		host.querySelector('button.rv-suggest-chevron')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.equal(panel.hidden, false);
		assert.equal(host.querySelector('.rv-suggest-option.is-checked')?.textContent?.includes('Tract A'), true);
		host.remove();
	});

	it('gives the publisher list a RECENT band, a check, and a normal Use row', () => {
		assert.deepEqual(publisherBands(['Ada', 'Use “Bea”']), [{ label: 'RECENT', items: ['Ada'] }]);
		assert.equal(companionChoices(['Ada'], 'Bea')[0]?.label, 'Use “Bea”');
		const host = window.document.createElement('div');
		const input = window.document.createElement('input');
		input.value = 'a';
		host.appendChild(input);
		window.document.body.appendChild(host);
		mountAlwaysChevron(
			input,
			() => companionChoices(['Ada', 'Ann'], 'a').map((item) => item.label),
			() => {},
			undefined,
			(rows) => publisherBands(rows),
			{ picked: () => ['Ada'] },
		);
		host.querySelector('button.rv-suggest-chevron')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.equal(host.querySelector('.rv-suggest-band')?.textContent, 'RECENT');
		assert.equal(host.querySelector('.is-checked')?.textContent?.includes('Ada'), true);
		const use = [...host.querySelectorAll('.rv-suggest-option')].find((row) => row.textContent?.includes('Use'));
		assert.ok(use instanceof window.HTMLElement);
		assert.equal(use.classList.contains('rv-suggest-hint'), false);
		assert.equal(use.closest('.rv-suggest-band'), null);
		host.remove();
	});
});

describe('RV-239 RV-240 RV-242 RV-243', () => {
	it('centers the return row, shrinks the street first, and drops the blur and the 8px overlay inset', () => {
		const css = source('styles.css');
		assert.match(css, /\.rv-locator-return-inline \{[^}]*align-items:\s*center;/);
		assert.match(css, /\.rv-locator-card-street \{[^}]*flex:\s*0 1 auto;/);
		assert.match(css, /\.rv-locator-city-lg \{[^}]*flex:\s*0 0 auto;/);
		assert.match(css, /\.rv-map-bar button \{[^}]*backdrop-filter:\s*none;/);
		assert.match(css, /body\.is-mobile\.is-floating-nav \.modal\.rv-locator-modal \.modal-title/);
		assert.doesNotMatch(css, /\.rv-closed-title \{[^}]*padding-inline:\s*8px/);
		assert.match(css, /\.modal\.rv-modal-general button\.mod-cta[\s\S]*?background-color:\s*var\(--rv-modal-accent\) !important;/);
	});

	it('copies the input font and text inset onto the closed title', () => {
		const host = window.document.createElement('div');
		host.className = 'rv-suggest-host';
		const input = window.document.createElement('input');
		input.value = 'Will Suffering Ever End?';
		input.style.fontSize = '14.992px';
		input.style.paddingLeft = '12px';
		input.style.paddingRight = '12px';
		host.appendChild(input);
		window.document.body.appendChild(host);
		mountClosedTitle(input, () => ({ text: 'Will Suffering Ever End?', suffix: 'Tract', count: '+1' }));
		const overlay = host.querySelector('.rv-closed-title');
		assert.ok(overlay instanceof window.HTMLElement);
		const style = window.getComputedStyle(input);
		assert.equal(overlay.style.fontSize, style.fontSize);
		const left = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.borderLeftWidth) || 0);
		assert.equal(overlay.style.paddingLeft, `${left}px`);
		assert.equal(overlay.querySelector('.rv-type')?.textContent, ' Tract');
		host.remove();
	});
});

describe('RV-B44 general modal band', () => {
	it('uses band 0 of the selected palette, including a custom palette', () => {
		const fallback = defaultUrgencyColors();
		assert.equal(generalModalAccent({ urgencyPalette: 'default', urgencyCustomColors: fallback }), '#1f8a4c');
		assert.equal(generalModalAccent({ urgencyPalette: 'cotton-candy', urgencyCustomColors: fallback }), '#14ac87');
		assert.equal(generalModalAccent({
			urgencyPalette: 'custom',
			urgencyCustomColors: ['#14ac87', '#528fd3', '#9e62d1', '#cc2c77'],
		}), '#14ac87');
		const chrome = source('src/modal-chrome.ts');
		assert.match(chrome, /urgencyColorsFor\(settings\.urgencyPalette, settings\.urgencyCustomColors\)/);
		const tone = chrome.slice(chrome.indexOf('export function markModalTone'));
		assert.match(tone, /--rv-modal-ink', urgencyInk\(color\)/);
		assert.doesNotMatch(tone, /--rv-modal-accent', '#1f8a4c'/);
		const css = source('styles.css');
		const general = css.slice(css.indexOf('.modal.rv-modal-general,'), css.indexOf('.modal.rv-modal-rv,'));
		assert.match(general, /--interactive-accent:\s*var\(--rv-modal-accent\)/);
		assert.match(general, /--text-accent:\s*var\(--rv-modal-accent\)/);
		assert.equal(general.includes('--rv-modal-accent: #1f8a4c'), false);
		for (const file of ['src/modals.ts', 'src/main.ts', 'src/settings-tab.ts']) {
			assert.match(source(file), /generalModalAccent\(/);
		}
		assert.match(source('src/new-rv-modal.ts'), /markModalTone\(this\.modalEl, 'general', this\.options\.priorityAccent/);
		assert.match(source('src/setup-wizard.ts'), /urgencyColorsFor\(this\.colorsDraft\.palette, this\.colorsDraft\.custom\)/);
	});

	it('paints a general modal with that color and readable ink', () => {
		const modal = window.document.createElement('div');
		const node = modal as HTMLElement & { addClass?: (name: string) => void };
		node.addClass = (name) => modal.classList.add(name);
		markModalTone(node, 'general', '#14ac87');
		assert.equal(modal.style.getPropertyValue('--rv-modal-accent'), '#14ac87');
		assert.equal(modal.style.getPropertyValue('--rv-menu-ink'), '#14ac87');
		assert.equal(modal.style.getPropertyValue('--rv-modal-ink'), urgencyInk('#14ac87'));
		markModalTone(node, 'general', '#ffffff');
		assert.equal(modal.style.getPropertyValue('--rv-modal-ink'), '#111111');
	});
});
