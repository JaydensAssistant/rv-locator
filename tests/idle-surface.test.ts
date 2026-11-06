import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { pinBadgeStroke } from '../src/glancable-view';
import { livePreviewShouldPaint } from '../src/visit-live-preview';
import { Menu } from 'obsidian';
import { decorateNoteChrome, type NoteChromeHost } from '../src/note-chrome';
import { DEFAULT_SETTINGS } from '../src/types';
import { decorateVisitControls, VisitButtonLongPress } from '../src/visit-controls';
import { mountHeadingChevron } from '../src/visit-display';
import { recordIsMeasureSpans, visitSurfaceRecordsMatter, watchVisitSurface } from '../src/visit-surface';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
const hostGlobals = globalThis as typeof globalThis & Record<string, unknown>;
hostGlobals.window = window;
hostGlobals.document = window.document;
hostGlobals.HTMLElement = window.HTMLElement;
hostGlobals.HTMLInputElement = window.HTMLInputElement;
hostGlobals.HTMLAnchorElement = window.HTMLAnchorElement;
hostGlobals.SVGElement = window.SVGElement;
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
proto.createDiv = function createDiv(this: HTMLElement, spec?: string | { cls?: string; text?: string }) {
	return this.createEl('div', typeof spec === 'string' ? { cls: spec } : spec);
};
proto.setText = function setText(this: HTMLElement, text: string) {
	this.textContent = text;
	return this;
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
		for (const className of ['rv-hub-row', 'rv-hub-chip', 'rv-address-line', 'rv-address-link', 'rv-qf-body']) {
			const painted = window.document.createElement('span');
			painted.className = className;
			const record = { addedNodes: [window.document.createElement('span')], removedNodes: [], target: painted } as unknown as MutationRecord;
			assert.equal(visitSurfaceRecordsMatter([record]), false, className);
		}
		const dash = window.document.createElement('div');
		dash.dataset.rvDash = 'Return';
		const dashRecord = { addedNodes: [window.document.createElement('span')], removedNodes: [], target: dash } as unknown as MutationRecord;
		assert.equal(visitSurfaceRecordsMatter([dashRecord]), false);
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
		const other = window.document.createElement('button');
		other.className = 'rv-locator-urgency';
		window.document.body.appendChild(other);
		const again: string[] = [];
		window.document.createElement = ((tag: string) => {
			again.push(tag);
			return real(tag);
		}) as typeof window.document.createElement;
		pinBadgeStroke(other);
		window.document.createElement = real;
		assert.deepEqual(again, [], 'a second badge reuses the document stroke');
		assert.equal(other.style.getPropertyValue('border-width'), '2px');
		button.remove();
		other.remove();
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

	it('keeps an idle note from rebuilding the hub row', async () => {
		const data: Record<string, unknown> = {
			cssclasses: ['rv-dashboard'],
			Hub: '[[Return Visits Hub]]',
			Address: '12 Oak Street',
			Status: 'Return',
			Priority: 1,
		};
		const opened = { hub: 0 };
		const host = noteHost(data, opened);
		const surface = window.document.createElement('div');
		surface.className = 'markdown-preview-view';
		surface.innerHTML = `
			<div class="callout" data-callout="quote">
				<div class="callout-title"><div class="callout-title-inner">RV Dashboard</div></div>
			</div>
			<p><strong>Hub:</strong> <strong>Address:</strong> 12 Oak Street</p>
			<div class="callout" data-callout="rv">
				<div class="callout-title"><div class="callout-title-inner">Visit Facts</div></div>
				<div class="callout-content"></div>
			</div>
			<div class="callout" data-callout="note">
				<div class="callout-title"><div class="callout-title-inner">Log</div></div>
			</div>`;
		window.document.body.appendChild(surface);
		decorateNoteChrome(surface, 'People/Eve.md', host);
		await turn();
		drain();
		const chip = surface.querySelector('.rv-hub-chip');
		const dash = surface.querySelector('.rv-dash-name');
		const address = surface.querySelector('a.rv-address-link');
		const slot = surface.querySelector('.rv-attempt-override');
		const fact = surface.querySelector('.rv-qf-body')?.firstElementChild ?? null;
		assert.ok(chip instanceof window.HTMLElement);
		assert.ok(dash instanceof window.HTMLElement);
		assert.ok(address instanceof window.HTMLElement);
		assert.ok(slot instanceof window.HTMLElement);
		assert.ok(fact instanceof window.HTMLElement);

		let refreshes = 0;
		let hubRebuilds = 0;
		const watch = watchVisitSurface(surface, () => {
			refreshes += 1;
			const before = surface.querySelector('.rv-hub-chip');
			decorateNoteChrome(surface, 'People/Eve.md', host);
			if (surface.querySelector('.rv-hub-chip') !== before) hubRebuilds += 1;
		});
		for (let frame = 0; frame < 40; frame += 1) {
			await turn();
			drain();
		}
		assert.equal(refreshes, 0);
		assert.equal(hubRebuilds, 0);
		assert.equal(surface.querySelector('.rv-hub-chip'), chip);
		assert.equal(surface.querySelector('.rv-dash-name'), dash);
		assert.equal(surface.querySelector('a.rv-address-link'), address);
		assert.equal(surface.querySelector('.rv-attempt-override'), slot);
		assert.equal(surface.querySelector('.rv-qf-body')?.firstElementChild ?? null, fact);

		const row = surface.querySelector('.rv-hub-row');
		assert.ok(row instanceof window.HTMLElement);
		row.appendChild(window.document.createElement('span'));
		const line = surface.querySelector('.rv-address-line');
		assert.ok(line instanceof window.HTMLElement);
		line.appendChild(window.document.createElement('span'));
		dash.appendChild(window.document.createElement('span'));
		await turn();
		drain();
		assert.equal(refreshes, 0);
		assert.equal(hubRebuilds, 0);

		watch.schedule();
		await turn();
		drain();
		await turn();
		drain();
		assert.equal(refreshes, 1);
		assert.equal(hubRebuilds, 0);
		assert.equal(surface.querySelector('.rv-hub-chip'), chip);

		data.Hub = '[[North Hub]]';
		const edited = window.document.createElement('p');
		edited.textContent = 'The hub list changed.';
		surface.appendChild(edited);
		await turn();
		drain();
		assert.equal(refreshes, 2);
		assert.equal(hubRebuilds, 1);
		assert.equal(surface.querySelector('.rv-hub-chip-label')?.textContent, 'North Hub');
		await turn();
		drain();
		assert.equal(refreshes, 2);
		watch.stop();
		surface.remove();
	});

	it('opens the hub on a left click and does not open the menu from a detached chip', () => {
		const timers = holdTimers();
		const shown: Event[] = [];
		const original = Menu.prototype.showAtMouseEvent;
		Menu.prototype.showAtMouseEvent = function show(event: MouseEvent): void {
			shown.push(event);
			original.call(this, event);
		};
		try {
			const data: Record<string, unknown> = {
				cssclasses: ['rv-dashboard'],
				Hub: '[[Return Visits Hub]]',
				Address: '12 Oak Street',
			};
			const opened = { hub: 0 };
			const host = noteHost(data, opened);
			const surface = window.document.createElement('div');
			surface.className = 'markdown-preview-view';
			surface.innerHTML = '<p><strong>Hub:</strong> <strong>Address:</strong> 12 Oak Street</p>';
			window.document.body.appendChild(surface);
			decorateNoteChrome(surface, 'People/Eve.md', host);
			const link = surface.querySelector('a.rv-hub-chip');
			assert.ok(link instanceof window.HTMLAnchorElement);
			press(link, 'mouse');
			window.document.dispatchEvent(pointer('pointerup', 'mouse'));
			timers.fire();
			link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
			assert.equal(opened.hub, 1);
			assert.equal(shown.length, 0);
			assert.equal(link.dataset.rvMenu ?? '', '');

			press(link, 'mouse');
			link.remove();
			timers.fire();
			assert.equal(shown.length, 0);
			assert.equal(link.dataset.rvMenu ?? '', '');

			decorateNoteChrome(surface, 'People/Eve.md', host);
			const again = surface.querySelector('a.rv-hub-chip');
			assert.ok(again instanceof window.HTMLAnchorElement);
			press(again, 'touch');
			timers.fire();
			assert.equal(shown.length, 1);
			assert.equal(again.dataset.rvMenu, '1');
			timers.fire();
			assert.equal(again.dataset.rvMenu ?? '', '');

			const address = surface.querySelector('a.rv-address-link');
			const input = surface.querySelector('input.rv-address-input');
			assert.ok(address instanceof window.HTMLElement);
			assert.ok(input instanceof window.HTMLInputElement);
			assert.equal(input.hidden, true);
			press(address, 'mouse');
			window.document.dispatchEvent(pointer('pointerup', 'mouse'));
			timers.fire();
			assert.equal(input.hidden, true);
			press(address, 'mouse');
			address.remove();
			timers.fire();
			assert.equal(input.hidden, true);
			surface.remove();
		} finally {
			Menu.prototype.showAtMouseEvent = original;
			timers.restore();
		}
	});

	it('RV-B23 a phone hold still opens the hub menu after the touch leaves', () => {
		const timers = holdTimers();
		const shown: Event[] = [];
		const original = Menu.prototype.showAtMouseEvent;
		Menu.prototype.showAtMouseEvent = function show(event: MouseEvent): void {
			shown.push(event);
			original.call(this, event);
		};
		const realNow = Date.now;
		try {
			const data: Record<string, unknown> = {
				cssclasses: ['rv-dashboard'],
				Hub: '[[Return Visits Hub]]',
				Address: '12 Oak Street',
			};
			const host = noteHost(data, { hub: 0 });
			const surface = window.document.createElement('div');
			surface.className = 'markdown-preview-view';
			surface.innerHTML = '<p><strong>Hub:</strong> <strong>Address:</strong> 12 Oak Street</p>';
			window.document.body.appendChild(surface);
			decorateNoteChrome(surface, 'People/Eve.md', host);
			const link = surface.querySelector('a.rv-hub-chip');
			assert.ok(link instanceof window.HTMLAnchorElement);
			press(link, 'touch');
			link.dispatchEvent(pointer('pointerleave', 'touch'));
			timers.fire();
			assert.equal(shown.length, 1);
			assert.equal(link.dataset.rvMenu, '1');

			shown.length = 0;
			press(link, 'touch');
			link.dispatchEvent(pointer('pointercancel', 'touch'));
			timers.fire();
			assert.equal(shown.length, 0);

			press(link, 'touch');
			Date.now = () => realNow() + 1000;
			link.dispatchEvent(pointer('pointercancel', 'touch'));
			Date.now = realNow;
			timers.fire();
			assert.equal(shown.length, 1);
			surface.remove();
		} finally {
			Date.now = realNow;
			Menu.prototype.showAtMouseEvent = original;
			timers.restore();
		}
	});

	it('RV-B23 the phone hub menu stays open after the finger lifts', () => {
		const timers = holdTimers();
		const shown: Event[] = [];
		const original = Menu.prototype.showAtMouseEvent;
		Menu.prototype.showAtMouseEvent = function show(event: MouseEvent): void {
			shown.push(event);
			original.call(this, event);
		};
		const reached: string[] = [];
		const hear = (event: Event): void => { reached.push(event.type); };
		try {
			const data: Record<string, unknown> = {
				cssclasses: ['rv-dashboard'],
				Hub: '[[Return Visits Hub]]',
				Address: '12 Oak Street',
			};
			const host = noteHost(data, { hub: 0 });
			const surface = window.document.createElement('div');
			surface.className = 'markdown-preview-view';
			surface.innerHTML = '<p><strong>Hub:</strong> <strong>Address:</strong> 12 Oak Street</p>';
			window.document.body.appendChild(surface);
			decorateNoteChrome(surface, 'People/Eve.md', host);
			const link = surface.querySelector('a.rv-hub-chip');
			assert.ok(link instanceof window.HTMLAnchorElement);
			link.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 24 }));
			assert.equal(shown.length, 1);
			window.addEventListener('mouseup', hear, true);
			link.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, cancelable: true }));
			assert.deepEqual(reached, ['mouseup']);
			window.removeEventListener('mouseup', hear, true);
			reached.length = 0;

			press(link, 'touch');
			timers.fire();
			assert.equal(shown.length, 2);
			window.addEventListener('pointerup', hear, true);
			window.addEventListener('mousedown', hear, true);
			window.addEventListener('click', hear, true);
			link.dispatchEvent(pointer('pointerup', 'touch'));
			link.dispatchEvent(new window.Event('touchend', { bubbles: true, cancelable: true }));
			link.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
			link.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, cancelable: true }));
			link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
			assert.deepEqual(reached, []);
			link.dispatchEvent(pointer('pointerdown', 'touch'));
			link.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
			link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
			assert.deepEqual(reached, ['mousedown', 'click']);
			window.removeEventListener('pointerup', hear, true);
			window.removeEventListener('mousedown', hear, true);
			window.removeEventListener('click', hear, true);
			surface.remove();
		} finally {
			window.removeEventListener('mouseup', hear, true);
			window.removeEventListener('pointerup', hear, true);
			window.removeEventListener('mousedown', hear, true);
			window.removeEventListener('click', hear, true);
			Menu.prototype.showAtMouseEvent = original;
			timers.restore();
		}
	});

	it('does not treat a replaced visit button as a completed long press', () => {
		const timers = holdTimers();
		try {
			const press = new VisitButtonLongPress();
			const wrap = window.document.createElement('div');
			wrap.className = 'mb-button rv-visit-btn';
			const button = window.document.createElement('button');
			button.setAttribute('aria-label', 'Not home');
			wrap.appendChild(button);
			window.document.body.appendChild(wrap);
			press.start({ target: button } as TouchEvent);
			button.remove();
			timers.fire();
			const liveWrap = window.document.createElement('div');
			liveWrap.className = 'mb-button rv-visit-btn';
			const live = window.document.createElement('button');
			live.setAttribute('aria-label', 'Not home');
			liveWrap.appendChild(live);
			window.document.body.appendChild(liveWrap);
			const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
			live.dispatchEvent(click);
			press.swallow(click);
			assert.equal(click.defaultPrevented, false);

			const held = window.document.createElement('button');
			held.setAttribute('aria-label', 'Not home');
			liveWrap.appendChild(held);
			press.start({ target: held } as TouchEvent);
			window.document.dispatchEvent(pointer('pointerup', 'touch'));
			timers.fire();
			const lift = new window.MouseEvent('click', { bubbles: true, cancelable: true });
			held.dispatchEvent(lift);
			press.swallow(lift);
			assert.equal(lift.defaultPrevented, false);
			wrap.remove();
			liveWrap.remove();
		} finally {
			timers.restore();
		}
	});
});

