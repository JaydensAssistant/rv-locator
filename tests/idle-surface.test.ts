import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { pinBadgeStroke } from '../src/glancable-view';
import { livePreviewShouldPaint } from '../src/visit-live-preview';
import { decorateVisitControls } from '../src/visit-controls';
import { mountHeadingChevron } from '../src/visit-display';
import { recordIsMeasureSpans, visitSurfaceRecordsMatter, watchVisitSurface } from '../src/visit-surface';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
const hostGlobals = globalThis as typeof globalThis & Record<string, unknown>;
hostGlobals.window = window;
hostGlobals.document = window.document;
hostGlobals.HTMLElement = window.HTMLElement;
hostGlobals.Element = window.Element;
hostGlobals.Node = window.Node;
hostGlobals.MutationObserver = window.MutationObserver;
hostGlobals.requestAnimationFrame = window.requestAnimationFrame.bind(window);
hostGlobals.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

const proto = window.HTMLElement.prototype as HTMLElement & Record<string, (...args: never[]) => unknown>;
proto.addClass = function addClass(this: HTMLElement, cls: string) {
	this.classList.add(...cls.split(/\s+/).filter(Boolean));
};
proto.removeClass = function removeClass(this: HTMLElement, cls: string) {
	this.classList.remove(...cls.split(/\s+/).filter(Boolean));
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
proto.createSpan = function createSpan(this: HTMLElement, spec?: string | { cls?: string; text?: string }) {
	return this.createEl('span', typeof spec === 'string' ? { cls: spec } : spec);
};

const frames: FrameRequestCallback[] = [];
window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
	frames.push(cb);
	return frames.length;
};
window.cancelAnimationFrame = (): void => {};
hostGlobals.requestAnimationFrame = window.requestAnimationFrame;
hostGlobals.cancelAnimationFrame = window.cancelAnimationFrame;

function source(file: string): string {
	return readFileSync(file, 'utf8');
}

