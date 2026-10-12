import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { buildMapPins } from '../src/map-pins';
import { SNOOZE_SLATE, snoozeCardCaption } from '../src/snooze';
import { mountStudyPanel } from '../src/study-panel';
import { DEFAULT_SETTINGS } from '../src/types';
import { mountRawVisitNotes, rawVisitNoteKey } from '../src/visit-notes-field';

function source(name: string): string {
	return readFileSync(path.join(process.cwd(), name), 'utf8');
}

const css = source('styles.css');

describe('2026-10-12 dogfood round 2', () => {
	it('keeps the snooze caption tiny and does not invent a hospital stay', () => {
		assert.equal(snoozeCardCaption(''), 'snoozed');
		assert.equal(snoozeCardCaption('   '), 'snoozed');
		assert.equal(snoozeCardCaption('out of town'), 'out of town');
		const modal = source('src/score-modals.ts');
		assert.match(modal, /setPlaceholder\('optional'\)/);
		assert.doesNotMatch(modal, /Hospital stay/);
	});

	it('paints a snoozed pin slate with a moon, not a dashed ghost', () => {
		const [pin] = buildMapPins([{
			path: 'a.md',
			name: 'A',
			lat: 28.5,
			lon: -81.3,
			priority: 1,
			days: 40,
			inactive: false,
			snoozed: true,
			card: {
				address: '',
				city: '',
				study: false,
				spoke: '',
				attempted: '',
				studied: '',
				met: '',
				metWith: '',
				visits: '1/2',
				studyRatio: '',
				literature: '',
				media: '',
				lessons: [],
			},
		}], DEFAULT_SETTINGS.idealityFloorDays, DEFAULT_SETTINGS.urgencyThresholdDays, ['#1f8a4c', '#d6a100', '#e06a00', '#d63c3c'], 'urgency');
		assert.ok(pin);
		assert.equal(pin.snoozed, true);
		assert.equal(pin.stateIcon, 'moon');
		assert.equal(pin.color, SNOOZE_SLATE);
		const map = source('src/map-view.ts');
		assert.match(map, /stateIcon === 'moon'/);
		assert.match(map, /is-snoozed/);
		const glance = source('src/glancable-view.ts');
		assert.match(glance, /rv-pin-head/);
		assert.match(glance, /snoozeCardCaption/);
		assert.doesNotMatch(glance, /ghost === 'moon'[\s\S]{0,80}is-ghost/);
	});

	it('fills sort pills, hides the overlapping backlink, and keeps note-map pins on the map', () => {
		assert.match(css, /\.rv-locator-glancable \.rv-locator-sort-pills \{[^}]*flex-wrap:\s*nowrap/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-sort-pills \{[^}]*width:\s*100%/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-sort-pills \.rv-locator-sort-preset \{[^}]*flex:\s*1 1 0/);
		assert.doesNotMatch(css, /\.rv-locator-sort-pills \{[^}]*width:\s*max-content/);
		assert.match(css, /body\.rv-hide-backlinks \.status-bar \{\s*display:\s*none/);
		assert.match(css, /\.theme-dark \.rv-map-tile-back/);
		assert.match(css, /\.workspace-leaf-content\.is-note-map > \.rv-note-map \.rv-map-pins \{[^}]*position:\s*absolute/);
		assert.match(css, /--rv-note-map/);
		assert.match(css, /\.rv-hub-map-handle::before \{[^}]*height:\s*40px/);
		assert.doesNotMatch(css, /bottom:\s*var\(--rv-map-size/);
	});

	it('colors icons only and leaves hub, address, and item text neutral', () => {
		const chrome = source('src/note-chrome.ts');
		const paint = chrome.slice(chrome.indexOf('function paintUrgencyDetails'), chrome.indexOf('function markUrgencyReady'));
		assert.match(paint, /\.rv-item-icon/);
		assert.match(paint, /\.rv-label-icon/);
		assert.doesNotMatch(paint, /\.rv-label-text/);
		assert.doesNotMatch(paint, /\.rv-hub-chip/);
		assert.doesNotMatch(paint, /\.rv-address-link/);
		assert.doesNotMatch(paint, /\.mb-button-inner/);
		assert.match(css, /\.rv-dashboard \.rv-label-icon \{\s*color: var\(--rv-urgency-accent/);
		assert.match(css, /\.rv-dashboard \.rv-fit-stem \{\s*color: var\(--text-normal\) !important/);
		assert.match(css, /a\.rv-map-button::after/);
		assert.match(css, /\.rv-address-field \{[^}]*border:\s*1px solid/);
		assert.match(css, /\.rv-dashboard \.rv-visit-note-box \{[^}]*border-radius:\s*4px/);
		assert.match(css, /button\.rv-study-change[\s\S]*font-size:\s*calc\(12px \* 0\.72\)/);
	});

	it('keeps the partway start fixed and shows where the study began', () => {
		const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
		const { window } = dom;
		const proto = window.HTMLElement.prototype as HTMLElement & {
			createEl(tag: string, spec?: { cls?: string; text?: string; attr?: Record<string, string> }): HTMLElement;
			createDiv(spec?: string | { cls?: string; text?: string }): HTMLElement;
			createSpan(spec?: string | { cls?: string; text?: string }): HTMLElement;
			empty(): void;
		};
		proto.createEl = function createEl(this: HTMLElement, tag, spec) {
			const el = this.ownerDocument.createElement(tag);
			if (spec?.cls) el.className = spec.cls;
			if (spec?.text) el.textContent = spec.text;
			if (spec?.attr) {
				for (const [key, value] of Object.entries(spec.attr)) el.setAttribute(key, value);
			}
			this.appendChild(el);
			return el;
		};
		proto.createDiv = function createDiv(this: HTMLElement, spec) {
			return this.createEl('div', typeof spec === 'string' ? { cls: spec } : spec);
		};
		proto.createSpan = function createSpan(this: HTMLElement, spec) {
			return this.createEl('span', typeof spec === 'string' ? { cls: spec } : spec);
		};
		proto.empty = function empty(this: HTMLElement) {
			this.replaceChildren();
		};
		const parent = window.document.createElement('div');
		window.document.body.appendChild(parent);
		const share = {
			publications: '',
			media: '',
			lesson: '01 How Can the Bible Help You?',
			lessonFrom: 'Outro',
			lessonTo: '1',
			extraLesson: '',
			extraFrom: '',
			extraTo: '',
		};
		mountStudyPanel(parent, { customLessons: [], lessons: [] }, share, () => {});
		const label = parent.querySelector('.rv-study-label');
		const began = parent.querySelector('.rv-study-began');
		const before = label?.textContent ?? '';
		assert.match(before, /Outro/);
		assert.match(began?.textContent ?? '', /Started at/);
		assert.match(began?.textContent ?? '', /Outro/);
		assert.ok(parent.querySelector('.rv-study-ticks'));
		assert.ok((parent.querySelectorAll('.rv-study-tick').length) > 2);
		const slider = parent.querySelector('input.rv-study-slider');
		assert.ok(slider instanceof window.HTMLInputElement);
		slider.value = slider.max || '4';
		slider.dispatchEvent(new window.Event('input'));
		assert.equal(parent.querySelector('.rv-study-label')?.textContent, before);
		assert.match(parent.querySelector('.rv-study-began')?.textContent ?? '', /Outro/);
		assert.doesNotMatch(parent.querySelector('.rv-study-label')?.textContent ?? '', new RegExp(`\\b${slider.value}\\b`));
	});

	it('mounts a native notes box only when Meta Bind left the raw field', () => {
		const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
		const { window } = dom;
		const host = globalThis as typeof globalThis & { HTMLElement: typeof window.HTMLElement };
		host.HTMLElement = window.HTMLElement;
		const root = window.document.createElement('div');
		const raw = window.document.createElement('p');
		raw.textContent = "'INPUT[textArea:sVisit5Notes]'";
		const live = window.document.createElement('p');
		live.textContent = 'INPUT[textArea:sVisit4Notes]';
		const area = window.document.createElement('textarea');
		live.appendChild(area);
		root.append(raw, live);
		window.document.body.appendChild(root);
		const writes: Array<[string, string]> = [];
		mountRawVisitNotes(root, (key) => (key === 'sVisit5Notes' ? 'kept' : ''), (key, value) => {
			writes.push([key, value]);
		});
		const mounted = raw.querySelector('textarea');
		assert.ok(mounted instanceof window.HTMLTextAreaElement);
		assert.equal(mounted.value, 'kept');
		assert.equal(live.querySelectorAll('textarea').length, 1);
		assert.equal(live.querySelector('textarea'), area);
		mounted.value = 'after the hub';
		mounted.dispatchEvent(new window.Event('input', { bubbles: true }));
		return new Promise<void>((resolve) => {
			window.setTimeout(() => {
				assert.deepEqual(writes, [['sVisit5Notes', 'after the hub']]);
				assert.equal(rawVisitNoteKey('`INPUT[textArea:sVisit2Notes]`'), 'sVisit2Notes');
				assert.equal(rawVisitNoteKey('notes'), null);
				resolve();
			}, 450);
		});
	});
});
