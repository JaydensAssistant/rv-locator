import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { hubFillBoundary, markHubFill, noteSurfaceShown } from '../src/hub-cover';
import { fitEndEllipsis, fitTitleRow } from '../src/title-fit';
import { fillItemStrip } from '../src/visit-controls';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const { window } = dom;
const hostGlobals = globalThis as typeof globalThis & Record<string, unknown>;
hostGlobals.window = window;
hostGlobals.document = window.document;
hostGlobals.HTMLElement = window.HTMLElement;
hostGlobals.Node = window.Node;
hostGlobals.Element = window.Element;
hostGlobals.getComputedStyle = window.getComputedStyle.bind(window);

const proto = window.HTMLElement.prototype as HTMLElement & Record<string, (...args: never[]) => unknown>;
proto.addClass = function addClass(this: HTMLElement, cls: string) {
	this.classList.add(...cls.split(/\s+/).filter(Boolean));
};
proto.empty = function empty(this: HTMLElement) {
	this.replaceChildren();
};
proto.setText = function setText(this: HTMLElement, text: string) {
	this.textContent = text;
};
proto.createEl = function createEl(this: HTMLElement, tag: string, spec?: string | { cls?: string; text?: string; attr?: Record<string, string> }) {
	const el = this.ownerDocument.createElement(tag);
	if (typeof spec === 'string') el.className = spec;
	else if (spec) {
		if (spec.cls) el.className = spec.cls;
		if (spec.text) el.textContent = spec.text;
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

const css = readFileSync('styles.css', 'utf8');
const main = readFileSync('src/main.ts', 'utf8');
const chrome = readFileSync('src/note-chrome.ts', 'utf8');
const glance = readFileSync('src/glancable-view.ts', 'utf8');

function paintedStems(source: string, width: number): string[] {
	const strip = window.document.createElement('div');
	strip.className = 'rv-item-strip';
	Object.defineProperty(strip, 'clientWidth', { configurable: true, get: () => width });
	window.document.body.appendChild(strip);
	fillItemStrip(strip, source, '');
	fitTitleRow(strip);
	return Array.from(strip.querySelectorAll('.rv-fit-stem')).map((node) => node.textContent ?? '');
}

describe('RV-249 packed centered visit chips', () => {
	it('keeps a lone title whole instead of pre-cutting it', () => {
		const stems = paintedStems('· «book» «What Is the Kingdom of God?»', 180);
		assert.deepEqual(stems, ['What Is the Kingdom of God?']);
	});

	it('keeps two and three titles whole so CSS ellipsizes only when the row is full', () => {
		const two = paintedStems('· «book» «What Is the Kingdom of God?» · «film» «A short title»', 320);
		assert.deepEqual(two, ['What Is the Kingdom of God?', 'A short title']);
		const three = paintedStems('· «book» «Kingdom» · «film» «Joy» · «lesson» «Love»', 280);
		assert.deepEqual(three, ['Kingdom', 'Joy', 'Love']);
	});

	it('locks natural width, a centered group, and the 4px / 4px / 12px gaps on the phone', () => {
		assert.match(css, /\.rv-item-strip:not\(\.is-ghost\) > \.rv-item,\s*\n\.rv-item-strip:not\(\.is-ghost\) \.rv-fit \{[^}]*flex:\s*0 1 auto[^}]*min-width:\s*0/);
		assert.match(css, /\.rv-item-strip:not\(\.is-ghost\) \.rv-fit-stem \{[^}]*flex:\s*0 1 auto[^}]*text-align:\s*left/);
		assert.match(css, /\.rv-item-strip:not\(\.is-ghost\) > \.rv-item > \.rv-item-icon,\s*\n\.rv-item-strip:not\(\.is-ghost\) \.rv-type \{[^}]*flex:\s*0 0 auto/);
		assert.match(css, /body\.is-phone \.rv-item-strip:not\(\.is-ghost\)[^}]*justify-content:\s*center !important[^}]*gap:\s*12px !important/);
		assert.match(css, /body\.is-phone \.rv-item-strip:not\(\.is-ghost\) > \.rv-item,[\s\S]{0,500}\{[^}]*gap:\s*4px !important/);
		assert.match(css, /body\.is-phone \.rv-item-strip:not\(\.is-ghost\) \.rv-fit,[\s\S]{0,200}\{[^}]*gap:\s*4px !important/);
		assert.match(css, /\.rv-item-strip\.is-revealing > \.rv-item\.is-squeezed \{[^}]*flex:\s*0 0 auto !important[^}]*min-width:\s*max-content !important/);
		assert.match(css, /\.rv-item-strip\.is-revealing:not\(\.is-multi\) > \.rv-item\.is-open:not\(:only-child\) \{[^}]*max-width:\s*calc\(100% - 42px\) !important/);
	});
});

