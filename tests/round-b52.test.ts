import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { fitHubCoverHeader, handoffCoverLanding, holdLeafForHubPaint, releaseHubSwapCover } from '../src/hub-cover';
import { hubLandingReady, landingScrollFor } from '../src/hub-layout';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const { window } = dom;
const hostGlobals = globalThis as typeof globalThis & Record<string, unknown>;
hostGlobals.window = window;
hostGlobals.document = window.document;
hostGlobals.HTMLElement = window.HTMLElement;
hostGlobals.Element = window.Element;
hostGlobals.MutationObserver = window.MutationObserver;

function noteHeader(doc: Document, folder: string, title: string): HTMLElement {
	const header = doc.createElement('div');
	header.className = 'view-header';
	const container = doc.createElement('div');
	container.className = 'view-header-title-container';
	const parent = doc.createElement('div');
	parent.className = 'view-header-title-parent';
	if (folder) {
		const crumb = doc.createElement('span');
		crumb.className = 'view-header-breadcrumb';
		crumb.textContent = folder;
		parent.append(crumb);
	}
	container.append(parent);
	const name = doc.createElement('div');
	name.className = 'view-header-title';
	name.textContent = title;
	container.append(name);
	const actions = doc.createElement('div');
	actions.className = 'view-actions';
	for (const label of ['Bookmark', 'Edit', 'More options']) {
		const button = doc.createElement('button');
		button.className = 'clickable-icon view-action';
		button.setAttribute('aria-label', label);
		button.textContent = label;
		actions.append(button);
	}
	header.append(container, actions);
	return header;
}

function actionLabels(header: HTMLElement): string[] {
	return Array.from(header.querySelectorAll('.view-action')).map((node) => node.getAttribute('aria-label') ?? '');
}

const css = readFileSync('styles.css', 'utf8');
const glance = readFileSync('src/glancable-view.ts', 'utf8');
const coverSource = readFileSync('src/hub-cover.ts', 'utf8');

interface Rect {
	top: number;
	height: number;
}

function rectOf(box: Rect): DOMRect {
	return {
		top: box.top,
		bottom: box.top + box.height,
		left: 0,
		right: 392,
		width: 392,
		height: box.height,
		x: 0,
		y: box.top,
		toJSON: () => ({}),
	} as DOMRect;
}

function mountList(name: string, viewTop: number, viewHeight: number, scrollHeight: number, cards: { path: string; offset: number; height: number }[]) {
	const scroll = window.document.createElement('div');
	scroll.className = 'rv-locator-scroll';
	let scrollTop = 0;
	const nodes = cards.map((card) => {
		const node = window.document.createElement('div');
		node.className = 'rv-locator-card';
		node.setAttribute('data-rv-path', card.path);
		node.dataset.offset = String(card.offset);
		node.dataset.cardHeight = String(card.height);
		scroll.append(node);
		node.getBoundingClientRect = () => rectOf({ top: viewTop + card.offset - scrollTop, height: card.height });
		return node;
	});
	scroll.getBoundingClientRect = () => rectOf({ top: viewTop, height: viewHeight });
	Object.defineProperty(scroll, 'clientHeight', { configurable: true, get: () => viewHeight });
	Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => scrollHeight });
	Object.defineProperty(scroll, 'scrollTop', {
		configurable: true,
		get: () => scrollTop,
		set: (value: number) => {
			scrollTop = value;
		},
	});
	scroll.dataset.list = name;
	return { scroll, nodes };
}

