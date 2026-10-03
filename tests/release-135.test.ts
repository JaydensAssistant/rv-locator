import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { campaignIsActive, isCovered, sanitizeCampaign, withCovered } from '../src/campaign';
import { hubRefs, moveHubLeft } from '../src/hub-row';
import { currentReturnBucket, defaultAvailabilityGrid } from '../src/schedule';
import { resetSettingsTab } from '../src/settings-reset';
import { formatSlotOverride, parseSlotOverrides, upsertSlotOverride } from '../src/slot-override';
import { layoutTakenNames } from '../src/taken-row';
import { DEFAULT_SETTINGS, attemptLogFullWidth, mergeSettings } from '../src/types';
import { partitionVisits, type VisitStampRef } from '../src/visit-display';

describe('1.3.5 hub row', () => {
	it('keeps every hub and moves one left without rewriting the first', () => {
		const hubs = hubRefs(['[[North]]', '[[East|East hub]]', 'South']);
		assert.deepEqual(hubs.map((hub) => hub.label), ['North', 'East hub', 'South']);
		assert.equal(moveHubLeft(hubs.map((hub) => `[[${hub.target}]]`), 'North'), null);
		const moved = moveHubLeft(['[[North]]', '[[East]]', '[[South]]'], 'South');
		assert.deepEqual(moved, ['[[North]]', '[[South]]', '[[East]]']);
	});
});

describe('1.3.5 taken row', () => {
	it('pins Met With and the latest Taken name', () => {
		const layout = layoutTakenNames(['Ada', 'Bo', 'Cy'], 'Ada');
		assert.equal(layout.met, 'Ada');
		assert.deepEqual(layout.scroll, ['Bo']);
		assert.equal(layout.recent, 'Cy');
		const same = layoutTakenNames(['Ada'], 'Ada');
		assert.equal(same.met, 'Ada');
		assert.equal(same.recent, null);
		assert.deepEqual(same.scroll, []);
	});
});

describe('1.3.5 campaign', () => {
	it('is active only inside its dates and records one path once', () => {
		const saved = sanitizeCampaign({ name: 'Spring', start: '2026-10-01', end: '2026-10-03', covered: ['a.md', 'a.md'] });
		assert.equal(campaignIsActive(saved, '2026-10-02'), true);
		assert.equal(campaignIsActive(saved, '2026-10-04'), false);
		assert.equal(campaignIsActive(saved, '2026-09-30'), false);
		const covered = withCovered(saved!, 'b.md');
		assert.equal(isCovered(covered, 'a.md'), true);
		assert.equal(isCovered(covered, 'b.md'), true);
		assert.equal(withCovered(covered, 'b.md'), covered);
	});
});

describe('1.3.5 slot override', () => {
	it('parses a daypart mark and lets it win the current bucket', () => {
		const parsed = parseSlotOverrides(['Tue evening: Avoid', 'nope', 'Monday mor: Try']);
		assert.deepEqual(parsed, [
			{ weekday: 2, daypart: 'evening', bucket: 'avoid' },
			{ weekday: 1, daypart: 'morning', bucket: 'try' },
		]);
		assert.equal(formatSlotOverride(parsed[0]!), 'Tue evening: Avoid');
		const grid = defaultAvailabilityGrid();
		grid['2:evening'] = 'may';
		const bucket = currentReturnBucket({
			buckets: { '2:evening': { homes: 2, trials: 2 } },
			grid,
			overrides: parsed,
			now: new Date(2026, 9, 6, 18, 0, 0),
		});
		assert.equal(bucket, 'Avoid');
		assert.equal(upsertSlotOverride(parsed, { weekday: 2, daypart: 'evening', bucket: 'try' }).at(-1)?.bucket, 'try');
	});
});

describe('1.3.5 visit display order', () => {
	it('shows the newest visits and parks the rest without changing file order', () => {
		const stamps: VisitStampRef[] = [
			{ text: 'first', when: 1, fileIndex: 0 },
			{ text: 'second', when: 2, fileIndex: 1 },
			{ text: 'third', when: 3, fileIndex: 2 },
			{ text: 'fourth', when: 4, fileIndex: 3 },
		];
		const newest = partitionVisits(stamps, true, true, 3);
		assert.deepEqual(newest.visible.map((item) => item.text), ['fourth', 'third', 'second']);
		assert.deepEqual(newest.older.map((item) => item.text), ['first']);
		const oldest = partitionVisits(stamps, false, false, 3);
		assert.deepEqual(oldest.visible.map((item) => item.text), ['first', 'second', 'third', 'fourth']);
		assert.deepEqual(oldest.older, []);
	});
});

describe('1.3.5 settings reset', () => {
	it('resets one tab and leaves the API key and the other tabs', () => {
		const current = mergeSettings({
			geoapifyApiKey: 'secret',
			geoapifyRegion: 'eu',
			wideQuickFacts: false,
			urgencyPalette: 'pink',
			distanceUnit: 'kilometers',
			newRvTemplateFile: 'Custom.md',
		});
		const everyday = resetSettingsTab(current, 'everyday');
		assert.equal(everyday.geoapifyApiKey, 'secret');
		assert.equal(everyday.geoapifyRegion, 'global');
		assert.equal(everyday.wideQuickFacts, true);
		assert.equal(everyday.urgencyPalette, 'pink');
		assert.equal(everyday.distanceUnit, 'kilometers');
		const urgency = resetSettingsTab(current, 'urgency');
		assert.equal(urgency.urgencyPalette, DEFAULT_SETTINGS.urgencyPalette);
		assert.equal(urgency.geoapifyRegion, 'eu');
		assert.equal(urgency.distanceUnit, 'kilometers');
		const nearby = resetSettingsTab(current, 'nearby');
		assert.equal(nearby.distanceUnit, 'miles');
		assert.equal(nearby.newRvTemplateFile, 'Custom.md');
		assert.equal(attemptLogFullWidth(mergeSettings({ attemptLogWidth: 'auto', digestOrientation: 'rows' })), true);
	});
});