describe('RV-B51 hub open without a black frame', () => {
	it('stops snapshot layout classes at the cover and marks nothing when the frame is missing', () => {
		const doc = window.document;
		doc.body.innerHTML = `
			<div class="workspace" id="workspace">
				<div class="workspace-leaf" id="leaf">
					<div class="rv-hub-swap-cover" id="cover">
						<div class="rv-hub-snapshot-body" id="body"><div id="root"></div></div>
					</div>
					<div class="workspace-leaf-content" id="content"></div>
				</div>
			</div>`;
		const root = doc.getElementById('root')!;
		const marked: HTMLElement[] = [];
		markHubFill(root, marked);
		assert.equal(hubFillBoundary(root), doc.getElementById('cover'));
		assert.ok(doc.getElementById('body')!.classList.contains('rv-hub-fill'));
		assert.ok(doc.getElementById('cover')!.classList.contains('rv-hub-fill'));
		assert.equal(doc.getElementById('leaf')!.classList.contains('rv-hub-fill'), false);
		assert.equal(doc.getElementById('content')!.classList.contains('rv-hub-fill'), false);
		assert.equal(doc.getElementById('workspace')!.classList.contains('rv-hub-fill'), false);

		doc.body.innerHTML = '<div id="loose"><div id="orphan"></div></div>';
		const loose: HTMLElement[] = [];
		markHubFill(doc.getElementById('orphan')!, loose);
		assert.equal(hubFillBoundary(doc.getElementById('orphan')!), null);
		assert.equal(loose.length, 0);
		assert.equal(doc.getElementById('loose')!.classList.contains('rv-hub-fill'), false);
	});

	it('still fills a real hub up to its leaf', () => {
		const doc = window.document;
		doc.body.innerHTML = `
			<div id="workspace">
				<div class="workspace-leaf-content" id="leaf">
					<div class="view-content" id="view"><div id="root"></div></div>
				</div>
			</div>`;
		const marked: HTMLElement[] = [];
		markHubFill(doc.getElementById('root')!, marked);
		assert.ok(doc.getElementById('view')!.classList.contains('rv-hub-fill'));
		assert.ok(doc.getElementById('leaf')!.classList.contains('rv-hub-fill'));
		assert.equal(doc.getElementById('workspace')!.classList.contains('rv-hub-fill'), false);
		assert.match(glance, /markHubFill\(root, marked\)/);
	});

	it('repaints only the note that is showing and defers a hidden tab', () => {
		const doc = window.document;
		doc.body.innerHTML = `
			<div class="workspace-tab-container">
				<div class="workspace-leaf" id="hidden"><div id="hidden-note"></div></div>
				<div class="workspace-leaf mod-active" id="shown"><div id="shown-note"></div></div>
			</div>`;
		const hidden = doc.getElementById('hidden-note')!;
		const shown = doc.getElementById('shown-note')!;
		assert.equal(noteSurfaceShown(hidden), false);
		assert.equal(noteSurfaceShown(shown), true);
		shown.style.display = 'none';
		assert.equal(noteSurfaceShown(shown), false);

		const decorate = main.slice(main.indexOf('private scheduleReadingDecorate'), main.indexOf('private repaintOpenUrgency'));
		assert.match(decorate, /requestOpenNoteChrome\(path\)/);
		assert.doesNotMatch(decorate, /refreshOpenNoteChrome\(\)/);
		assert.match(main, /rvChromeDeferred/);
		assert.match(main, /paintShownNote\(\)/);
		assert.match(main, /noteSurfaceShown/);
	});

	it('reads every hub title width before it writes the fitted text', () => {
		const fit = chrome.slice(chrome.indexOf('function fitHubOverflow'), chrome.indexOf('function armHubOverflow'));
		const read = fit.indexOf('clientWidth');
		const write = fit.indexOf('fitEndEllipsis(label, full)');
		assert.ok(read >= 0 && write > read);
		const canvasProto = window.HTMLCanvasElement.prototype as HTMLCanvasElement & {
			getContext: (kind: string) => { measureText: (value: string) => { width: number } } | null;
		};
		const previous = canvasProto.getContext;
		canvasProto.getContext = () => ({
			font: '',
			measureText: (value: string) => ({ width: value.length * 8 }),
		});
		try {
			const label = window.document.createElement('span');
			label.dataset.rvMeasureWidth = '40';
			label.dataset.rvMeasureFont = '11px sans-serif';
			window.document.body.appendChild(label);
			fitEndEllipsis(label, 'What Is the Kingdom of God?');
			assert.ok((label.textContent ?? '').endsWith('…'));
			assert.ok((label.textContent ?? '').length < 'What Is the Kingdom of God?'.length);
		} finally {
			canvasProto.getContext = previous;
		}
	});
});