describe('RV-B52 hub landing', () => {
	const cards = [
		{ path: 'People/Top.md', offset: 0, height: 96 },
		{ path: 'People/Mid.md', offset: 480, height: 96 },
		{ path: 'People/Bottom.md', offset: 960, height: 96 },
	];

	it('matches the cover card and keeps a last card fully on screen', () => {
		const viewTop = 48;
		const viewHeight = 758;
		const { scroll, nodes } = mountList('live', viewTop, viewHeight, 1100, cards);
		const mid = landingScrollFor(scroll, nodes[1]!, 334);
		scroll.scrollTop = mid;
		assert.ok(Math.abs(nodes[1]!.getBoundingClientRect().top - 334) <= 2);
		assert.equal(hubLandingReady(scroll, nodes[1]!), true);

		scroll.scrollTop = 0;
		const bottom = landingScrollFor(scroll, nodes[2]!, 900);
		scroll.scrollTop = bottom;
		const box = scroll.getBoundingClientRect();
		const landed = nodes[2]!.getBoundingClientRect();
		assert.ok(landed.top >= box.top - 2);
		assert.ok(landed.bottom <= box.bottom + 2);

		scroll.scrollTop = 40;
		const top = landingScrollFor(scroll, nodes[0]!, 48);
		assert.equal(top, 0);
	});

	it('hands the cover scroll to the live card and leaves a direct open at the top', () => {
		const doc = window.document;
		const viewTop = 48;
		const viewHeight = 700;
		const coverList = mountList('cover', viewTop, viewHeight, 1200, cards);
		const liveList = mountList('live', viewTop, viewHeight, 1200, cards);
		coverList.scroll.scrollTop = 228;
		const cover = doc.createElement('div');
		cover.className = 'rv-hub-swap-cover';
		cover.append(coverList.scroll);
		const leaf = doc.createElement('div');
		leaf.className = 'workspace-leaf';
		leaf.append(cover, liveList.scroll);
		doc.body.append(leaf);
		const mid = coverList.nodes[1]!;
		mid.classList.add('rv-card-land');
		mid.dataset.rvLandAt = String(Date.now() - 200);
		const before = mid.getBoundingClientRect().top;
		let landed = '';
		assert.equal(handoffCoverLanding(doc, (path) => { landed = path; }), true);
		assert.equal(landed, 'People/Mid.md');
		assert.ok(Math.abs(liveList.nodes[1]!.getBoundingClientRect().top - before) <= 2);
		assert.equal(liveList.nodes[1]!.classList.contains('rv-card-land'), true);
		assert.equal(liveList.scroll.scrollTop > 0, true);

		liveList.scroll.scrollTop = 0;
		mid.classList.remove('rv-card-land');
		assert.equal(handoffCoverLanding(doc), false);
		assert.equal(liveList.scroll.scrollTop, 0);
		leaf.remove();
	});

	it('applies the landing before the cover drops and only consumes a laid-out card', () => {
		const stop = coverSource.slice(coverSource.indexOf('const stop ='), coverSource.indexOf('const observer'));
		const hand = stop.indexOf('handoffCoverLanding');
		const drop = stop.indexOf('releaseHubSwapCover');
		assert.ok(hand >= 0 && hand < drop);
		const land = glance.slice(glance.indexOf('private landArrival'), glance.indexOf('protected paint'));
		const early = land.indexOf('clientHeight <= 1');
		const take = land.indexOf('if (!cover) this.plugin.takeHubArrival()');
		assert.ok(early >= 0 && early < take);
		assert.match(land, /landingScrollExact/);
		assert.match(css, /\.workspace-leaf > \.rv-hub-swap-cover > \.view-header \{[^}]*position:\s*relative !important/);
		assert.match(css, /body\.is-phone \.workspace-leaf > \.rv-hub-swap-cover > \.view-header::after/);
		assert.match(css, /animation-delay:\s*var\(--rv-land-delay, 0ms\)/);
		assert.match(css, /\.view-header-title-parent/);
		assert.match(css, /aria-label\*="bookmark" i/);
		assert.match(coverSource, /fitHubCoverHeader\(header\)/);
		assert.match(css, /\.theme-dark \.rv-locator-card\.rv-card-land \{[^}]*rgba\(255, 255, 255, 0\.09\)/);
		assert.match(css, /\.theme-light \.rv-locator-card\.rv-card-land \{[^}]*rgba\(0, 0, 0, 0\.07\)/);
	});

	it('paints the hub header on the cover for a subfolder note and a root note', () => {
		const doc = window.document;
		const folder = noteHeader(doc, 'People', 'Dale Red');
		fitHubCoverHeader(folder);
		assert.equal(folder.textContent?.includes('People'), false);
		assert.deepEqual(actionLabels(folder), ['Edit', 'More options']);
		assert.match(folder.querySelector('.view-header-title')?.textContent ?? '', /Dale Red/);

		const root = noteHeader(doc, '', 'Root Note');
		fitHubCoverHeader(root);
		assert.equal(root.querySelector('.view-header-title-parent'), null);
		assert.equal(root.textContent?.includes('Bookmark'), false);
		assert.deepEqual(actionLabels(root), ['Edit', 'More options']);

		doc.body.classList.add('is-phone');
		window.requestAnimationFrame = () => 0;
		const leaf = doc.createElement('div');
		leaf.className = 'workspace-leaf mod-active';
		const note = doc.createElement('div');
		note.className = 'markdown-preview-view';
		note.textContent = 'A note in a folder';
		leaf.append(noteHeader(doc, 'People', 'Dale Red'), note);
		leaf.getBoundingClientRect = () => ({
			width: 392, height: 806, top: 0, left: 0, right: 392, bottom: 806, x: 0, y: 0, toJSON() { return {}; },
		}) as DOMRect;
		doc.body.append(leaf);
		try {
			holdLeafForHubPaint(leaf, {
				title: 'Return Visits Hub',
				mount(host) {
					const card = doc.createElement('div');
					card.className = 'rv-locator-card';
					const bar = doc.createElement('div');
					bar.className = 'rv-locator-toolbar-actions';
					bar.append(doc.createElement('button'));
					host.append(card, bar);
				},
			});
			const cover = leaf.querySelector(':scope > .rv-hub-swap-cover .view-header');
			assert.ok(cover instanceof window.HTMLElement);
			assert.equal(cover.textContent?.includes('People'), false);
			assert.equal(cover.textContent?.includes('Bookmark'), false);
			assert.deepEqual(actionLabels(cover), ['Edit', 'More options']);
			assert.match(cover.textContent ?? '', /Return Visits Hub/);
		} finally {
			releaseHubSwapCover(doc);
			leaf.remove();
			doc.body.classList.remove('is-phone', 'rv-hub-swapping', 'rv-hide-mobile-nav');
		}
	});
});
