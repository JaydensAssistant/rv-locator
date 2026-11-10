import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { URGENCY_COLUMN_ID } from '../src/constants';
import { clusterAppearance, groupPinStacks, orderByHubSort, pinUrgencyZ, type MapPin } from '../src/map-pins';
import { clearBadgeStrokeCache, pinBadgeRings, pinBadgeStroke } from '../src/glancable-view';
import { cardPaintKey } from '../src/hub-cache';
import { mapStayForOpen, shownHubStage } from '../src/map-handoff';
import { createMapShell, ensureMapSpacer, shellBandPx, sizeMapSpacer, writeShellBand } from '../src/map-shell';
import { delayUntilNextLocalDay } from '../src/snooze';
import { stagePaintBox } from '../src/map-view';
import { annotateRowScores, displayedUrgency } from '../src/row-score';
import { urgencyScore } from '../src/scoring';
import { sortRowsBy, type Sortable } from '../src/sort';
import type { RowModel } from '../src/model';
import type { RVLocatorSettings } from '../src/types';

function source(file: string): string {
	return readFileSync(file, 'utf8');
}

const thresholds = { 1: 30, 2: 30, 3: 21, 4: 14, 5: 7 };

function urgencyKey(value: number | null): Sortable {
	if (value == null) return { kind: 'empty' };
	return { kind: 'number', value };
}

function placed(
	name: string,
	urgency: number | null,
	snoozed: boolean,
	snoozeEndMs: number | null,
) {
	return {
		name,
		lat: null,
		lon: null,
		urgencySnoozed: snoozed,
		urgencySnoozeEnd: snoozeEndMs,
		sortKeys: {
			[URGENCY_COLUMN_ID]: urgencyKey(urgency),
			'file.name': { kind: 'text' as const, value: name },
		},
	};
}

function pin(partial: Partial<MapPin> & Pick<MapPin, 'path' | 'color' | 'urgency' | 'priority'>): MapPin {
	return {
		name: partial.path,
		lat: 0,
		lon: 0,
		days: 0,
		glyph: '',
		fresh: false,
		stateIcon: null,
		snoozed: false,
		shadeIcon: null,
		markText: null,
		rank: 0,
		card: {
			address: '',
			city: '',
			study: false,
			spoke: '',
			attempted: '',
			studied: '',
			met: '',
			metWith: '',
			visits: '',
			studyRatio: '',
			literature: '',
			media: '',
			lessons: [],
		},
		...partial,
	};
}

