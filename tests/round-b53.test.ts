import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { URGENCY_COLUMN_ID } from '../src/constants';
import { clusterAppearance, groupPinStacks, orderByHubSort, pinUrgencyZ, type MapPin } from '../src/map-pins';
import { claimParkedMap, mapStayForOpen, moveMapToStage, parkMapNode } from '../src/map-handoff';
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
	it('keeps one map node connected across a hub, a park, a note, and the hub again', () => {
		const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
		const host = globalThis as typeof globalThis & Record<string, unknown>;
		host.HTMLElement = dom.window.HTMLElement;
		host.Element = dom.window.Element;
		const doc = dom.window.document;
		const map = doc.createElement('div');
		map.className = 'rv-hub-map';
		doc.body.appendChild(map);
		const holder = parkMapNode(map);
		assert.equal(map.isConnected, true);
		assert.equal(map.parentElement, holder);
		const note = doc.createElement('div');
		doc.body.appendChild(note);
		const claimed = claimParkedMap(doc, 'rv-note-map');
		assert.equal(claimed, map);
		assert.equal(map.isConnected, true);
		assert.notEqual(map.parentElement, null);
		note.appendChild(map);
		assert.equal(map.isConnected, true);
		const cover = doc.createElement('div');
		cover.className = 'rv-hub-swap-cover';
		doc.body.appendChild(cover);
		moveMapToStage(map, cover, 'rv-hub-map');
		assert.equal(map.isConnected, true);
		assert.equal(map.parentElement, cover);
		const stage = doc.createElement('div');
		stage.className = 'rv-locator-stage';
		doc.body.appendChild(stage);
		moveMapToStage(map, stage, 'rv-hub-map');
		assert.equal(map.isConnected, true);
		assert.equal(map.parentElement, stage);
		assert.equal(map.parentElement === null, false);
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
		assert.match(source('src/glancable-view.ts'), /claimParkedMap\?\.\('rv-hub-map'\)/);
		assert.match(main, /claimParkedMap\('rv-note-map'\)/);
		assert.match(main, /handHubMapToLive/);
		assert.match(source('src/hub-cover.ts'), /beforeRelease\?\.\(\)/);
		const stop = source('src/hub-cover.ts');
		const release = stop.slice(stop.indexOf('const stop ='), stop.indexOf('const observer'));
		assert.ok(release.indexOf('handoffCoverLanding') < release.indexOf('beforeRelease'));
		assert.match(source('src/glancable-view.ts'), /rv-map-spacer/);
		const css = source('styles.css');
		assert.match(css, /\.rv-map-park > \.rv-hub-map,\s*\n\.rv-map-park > \.rv-note-map \{[^}]*display:\s*flex !important/);
	});
});
