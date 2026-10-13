import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { buildMapPins, groupPinStacks, pinUrgencyZ } from '../src/map-pins';
import { SNOOZE_SLATE, snoozeCardCaption } from '../src/snooze';
import { mountStudyPanel } from '../src/study-panel';
import { DEFAULT_SETTINGS } from '../src/types';
import type { App } from 'obsidian';
import { clearVisitNoteCaches, mountVisitNotesInSection, rawVisitNoteKey } from '../src/visit-notes-field';
import { bindVisitNoteFlush } from '../src/visit-notes-store';
import { applyLiveUrgency, type NoteChromeHost } from '../src/note-chrome';
import { visitLayoutMissing } from '../src/visit-controls';

function source(name: string): string {
	return readFileSync(path.join(process.cwd(), name), 'utf8');
}

function notesApp(byPath: Record<string, Record<string, string>>): App {
	return {
		vault: {
			getFileByPath(filePath: string) {
				return Object.prototype.hasOwnProperty.call(byPath, filePath) ? { path: filePath } : null;
			},
		},
		metadataCache: {
			getFileCache(file: { path: string }) {
				const frontmatter = byPath[file.path];
				return frontmatter ? { frontmatter } : null;
			},
		},
	} as unknown as App;
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
		assert.match(css, /\.rv-locator-sortbar:has\(> \.rv-sort-close\) > \.rv-locator-sort-scroll \{[^}]*overflow-x:\s*auto !important/);
		assert.match(css, /\.rv-sort-close \{[^}]*flex:\s*0 0 40px !important/);
		assert.match(css, /\.rv-locator-sortbar:has\(> \.rv-sort-close\) \.rv-locator-sort-preset \{[^}]*height:\s*40px !important/);
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
		const tickNodes = [...parent.querySelectorAll('.rv-study-tick')];
		assert.ok(tickNodes.length > 2);
		assert.equal((tickNodes[0] as HTMLElement).style.getPropertyValue('--stop'), '0');
		assert.equal((tickNodes[tickNodes.length - 1] as HTMLElement).style.getPropertyValue('--stop'), '1');
		const slider = parent.querySelector('input.rv-study-slider');
		assert.ok(slider instanceof window.HTMLInputElement);
		slider.value = slider.max || '4';
		slider.dispatchEvent(new window.Event('input'));
		assert.equal(parent.querySelector('.rv-study-label')?.textContent, before);
		assert.match(parent.querySelector('.rv-study-began')?.textContent ?? '', /Outro/);
		assert.doesNotMatch(parent.querySelector('.rv-study-label')?.textContent ?? '', new RegExp(`\\b${slider.value}\\b`));
		const finished = window.document.createElement('div');
		window.document.body.appendChild(finished);
		mountStudyPanel(finished, { customLessons: [], lessons: [] }, {
			publications: '',
			media: '',
			lesson: '01 How Can the Bible Help You?',
			lessonFrom: 'Intro',
			lessonTo: 'Outro',
			extraLesson: '',
			extraFrom: '',
			extraTo: '',
		}, () => {});
		const partway = finished.querySelector('button[aria-label="Partway"]');
		assert.ok(partway instanceof window.HTMLElement);
		partway.click();
		const nextSlider = finished.querySelector('input.rv-study-slider');
		assert.ok(nextSlider instanceof window.HTMLInputElement);
		assert.equal(nextSlider.value, '1');
		assert.notEqual(nextSlider.value, nextSlider.max);
		const skip = parent.querySelector('.rv-study-skip');
		assert.equal(skip?.textContent, "Didn't study");
		assert.ok(skip instanceof window.HTMLElement);
		skip.click();
		assert.equal(parent.querySelector('.rv-study-skip')?.textContent, 'Did study');
		const back = parent.querySelector('.rv-study-skip');
		assert.ok(back instanceof window.HTMLElement);
		back.click();
		assert.equal(parent.querySelector('.rv-study-skip')?.textContent, "Didn't study");
	});

	it('mounts a native notes box only when Meta Bind left the raw field', () => {
		const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
		const { window } = dom;
		const host = globalThis as typeof globalThis & {
			HTMLElement: typeof window.HTMLElement;
			Node: typeof window.Node;
			HTMLTextAreaElement: typeof window.HTMLTextAreaElement;
		};
		host.HTMLElement = window.HTMLElement;
		host.Node = window.Node;
		host.HTMLTextAreaElement = window.HTMLTextAreaElement;
		clearVisitNoteCaches();
		const writes: Array<[string, string]> = [];
		bindVisitNoteFlush((_path, batch) => {
			for (const [key, value] of Object.entries(batch)) writes.push([key, value]);
		});
		const root = window.document.createElement('div');
		const raw = window.document.createElement('p');
		raw.textContent = "'INPUT[textArea:sVisit5Notes]'";
		const live = window.document.createElement('p');
		live.textContent = 'INPUT[textArea:sVisit4Notes]';
		const area = window.document.createElement('textarea');
		live.appendChild(area);
		root.append(raw, live);
		window.document.body.appendChild(root);
		mountVisitNotesInSection(root, {
			sourcePath: 'Dale.md',
			addChild(child) { child.load(); },
		}, notesApp({ 'Dale.md': { sVisit5Notes: 'kept' } }));
		const mounted = raw.querySelector('textarea');
		assert.ok(mounted instanceof window.HTMLTextAreaElement);
		assert.equal(mounted.value, 'kept');
		assert.equal(raw.classList.contains('mb-none'), true);
		assert.equal(live.querySelectorAll('textarea').length, 1);
		assert.equal(live.querySelector('textarea'), area);
		mounted.value = 'after the hub';
		mounted.dispatchEvent(new window.Event('input', { bubbles: true }));
		return new Promise<void>((resolve) => {
			window.setTimeout(() => {
				assert.deepEqual(writes, [['sVisit5Notes', 'after the hub']]);
				assert.equal(rawVisitNoteKey('`INPUT[textArea:sVisit2Notes]`'), 'sVisit2Notes');
				assert.equal(rawVisitNoteKey('notes'), null);
				clearVisitNoteCaches();
				resolve();
			}, 450);
		});
	});

	it('keeps one debounced writer and shows the stored value on a new section', () => {
		const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
		const { window } = dom;
		const host = globalThis as typeof globalThis & {
			HTMLElement: typeof window.HTMLElement;
			Element: typeof window.Element;
			Node: typeof window.Node;
			HTMLTextAreaElement: typeof window.HTMLTextAreaElement;
		};
		host.HTMLElement = window.HTMLElement;
		host.Element = window.Element;
		host.Node = window.Node;
		host.HTMLTextAreaElement = window.HTMLTextAreaElement;
		clearVisitNoteCaches();
		const writes: string[] = [];
		bindVisitNoteFlush((_path, batch) => {
			writes.push(...Object.entries(batch).map(([key, value]) => `${key}=${value}`));
		});
		const root = window.document.createElement('div');
		const raw = window.document.createElement('p');
		raw.textContent = 'INPUT[textArea:sVisit5Notes]';
		root.appendChild(raw);
		window.document.body.appendChild(root);
		const ctx = {
			sourcePath: 'Dale.md',
			addChild(child: { load: () => void }) { child.load(); },
		};
		const app = notesApp({ 'Dale.md': { sVisit5Notes: 'Third' } });
		mountVisitNotesInSection(root, ctx, app);
		const mounted = raw.querySelector('textarea.rv-native-notes-area');
		assert.ok(mounted instanceof window.HTMLTextAreaElement);
		assert.equal(root.querySelectorAll('textarea.rv-native-notes-area').length, 1);
		assert.equal(raw.classList.contains('mb-none'), true);
		const typed = 'Third box.\n';
		for (let index = 0; index < typed.length; index += 1) {
			mounted.value = typed.slice(0, index + 1);
			mounted.setSelectionRange(mounted.value.length, mounted.value.length);
			mounted.dispatchEvent(new window.Event('input', { bubbles: true }));
		}
		mountVisitNotesInSection(root, ctx, app);
		assert.equal(raw.querySelector('textarea.rv-native-notes-area'), mounted);
		assert.equal(mounted.selectionStart, typed.length);
		const again = window.document.createElement('div');
		const paragraph = window.document.createElement('p');
		paragraph.textContent = 'INPUT[textArea:sVisit5Notes]';
		again.appendChild(paragraph);
		window.document.body.appendChild(again);
		mountVisitNotesInSection(again, ctx, app);
		const restored = again.querySelector('textarea.rv-native-notes-area');
		assert.ok(restored instanceof window.HTMLTextAreaElement);
		assert.notEqual(restored, mounted);
		assert.equal(restored.value, typed);
		return new Promise<void>((resolve) => {
			window.setTimeout(() => {
				assert.deepEqual(writes, [`sVisit5Notes=${typed}`]);
				clearVisitNoteCaches();
				resolve();
			}, 450);
		});
	});

	it('puts a snoozed pin under a red cluster', () => {
		assert.ok(pinUrgencyZ(1, false, true) < pinUrgencyZ(0.2, false));
		assert.equal(pinUrgencyZ(1, true, true), 0);
		const [group] = groupPinStacks([
			{ path: 'snooze', x: 0, y: 0, urgency: 9, priority: 9, snoozed: true },
			{ path: 'red', x: 2, y: 0, urgency: 1, priority: 1 },
		]);
		assert.equal(group?.[0]?.path, 'red');
		const map = source('src/map-view.ts');
		assert.match(map, /pinUrgencyZ\(pin\.urgency, selected, snoozed\)/);
	});

	it('joins the empty note header, centers the hub, and fits the narrow controls', () => {
		assert.match(css, /body\.rv-hide-note-status \.status-bar \{\s*display:\s*none/);
		assert.match(css, /\.cm-line\.rv-mb-hidden \{[^}]*display:\s*none/);
		assert.match(css, /\.rv-dashboard p\.rv-hub-owned \.rv-hub-chip \{[^}]*justify-content:\s*flex-start/);
		assert.doesNotMatch(css, /\.rv-item-strip\.is-ghost \{[^}]*display:\s*none/);
		assert.match(css, /\.rv-item-strip\.is-ghost \{[^}]*display:\s*flex !important/);
		assert.match(css, /\.rv-study-tick::before \{[^}]*height:\s*6px/);
		assert.match(css, /var\(--rv-thumb, 16px\) \/ 2/);
		assert.match(css, /button\.rv-study-change,\s*button\.rv-study-skip[\s\S]*min-height:\s*32px/);
		assert.match(css, /\.rv-study-modes button \{[^}]*min-width:\s*0 !important/);
		assert.match(css, /\.rv-study-tick:first-child:not\(:last-child\) \{[^}]*text-align:\s*left/);
		assert.match(css, /\.rv-study-tick:last-child:not\(:first-child\) \{[^}]*text-align:\s*right/);
		assert.match(css, /\.rv-study-modes button \{[^}]*min-width:\s*min-content !important/);
		assert.match(css, /\.rv-study-mode-text \{[^}]*text-overflow:\s*clip/);
		assert.match(css, /\.rv-modal-section > \.rv-campaign-choice \{[^}]*border-top:\s*0/);
		assert.match(css, /\.setting-item\.rv-gender-choice \{[^}]*flex-direction:\s*row !important/);
		assert.match(source('src/main.ts'), /rv-hide-note-status/);
		assert.match(source('src/main.ts'), /this\.noteMapOpen && this\.mapFocusPath === path/);
		assert.match(source('src/main.ts'), /noteMapOpen = true/);
		assert.match(source('src/visit-modals.ts'), /this\.campaignHost = null/);
		assert.match(source('src/suggest-field.ts'), /if \(!gestured\) return/);
		assert.match(source('src/visit-notes-store.ts'), /bindVisitNoteFlush/);
		assert.doesNotMatch(source('src/visit-live-preview.ts'), /noteWritePending/);
		assert.doesNotMatch(source('src/visit-live-preview.ts'), /class VisitNoteWidget[\s\S]*?ignoreEvent/);
	});

	it('rebuilds a wiped reading-view layout and paints a snoozed dashboard slate', () => {
		const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
		const { window } = dom;
		(globalThis as typeof globalThis & { HTMLElement: typeof window.HTMLElement }).HTMLElement = window.HTMLElement;
		const bare = window.document.createElement('div');
		const heading = window.document.createElement('h5');
		heading.textContent = 'Sun, 9:05am — Oct 11, 2026';
		bare.appendChild(heading);
		assert.equal(visitLayoutMissing(bare), true);
		heading.classList.add('rv-visit-stamp');
		const box = window.document.createElement('div');
		box.className = 'rv-visit-note-box';
		heading.insertAdjacentElement('afterend', box);
		bare.dataset.rvNoteFile = 'RVs/Ada.md';
		heading.dataset.rvNoteFile = 'RVs/Ada.md';
		assert.equal(visitLayoutMissing(bare), true);
		const row = window.document.createElement('span');
		row.className = 'rv-stamp-row';
		heading.appendChild(row);
		assert.equal(visitLayoutMissing(bare), false);
		const dashboard = window.document.createElement('div');
		dashboard.className = 'rv-dashboard';
		const host = {
			frontmatter: () => ({ Status: 'Active', Priority: 1, 'Last Spoke': '2026-10-11' }),
			settings: { ...DEFAULT_SETTINGS },
			snoozeUntil: () => new Date('2099-01-01'),
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
			setAddress: () => {},
			openMap: () => {},
			openCompanion: () => {},
			campaignMark: () => null,
			noteTitle: () => 'Ada',
			renameNote: () => {},
			mapOpen: () => false,
			ghostIcon: () => 'moon' as const,
		} satisfies NoteChromeHost;
		applyLiveUrgency(dashboard, 'RVs/Ada.md', host, true);
		assert.equal(dashboard.classList.contains('is-snoozed'), true);
		assert.equal(dashboard.style.getPropertyValue('--rv-urgency-accent').toLowerCase(), SNOOZE_SLATE);
		assert.match(source('src/main.ts'), /mountVisitNotesInSection/);
		assert.match(source('src/main.ts'), /classifyVisitSection/);
		assert.match(source('src/main.ts'), /if \(chrome\) this\.decorateOpenNote\(surface, shown\)/);
		assert.doesNotMatch(source('src/visit-display.ts'), /rememberRecentTail|visitNotesTyping/);
		assert.match(css, /\.rv-visit-notes-host \{[^}]*font-size:\s*0/);
		assert.match(css, /\.rv-dashboard\.is-snoozed button\.rv-locator-urgency \{[^}]*border-style:\s*solid !important/);
		const chrome = source('src/note-chrome.ts');
		assert.match(chrome, /=== 'moon' \? SNOOZE_SLATE/);
		assert.match(chrome, /if \(ghost !== 'moon'\) button\.addClass\('is-ghost'\)/);
	});

	it('locks the 2026-10-13 dogfood layout', () => {
		assert.match(css, /--rv-badge-ink:\s*0\.53/);
		assert.match(css, /font-size:\s*calc\(var\(--rv-control-size, 28px\) \* var\(--rv-badge-ink\) \/ var\(--rv-digit-ink\)\) !important/);
		assert.match(css, /font-weight:\s*500 !important/);
		assert.match(css, /width:\s*calc\(var\(--rv-control-size, 28px\) \* var\(--rv-badge-ink\) \/ var\(--rv-line-ink\)\) !important/);
		assert.match(css, /\.rv-nh-toast \{[^}]*width:\s*max-content/);
		assert.match(css, /\.rv-nh-toast \{[^}]*background:\s*var\(--background-secondary\) !important/);
		assert.match(css, /\.rv-nh-toast \.rv-toast-text \{[^}]*display:\s*block/);
		assert.match(css, /\.rv-nh-toast \.rv-toast-name \{[^}]*-webkit-line-clamp:\s*unset/);
		assert.match(css, /\.rv-dashboard p\.rv-hub-owned \.rv-hub-chip,[\s\S]*border:\s*1px solid var\(--background-modifier-border\) !important/);
		assert.doesNotMatch(source('src/title-fit.ts').slice(source('src/title-fit.ts').indexOf('function slotWidth')), /row\.clientWidth/);
		assert.match(css, /\.rv-slot-when \{[^}]*align-items:\s*flex-start/);
		assert.match(css, /\.rv-when-row \.setting-item-control \{[^}]*flex-wrap:\s*nowrap !important/);
		assert.match(source('src/note-chrome.ts'), /minmax\(0, 1fr\) 40px/);
		assert.match(source('src/note-chrome.ts'), /flex', '0 0 40px'/);
		assert.match(css, /h3\.rv-older-visits,\s*\.rv-older-visits-widget \.rv-older-visits \{[^}]*justify-content:\s*center/);
		assert.match(css, /\.rv-visit-stamp \.rv-stamp-row > \.rv-visit-more[^}]*right:\s*0/);
		assert.match(css, /--callout-padding:\s*8px !important/);
		assert.match(css, /font-weight:\s*var\(--bold-weight, 600\)/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-sort-scroll\.is-hidden \{[^}]*display:\s*none !important/);
		assert.match(css, /height:\s*40px !important/);
		assert.match(source('src/override-modal.ts'), /daypartSettingLabel/);
		assert.match(source('src/override-modal.ts'), /rv-slot-when/);
		assert.match(source('src/override-modal.ts'), /setClass\('rv-modal-actions'\)/);
		assert.doesNotMatch(source('src/attempt-digest.ts'), /daypartSettingLabel/);
		assert.doesNotMatch(source('src/visit-modals.ts'), /daypartSettingLabel/);
		assert.match(source('src/visit-modals.ts'), /rv-when-row/);
		assert.match(source('src/study-panel.ts'), /skipped \? 'Did study' : "Didn't study"/);
	});
});