describe('RV-B53 snoozed cards on Urgency', () => {
	it('puts every snoozed card under every awake card, soonest snooze first, in either direction', () => {
		const rows = [
			placed('Alpha', 0, true, 5_000),
			placed('Mike', 0, false, null),
			placed('Zulu', 0, false, null),
			placed('Beta', 9, true, 1_000),
			placed('High', 4, false, null),
		];
		const desc = sortRowsBy(rows, [{ property: URGENCY_COLUMN_ID, direction: 'DESC' }], null, 'rv-locator.distance');
		assert.deepEqual(desc.map((row) => row.name), ['High', 'Mike', 'Zulu', 'Beta', 'Alpha']);
		const asc = sortRowsBy(rows, [{ property: URGENCY_COLUMN_ID, direction: 'ASC' }], null, 'rv-locator.distance');
		assert.deepEqual(asc.map((row) => row.name), ['Mike', 'Zulu', 'High', 'Beta', 'Alpha']);
	});

	it('leaves other sorts, and urgency rows without a snooze flag, in their old order', () => {
		const rows = [
			placed('Alpha', 0, true, 5_000),
			placed('Mike', 0, false, null),
			placed('Zulu', 1, false, null),
		];
		const byName = sortRowsBy(rows, [{ property: 'file.name', direction: 'ASC' }], null, 'rv-locator.distance');
		assert.deepEqual(byName.map((row) => row.name), ['Alpha', 'Mike', 'Zulu']);
		const unflagged = rows.map((row) => ({ lat: row.lat, lon: row.lon, sortKeys: row.sortKeys, name: row.name }));
		const legacy = sortRowsBy(unflagged, [{ property: URGENCY_COLUMN_ID, direction: 'DESC' }], null, 'rv-locator.distance');
		assert.deepEqual(legacy.map((row) => row.name), ['Zulu', 'Alpha', 'Mike']);
	});

	it('keeps a snoozed card\'s displayed urgency at 0 and shares that order with the map', () => {
		const now = new Date('2026-11-08T12:00:00Z');
		const until = new Date('2026-11-20T12:00:00Z');
		const row: RowModel = {
			path: 'People/Alpha.md',
			name: 'Alpha',
			lat: null,
			lon: null,
			addressText: '',
			addressStreet: null,
			addressCity: null,
			status: 'Active',
			gender: null,
			cells: [
				{ id: 'note.Last Spoke', text: '', title: '', kind: 'text', numeric: false, daysSince: 0 },
				{ id: 'note.Priority', text: '5', title: '', kind: 'text', numeric: true },
			],
			sortKeys: {},
		};
		const settings = {
			urgencyThresholdDays: thresholds,
			idealityFloorDays: thresholds,
			territorySpanMiles: 10,
			homeLikelihoodEnabled: false,
		} as RVLocatorSettings;
		const scored = annotateRowScores(row, null, settings, null, now, until);
		assert.equal(scored.urgencySnoozed, true);
		assert.equal(scored.urgencySnoozeEnd, until.getTime());
		assert.deepEqual(scored.sortKeys[URGENCY_COLUMN_ID], { kind: 'number', value: 0 });
		assert.equal(displayedUrgency(0, 5, settings, until, now), 0);
		const facts = [
			{ name: 'Alpha', lat: 0, lon: 0, priority: 5, days: 0, attemptedDays: null, metDays: null, city: '', ideality: null, snoozed: true, snoozeEndMs: 5_000 },
			{ name: 'Mike', lat: 0, lon: 0, priority: 5, days: 0, attemptedDays: null, metDays: null, city: '', ideality: null },
			{ name: 'Zulu', lat: 0, lon: 0, priority: 5, days: 0, attemptedDays: null, metDays: null, city: '', ideality: null },
			{ name: 'Beta', lat: 0, lon: 0, priority: 5, days: 40, attemptedDays: null, metDays: null, city: '', ideality: null, snoozed: true, snoozeEndMs: 1_000 },
		];
		for (const direction of ['DESC', 'ASC'] as const) {
			const mapOrder = orderByHubSort(facts, { property: URGENCY_COLUMN_ID, direction }, null, thresholds).map((item) => item.name);
			const hubOrder = sortRowsBy(facts.map((item) => placed(
				item.name,
				item.snoozed ? 0 : urgencyScore(item.days, item.priority, thresholds),
				item.snoozed === true,
				item.snoozeEndMs ?? null,
			)), [{ property: URGENCY_COLUMN_ID, direction }], null, 'rv-locator.distance').map((item) => item.name);
			assert.deepEqual(mapOrder, hubOrder);
			assert.deepEqual(mapOrder, ['Mike', 'Zulu', 'Beta', 'Alpha']);
		}
	});

	it('uses that order for stack z-index and cluster color', () => {
		assert.ok(pinUrgencyZ(1, false, true, 1_000) > pinUrgencyZ(1, false, true, 9_000));
		assert.ok(pinUrgencyZ(1, false, true, 1_000) < pinUrgencyZ(0.2, false));
		assert.equal(pinUrgencyZ(1, true, true), 0);
		const soon = Date.UTC(2026, 10, 8);
		const later = Date.UTC(2026, 10, 22);
		const soonZ = pinUrgencyZ(1, false, true, soon);
		const laterZ = pinUrgencyZ(1, false, true, later);
		assert.notEqual(soonZ, laterZ);
		assert.ok(soonZ > laterZ);
		assert.ok(laterZ > pinUrgencyZ(1, false, true));
		assert.ok(soonZ < pinUrgencyZ(0.2, false));
		const [group] = groupPinStacks([
			{ path: 'later', x: 0, y: 0, urgency: 9, priority: 9, snoozed: true, snoozeEndMs: 9_000 },
			{ path: 'soon', x: 1, y: 0, urgency: 9, priority: 1, snoozed: true, snoozeEndMs: 1_000 },
			{ path: 'awake', x: 2, y: 0, urgency: 0.2, priority: 1 },
		]);
		assert.deepEqual(group?.map((member) => member.path), ['awake', 'soon', 'later']);
		const appearance = clusterAppearance([
			pin({ path: 'snoozed', color: '#64748b', urgency: 9, priority: 5, snoozed: true, snoozeEndMs: 1_000 }),
			pin({ path: 'awake', color: '#16a34a', urgency: 0.2, priority: 1 }),
		]);
		assert.equal(appearance.color, '#16a34a');
	});
});