async function turn(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('idle visit surface', () => {
	it('does not run refreshVisitCards again without a real change', async () => {
		const surface = window.document.createElement('div');
		surface.className = 'markdown-preview-view';
		const heading = window.document.createElement('h5');
		heading.textContent = 'Mon, 10:40am — Oct 13, 2026';
		const stamp = window.document.createElement('span');
		stamp.className = 'rv-stamp-source';
		stamp.textContent = 'Mon, 10:40am — Oct 13, 2026';
		heading.appendChild(stamp);
		surface.appendChild(heading);
		window.document.body.appendChild(surface);

		let runs = 0;
		const watch = watchVisitSurface(surface, () => {
			runs += 1;
			stamp.textContent = 'Mon, 10:40am — Oct 13, 2026';
			const stray = window.document.createElement('span');
			stray.className = 'rv-refresh-mark';
			heading.appendChild(stray);
			stray.remove();
			const probe = window.document.createElement('span');
			probe.setAttribute('aria-hidden', 'true');
			heading.appendChild(probe);
			probe.remove();
			const fit = heading.querySelector('.rv-fit') ?? window.document.createElement('span');
			fit.className = 'rv-fit';
			if (!fit.parentElement) heading.appendChild(fit);
			const stem = fit.querySelector('.rv-fit-stem') ?? window.document.createElement('span');
			stem.className = 'rv-fit-stem';
			stem.textContent = 'Enjoy';
			if (!stem.parentElement) fit.appendChild(stem);
		});

		const arrived = window.document.createElement('p');
		arrived.textContent = 'A paragraph arrived.';
		surface.appendChild(arrived);
		for (let pass = 0; pass < 4; pass += 1) {
			await turn();
			const batch = frames.splice(0);
			for (const cb of batch) cb(0);
		}
		assert.equal(runs, 1);

		stamp.textContent = 'Mon, 10:40am — Oct 13, 2026 again';
		const measure = window.document.createElement('span');
		measure.setAttribute('aria-hidden', 'true');
		heading.appendChild(measure);
		measure.remove();
		for (let pass = 0; pass < 3; pass += 1) {
			await turn();
			const batch = frames.splice(0);
			for (const cb of batch) cb(0);
		}
		assert.equal(runs, 1);

		const edited = window.document.createElement('p');
		edited.textContent = 'Someone edited the note.';
		surface.appendChild(edited);
		for (let pass = 0; pass < 3; pass += 1) {
			await turn();
			const batch = frames.splice(0);
			for (const cb of batch) cb(0);
		}
		assert.equal(runs, 2);
		watch.stop();
		surface.remove();

		const main = source('src/main.ts');
		assert.match(main, /watchVisitSurface\(surface,/);
		assert.match(source('src/visit-surface.ts'), /observer\?\.takeRecords\(\)/);
		const update = source('src/visit-live-preview.ts');
		const body = update.slice(update.indexOf('update(update: ViewUpdate)'), update.indexOf('destroy()'));
		assert.match(body, /livePreviewShouldPaint/);
	});

	it('ignores measure spans and self-paint nodes', () => {
		const root = window.document.createElement('div');
		const fit = window.document.createElement('span');
		fit.className = 'rv-fit';
		root.appendChild(fit);
		const probe = window.document.createElement('span');
		probe.setAttribute('aria-hidden', 'true');
		const measure = { addedNodes: [probe], removedNodes: [probe], target: root } as unknown as MutationRecord;
		assert.equal(recordIsMeasureSpans(measure), true);
		assert.equal(visitSurfaceRecordsMatter([measure]), false);
		const empty = { addedNodes: [], removedNodes: [], target: root } as unknown as MutationRecord;
		assert.equal(recordIsMeasureSpans(empty), false);
		const inside = { addedNodes: [window.document.createElement('span')], removedNodes: [], target: fit } as unknown as MutationRecord;
		assert.equal(visitSurfaceRecordsMatter([inside]), false);
		const real = { addedNodes: [window.document.createElement('p')], removedNodes: [], target: root } as unknown as MutationRecord;
		assert.equal(visitSurfaceRecordsMatter([real]), true);
	});

	it('repaints live preview on geometry only when the content width changes', () => {
		assert.equal(livePreviewShouldPaint({
			docChanged: false,
			viewportChanged: false,
			geometryChanged: true,
			previousWidth: 640,
			nextWidth: 640,
		}), false);
		assert.equal(livePreviewShouldPaint({
			docChanged: false,
			viewportChanged: false,
			geometryChanged: true,
			previousWidth: 640,
			nextWidth: 480,
		}), true);
		assert.equal(livePreviewShouldPaint({
			docChanged: true,
			viewportChanged: false,
			geometryChanged: false,
			previousWidth: 640,
			nextWidth: 640,
		}), true);
		assert.equal(livePreviewShouldPaint({
			docChanged: false,
			viewportChanged: true,
			geometryChanged: false,
			previousWidth: 640,
			nextWidth: 640,
		}), true);
	});

	it('measures a badge stroke once and keeps the 2px ring', () => {
		const button = window.document.createElement('button');
		button.className = 'rv-locator-urgency is-ghost';
		window.document.body.appendChild(button);
		pinBadgeStroke(button);
		assert.equal(button.style.getPropertyValue('border-style'), 'dashed');
		assert.equal(button.style.getPropertyValue('border-width'), '2px');
		assert.equal(button.dataset.rvStrokePx, '2px');
		const created: string[] = [];
		const real = window.document.createElement.bind(window.document);
		window.document.createElement = ((tag: string) => {
			created.push(tag);
			return real(tag);
		}) as typeof window.document.createElement;
		pinBadgeStroke(button);
		window.document.createElement = real;
		assert.deepEqual(created, []);
		assert.equal(button.style.getPropertyValue('border-width'), '2px');
		assert.equal(button.style.getPropertyPriority('border-width'), 'important');
		button.remove();
		const glance = source('src/glancable-view.ts');
		const stroke = glance.slice(
			glance.indexOf('export function pinBadgeStroke'),
			glance.indexOf('export type BadgeIconName'),
		);
		assert.doesNotMatch(stroke, /requestAnimationFrame/);
	});

	it('leaves the visit card DOM alone when refreshVisitCards runs again', () => {
		const surface = window.document.createElement('div');
		surface.className = 'markdown-preview-view';
		const heading = window.document.createElement('h5');
		heading.textContent = 'Mon, 10:40am — Oct 6, 2025 · «book» «Enjoy Life Forever»';
		surface.appendChild(heading);
		const notes = window.document.createElement('h3');
		notes.textContent = 'Recent Notes:';
		surface.appendChild(notes);
		window.document.body.appendChild(surface);
		decorateVisitControls(surface, () => null, () => {});
		const chevron = notes.querySelector('.collapse-indicator');
		assert.ok(chevron instanceof window.HTMLElement);
		mountHeadingChevron(chevron);
		const first = surface.innerHTML;
		const svgs = chevron.querySelectorAll('svg').length;
		decorateVisitControls(surface, () => null, () => {});
		mountHeadingChevron(chevron);
		assert.equal(surface.innerHTML, first);
		assert.equal(chevron.querySelectorAll('svg').length, svgs);
		assert.equal(svgs, 1);
		surface.remove();
	});
});