function noteHost(data: Record<string, unknown>, opened: { hub: number }): NoteChromeHost {
	return {
		frontmatter: () => data,
		settings: { ...DEFAULT_SETTINGS },
		snoozeUntil: () => null,
		setStatus: () => {},
		setPriority: () => {},
		openUrgency: () => {},
		openPriority: () => {},
		openRoute: () => {},
		openHub: () => { opened.hub += 1; },
		addHub: () => {},
		removeHub: () => {},
		moveHub: () => {},
		openSlotOverride: () => {},
		setAddress: () => {},
		openMap: () => {},
		openCompanion: () => {},
		campaignMark: () => null,
		noteTitle: () => 'Eve',
		renameNote: () => {},
		mapOpen: () => false,
		ghostIcon: () => null,
	};
}

function drain(): void {
	const batch = frames.splice(0);
	for (const cb of batch) cb(0);
}

function pointer(type: string, pointerType: string): Event {
	const Ctor = typeof window.PointerEvent === 'function' ? window.PointerEvent : window.MouseEvent;
	const event = new Ctor(type, { bubbles: true, cancelable: true, button: 0 });
	Object.defineProperty(event, 'pointerType', { value: pointerType });
	return event;
}

function press(el: HTMLElement, pointerType: string): void {
	el.dispatchEvent(pointer('pointerdown', pointerType));
}

function holdTimers(): { fire: () => void; restore: () => void } {
	const pending = new Map<number, () => void>();
	let nextId = 1_000_000;
	const realSet = window.setTimeout.bind(window);
	const realClear = window.clearTimeout.bind(window);
	const held = new Set([400, 450, 500]);
	window.setTimeout = ((fn: TimerHandler, delay?: number) => {
		if (typeof fn === 'function' && held.has(delay ?? 0)) {
			const id = nextId;
			nextId += 1;
			pending.set(id, () => { fn(); });
			return id;
		}
		return realSet(fn, delay);
	}) as typeof window.setTimeout;
	window.clearTimeout = ((id?: number) => {
		if (id != null && pending.delete(id)) return;
		realClear(id);
	}) as typeof window.clearTimeout;
	return {
		fire: () => {
			const batch = [...pending.values()];
			pending.clear();
			for (const fn of batch) fn();
		},
		restore: () => {
			window.setTimeout = realSet;
			window.clearTimeout = realClear;
			pending.clear();
		},
	};
}