describe('RV-B54 the map stays on screen', () => {
	it('keeps one map node in the shell across a hub, a note, and the hub again', () => {
		const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
		const host = globalThis as typeof globalThis & Record<string, unknown>;
		host.HTMLElement = dom.window.HTMLElement;
		host.Element = dom.window.Element;
		const doc = dom.window.document;
		const workspace = doc.createElement('div');
		doc.body.appendChild(workspace);
		const shell = createMapShell(workspace);
		const stage = doc.createElement('div');
		stage.className = 'rv-map-stage';
		shell.map.appendChild(stage);
		writeShellBand(shell.root, 752, 0.42);
		const leaf = doc.createElement('div');
		leaf.className = 'workspace-leaf';
		const content = doc.createElement('div');
		content.className = 'workspace-leaf-content';
		const view = doc.createElement('div');
		view.className = 'view-content';
		content.appendChild(view);
		leaf.appendChild(content);
		workspace.appendChild(leaf);
		for (const slotName of ['rv-locator-stage', 'markdown-preview-view', 'rv-locator-stage']) {
			view.replaceChildren();
			const slot = doc.createElement('div');
			slot.className = slotName;
			const spacer = ensureMapSpacer(slot);
			sizeMapSpacer(spacer, shellBandPx(shell.root), false);
			view.appendChild(slot);
			content.remove();
			view.replaceChildren();
			assert.equal(doc.querySelectorAll('.rv-map-stage').length, 1);
			assert.equal(doc.querySelector('.rv-map-stage'), stage);
			assert.equal(shell.grip.parentElement, shell.root);
			assert.equal(shell.root.parentElement, workspace);
			assert.equal(doc.querySelector('.rv-map-park'), null);
			leaf.appendChild(content);
		}
	});

	it('settles an open map onto the hub or the note, and clears it everywhere else', () => {
		const on = { hubMapOpen: true, noteMapOpen: false };
		assert.deepEqual(mapStayForOpen(on, 'note'), { hubMapOpen: false, noteMapOpen: true });
		assert.deepEqual(mapStayForOpen({ hubMapOpen: false, noteMapOpen: true }, 'hub'), { hubMapOpen: true, noteMapOpen: false });
		assert.deepEqual(mapStayForOpen(on, 'other'), { hubMapOpen: false, noteMapOpen: false });
		assert.deepEqual(mapStayForOpen({ hubMapOpen: false, noteMapOpen: false }, 'hub'), { hubMapOpen: false, noteMapOpen: false });
	});

	it('parks the hub map before the note opens and only then turns the hub flag off', () => {
		const main = source('src/main.ts');
		const keep = main.slice(main.indexOf('keepMapWithNote(path: string)'), main.indexOf('toggleCardEarth'));
		assert.ok(keep.indexOf('this.parkOpenMap()') < keep.indexOf('openFile'));
		assert.ok(keep.indexOf('this.syncNoteMap()') < keep.lastIndexOf('this.hubMapOpen = false'));
		assert.match(keep, /this\.noteMapOpen = true/);
		assert.match(keep, /this\.mapFocusPath = path/);
		assert.match(keep, /this\.focusMapPin\(path, true\)/);
		assert.match(keep, /this\.paintEarthStates\(\)/);
		const hook = main.slice(main.indexOf('proto.openFile = function'), main.indexOf('proto.setViewState = function'));
		assert.ok(hook.indexOf('retainMapForHub') < hook.indexOf('holdLeafForHubPaint'));
		const link = main.slice(main.indexOf('private openHubLink'), main.indexOf('private coversHubOpen'));
		assert.ok(link.indexOf('this.retainMapForHub()') < link.indexOf('holdLeafForHubPaint'));
		const opened = main.slice(main.indexOf('private onNoteOpened'), main.indexOf('private scheduleReadingDecorate'));
		const branch = opened.slice(opened.indexOf('this.noteMapOpen && file && file.path !== this.mapFocusPath'));
		assert.match(branch, /coversHubOpen\(file\)/);
		assert.match(branch, /this\.hubMapOpen = true/);
		assert.ok(branch.indexOf('this.hubMapOpen = false') < branch.indexOf('this.applyLayoutClasses()'));
		assert.doesNotMatch(source('src/glancable-view.ts'), /relayMap\(/);
		assert.doesNotMatch(main, /relayMap\(/);
		assert.match(main, /ensureMapShell\(/);
		assert.match(main, /handHubMapToLive/);
		assert.match(source('src/hub-cover.ts'), /beforeRelease\?\.\(\)/);
		const stop = source('src/hub-cover.ts');
		const release = stop.slice(stop.indexOf('const stop ='), stop.indexOf('const observer'));
		assert.ok(release.indexOf('handoffCoverLanding') < release.indexOf('beforeRelease'));
		assert.match(source('src/glancable-view.ts'), /rv-map-spacer/);
		const css = source('styles.css');
		assert.match(css, /\.rv-map-park > \.rv-hub-map,\s*\n\.rv-map-park > \.rv-note-map \{[^}]*display:\s*flex !important/);
	});

	it('hands the painted map to the shown hub and keeps that frame when the stage has no size yet', () => {
		const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
		const host = globalThis as typeof globalThis & Record<string, unknown>;
		host.HTMLElement = dom.window.HTMLElement;
		host.Element = dom.window.Element;
		const doc = dom.window.document;
		const hidden = doc.createElement('div');
		hidden.style.display = 'none';
		const hiddenStage = doc.createElement('div');
		hiddenStage.className = 'rv-locator-stage';
		const hiddenCard = doc.createElement('div');
		hiddenCard.className = 'rv-locator-card';
		hiddenStage.appendChild(hiddenCard);
		hidden.appendChild(hiddenStage);
		const live = doc.createElement('div');
		const liveStage = doc.createElement('div');
		liveStage.className = 'rv-locator-stage';
		const liveCard = doc.createElement('div');
		liveCard.className = 'rv-locator-card';
		const spacer = doc.createElement('div');
		spacer.className = 'rv-hub-map rv-map-spacer';
		liveStage.append(liveCard, spacer);
		live.appendChild(liveStage);
		const tiles = doc.createElement('div');
		tiles.className = 'rv-map-stage';
		const tile = doc.createElement('img');
		tile.className = 'rv-map-tile is-ready';
		tiles.appendChild(tile);
		doc.body.append(hidden, live);
		assert.equal(shownHubStage(doc), liveStage);
		const shell = createMapShell(doc.body);
		shell.map.appendChild(tiles);
		assert.equal(shell.map.parentElement, shell.root);
		assert.equal(spacer.isConnected, true);
		assert.equal(shell.map.querySelector('.rv-map-tile.is-ready'), tile);
		assert.equal(liveStage.contains(tile), false);
		assert.equal(stagePaintBox(0, 0, true), null);
		assert.deepEqual(stagePaintBox(0, 0, false), { width: 640, height: 480 });
		assert.deepEqual(stagePaintBox(392, 237, true), { width: 392, height: 237 });
	});

	it('carries an open map through the Quick Switcher onto an RV note and clears it for any other file', () => {
		const main = source('src/main.ts');
		const hook = main.slice(main.indexOf('proto.openFile = function'), main.indexOf('proto.setViewState = function'));
		assert.match(hook, /carryMapToOpenedFile\(file\)/);
		const carry = main.slice(main.indexOf('carryMapToOpenedFile(file: TFile)'), main.indexOf('private settleNoteMap'));
		assert.match(carry, /isRvDashboardNote/);
		assert.match(carry, /this\.parkOpenMap\(\)/);
		assert.match(carry, /this\.settleNoteMap\(file\.path, 0\)/);
		assert.match(carry, /this\.hubMapOpen = false/);
		assert.match(carry, /this\.noteMapOpen = false/);
		assert.match(carry, /this\.applyLayoutClasses\(\)/);
		assert.match(carry, /this\.syncNoteMap\(\)/);
		assert.match(source('src/glancable-view.ts'), /hostIsHidden\(this\.root\)/);
		assert.match(source('src/map-view.ts'), /stagePaintBox\(stage\.clientWidth, stage\.clientHeight/);
	});

	it('locks the handed map to the cover height before the cover leaves', () => {
		const dom = new JSDOM('<!doctype html><body class="is-phone theme-dark"></body>');
		const doc = dom.window.document;
		globalThis.HTMLElement = dom.window.HTMLElement;
		globalThis.Element = dom.window.Element;
		const live = doc.createElement('div');
		live.className = 'rv-locator-view is-stacked';
		const liveStage = doc.createElement('div');
		liveStage.className = 'rv-locator-stage';
		live.appendChild(liveStage);
		doc.body.appendChild(live);
		const shell = createMapShell(doc.body);
		const stage = doc.createElement('div');
		stage.className = 'rv-map-stage';
		stage.appendChild(Object.assign(doc.createElement('img'), { className: 'rv-map-tile is-ready' }));
		shell.map.appendChild(stage);
		writeShellBand(shell.root, 752, 0.42);
		const spacer = ensureMapSpacer(liveStage);
		sizeMapSpacer(spacer, shellBandPx(shell.root), false);
		liveStage.getBoundingClientRect = () => ({ height: 797, width: 390, top: 0, left: 0, bottom: 797, right: 390, x: 0, y: 0, toJSON() { return {}; } });
		assert.equal(writeShellBand(shell.root, 797, 1), 316);
		assert.equal(shell.root.style.getPropertyValue('--rv-map-size'), '316px');
		assert.equal(shell.root.style.getPropertyValue('--rv-note-map'), '316px');
		assert.equal(shell.map.parentElement, shell.root);
		assert.equal(spacer.isConnected, true);
		assert.equal(liveStage.contains(stage), false);
		assert.equal(doc.querySelectorAll('.rv-map-stage').length, 1);
		const main = source('src/main.ts');
		const hand = main.slice(main.indexOf('private handHubMapToLive'), main.indexOf('private noteDirectHubOpen'));
		assert.doesNotMatch(hand, /relayMap\(/);
		assert.match(hand, /invalidateSize\(\)/);
		assert.doesNotMatch(source('src/main.ts'), /holdMapHeight\(/);
		assert.doesNotMatch(source('src/glancable-view.ts'), /holdMapHeight\(/);
		const hook = main.slice(main.indexOf('proto.openFile = function'), main.indexOf('proto.setViewState = function'));
		assert.match(hook, /noteDirectHubOpen\(\)/);
		assert.match(hook, /pinDirectHubScroll\(\)/);
		const link = main.slice(main.indexOf('private openHubLink'), main.indexOf('private openHubLink') + 900);
		assert.match(link, /this\.hubLinkOpen = true/);
		assert.match(source('src/glancable-view.ts'), /hubOpensAtTop\(\)/);
	});

	it('RV-B55 repaints a mounted hub card from 1 day to 7 to 14 and back to 1', () => {
		const row: RowModel = {
			path: 'People/Ada.md',
			name: 'Ada',
			lat: null,
			lon: null,
			addressText: '',
			addressStreet: null,
			addressCity: null,
			status: 'Active',
			gender: null,
			cells: [],
			sortKeys: {},
		};
		const until = String(Date.UTC(2026, 10, 20));
		const keyFor = (days: number | null, end = until): string => cardPaintKey(row, {
			snoozed: days != null && days > 0,
			snoozeUntil: days != null && days > 0 ? end : '',
			snoozeDays: days,
		});
		const one = keyFor(1);
		const week = keyFor(7);
		const twoWeeks = keyFor(14);
		const again = keyFor(1);
		const cleared = keyFor(0);
		assert.notEqual(one, week);
		assert.notEqual(week, twoWeeks);
		assert.equal(again, one);
		assert.notEqual(cleared, one);
		assert.notEqual(keyFor(7, until), keyFor(6, until));
		const dom = new JSDOM('<!doctype html><body><article class="rv-locator-card" data-rv-paint=""><span class="rv-foot-days">1d</span></article></body>');
		const card = dom.window.document.querySelector('.rv-locator-card');
		const foot = dom.window.document.querySelector('.rv-foot-days');
		assert.ok(card instanceof dom.window.HTMLElement);
		assert.ok(foot instanceof dom.window.HTMLElement);
		card.setAttribute('data-rv-paint', one);
		const repaint = (days: number | null): void => {
			const next = keyFor(days);
			if (card.getAttribute('data-rv-paint') === next) return;
			card.setAttribute('data-rv-paint', next);
			foot.textContent = days != null && days > 0 ? `${days}d` : '';
		};
		for (const days of [7, 14, 1]) {
			assert.notEqual(card.getAttribute('data-rv-paint'), days === 1 ? week : keyFor(days));
			repaint(days);
			assert.equal(foot.textContent, `${days}d`);
			assert.equal(card.getAttribute('data-rv-paint'), keyFor(days));
		}
		repaint(1);
		assert.equal(foot.textContent, '1d');
		repaint(null);
		assert.equal(foot.textContent, '');
		assert.equal(card.getAttribute('data-rv-paint'), keyFor(null));
		const glance = source('src/glancable-view.ts');
		const signature = glance.slice(glance.indexOf('private paintSignature'), glance.indexOf('private paintSignature') + 700);
		assert.match(signature, /snoozeUntil: until \? String\(until\.getTime\(\)\) : ''/);
		assert.match(signature, /snoozeDays: snoozed \? this\.plugin\.snoozeDaysLeftFor\(row\.path\) : 0/);
		assert.match(source('src/main.ts'), /scheduleSnoozeDayRoll/);
		assert.match(source('src/hub-cache.ts'), /extra\.snoozeDays != null \? String\(extra\.snoozeDays\) : ''/);
		const noon = new Date(2026, 10, 8, 12, 0, 0, 0);
		const delay = delayUntilNextLocalDay(noon, 2000);
		assert.ok(delay > 11 * 60 * 60 * 1000 && delay < 13 * 60 * 60 * 1000);
		assert.ok(delayUntilNextLocalDay(new Date(2026, 10, 8, 23, 59, 59, 0), 2000) >= 1000);
	});

	it('drops the note grid on the way back to the hub and lands a parked map in the hub slot', () => {
		const main = source('src/main.ts');
		const retain = main.slice(main.indexOf('private retainMapForHub'), main.indexOf('parkOpenMap(): boolean'));
		assert.match(retain, /this\.noteMapOpen = false/);
		assert.ok(retain.indexOf('this.noteMapOpen = false') < retain.indexOf('this.syncNoteMap()'));
		const historyAt = main.indexOf('proto.setViewState = function');
		const history = main.slice(historyAt, main.indexOf('this.register(() => {', historyAt));
		assert.match(history, /landHistoryHubMap\(this\)/);
		const opened = main.slice(main.indexOf('private onNoteOpened'), main.indexOf('private scheduleReadingDecorate'));
		assert.match(opened, /this\.settleParkedHubMap\(0\)/);
		const hand = main.slice(main.indexOf('private handHubMapToLive'), main.indexOf('private landHistoryHubMap'));
		assert.match(hand, /invalidateSize\(\)/);
		assert.match(source('src/glancable-view.ts'), /ensureMapSpacer/);
		const dom = new JSDOM('<!doctype html><body></body>');
		const doc = dom.window.document;
		globalThis.HTMLElement = dom.window.HTMLElement;
		globalThis.Element = dom.window.Element;
		const shell = createMapShell(doc.body);
		const tiles = doc.createElement('div');
		tiles.className = 'rv-map-stage';
		tiles.appendChild(Object.assign(doc.createElement('img'), { className: 'rv-map-tile is-ready' }));
		shell.map.appendChild(tiles);
		const stage = doc.createElement('div');
		stage.className = 'rv-locator-stage';
		const content = doc.createElement('div');
		content.className = 'workspace-leaf-content view-content';
		content.appendChild(stage);
		doc.body.appendChild(content);
		ensureMapSpacer(stage);
		content.remove();
		stage.replaceChildren();
		assert.equal(doc.querySelectorAll('.rv-map-stage').length, 1);
		assert.equal(doc.querySelector('.rv-map-stage'), tiles);
		assert.equal(shell.grip.parentElement, shell.root);
		assert.equal(shell.grip.className, 'rv-hub-map-handle');
		assert.equal(shell.grip.nextElementSibling, shell.map);
		assert.equal(doc.querySelector('.rv-map-park'), null);
		assert.equal(stage.querySelector('.rv-map-tile.is-ready'), null);
		assert.equal(shell.map.querySelector('.rv-map-tile.is-ready') != null, true);
	});

	it('RV-B56 restrokes urgency, priority, and the study ring after a fragment stored 2px', () => {
		clearBadgeStrokeCache();
		const dom = new JSDOM('<!doctype html><body></body>');
		const win = dom.window;
		globalThis.HTMLElement = win.HTMLElement;
		globalThis.Element = win.Element;
		const real = win.getComputedStyle.bind(win);
		win.getComputedStyle = ((elt: Element) => {
			const style = real(elt);
			if (elt instanceof win.HTMLElement && elt.style.visibility === 'hidden' && (elt.style.borderTopWidth === '2px' || elt.style.borderWidth === '2px')) {
				return { borderTopWidth: '1.02px' } as CSSStyleDeclaration;
			}
			return style;
		}) as typeof win.getComputedStyle;
		const frag = win.document.createElement('div');
		const urgency = win.document.createElement('button');
		urgency.className = 'rv-locator-urgency';
		const ring = win.document.createElementNS('http://www.w3.org/2000/svg', 'circle');
		ring.setAttribute('class', 'is-ring');
		urgency.appendChild(ring);
		frag.appendChild(urgency);
		const pill = win.document.createElement('button');
		pill.className = 'rv-locator-priority-pill';
		frag.appendChild(pill);
		try {
			pinBadgeStroke(urgency);
			pinBadgeStroke(pill);
			assert.equal(urgency.dataset.rvStrokePx, undefined);
			assert.equal(pill.dataset.rvStrokePx, undefined);
			assert.equal(urgency.style.getPropertyValue('border-width'), '');
			win.document.body.append(urgency, pill);
			urgency.dataset.rvStrokePx = '2px';
			urgency.style.setProperty('border-width', '2px', 'important');
			urgency.style.setProperty('border-style', 'solid', 'important');
			pill.dataset.rvStrokePx = '2px';
			pill.style.setProperty('border-width', '2px', 'important');
			pill.style.setProperty('border-style', 'solid', 'important');
			pinBadgeRings(win.document.body);
			assert.notEqual(urgency.dataset.rvStrokePx, '2px');
			assert.equal(urgency.style.getPropertyValue('border-width'), urgency.dataset.rvStrokePx);
			assert.equal(ring.style.getPropertyValue('stroke-width'), urgency.dataset.rvStrokePx);
			assert.equal(pill.style.getPropertyValue('border-width'), urgency.dataset.rvStrokePx);
			const chrome = source('src/note-chrome.ts');
			const details = chrome.slice(chrome.indexOf('function paintUrgencyDetails'), chrome.indexOf('function setPaint'));
			assert.match(details, /\.rv-locator-priority-pill/);
			assert.match(details, /pinBadgeStroke\(node\)/);
			assert.match(source('src/map-view.ts'), /pinBadgeRings\(shell\)/);
		} finally {
			win.getComputedStyle = real;
			clearBadgeStrokeCache();
		}
	});
});
