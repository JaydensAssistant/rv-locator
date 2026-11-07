import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { buildAutocompleteUrl, readCountyPlaceId } from '../src/address';
import { countyFilterParam, hitInHomeCounties, homeCountyHits, mergeHomeFirst, placeFilterParam } from '../src/home-base';
import { sliderToSnoozeDays, snoozeDaysToSlider } from '../src/lesson-stops';
import { formatSnoozeUntil, snoozeDaysLeft, snoozePreview, snoozeUntilFromDays } from '../src/snooze';
import { filtersDifferFromDefault, nextSnoozeListFilter } from '../src/status';
import { clockFace, hour24FromFace } from '../src/visit-editor';

describe('next build helpers', () => {
	it('keeps a 12-hour face and a 24-hour visit clock', () => {
		assert.deepEqual(clockFace(0), { hour12: 12, meridiem: 'AM' });
		assert.deepEqual(clockFace(15), { hour12: 3, meridiem: 'PM' });
		assert.equal(hour24FromFace(12, 'AM'), 0);
		assert.equal(hour24FromFace(3, 'PM'), 15);
		assert.equal(hour24FromFace(12, 'PM'), 12);
	});

	it('previews a custom snooze and counts days left', () => {
		const now = new Date(2026, 9, 12, 8, 0, 0);
		const until = snoozeUntilFromDays(30, now);
		assert.equal(snoozeDaysLeft(until, now), 30);
		assert.match(snoozePreview(30, now), /Until .+ · 30 days/);
		assert.equal(formatSnoozeUntil('7', now).endsWith('T08:00:00') || formatSnoozeUntil('7', now).includes('T'), true);
	});

	it('makes the high end of the snooze slider easier', () => {
		assert.equal(sliderToSnoozeDays(0), 1);
		assert.equal(sliderToSnoozeDays(100), 90);
		assert.ok(sliderToSnoozeDays(50) < 45);
		assert.equal(sliderToSnoozeDays(snoozeDaysToSlider(14)), 14);
	});

	it('merges a county-bounded search ahead of the home-sorted search', () => {
		const bounded = [{ formattedAddress: '1 Home St', lat: 1, lon: 2, county: 'Orange' }];
		const sorted = [
			{ formattedAddress: '1 Home St', lat: 1, lon: 2, county: 'Orange' },
			{ formattedAddress: '9 Far St', lat: 3, lon: 4, county: 'Lake' },
		];
		const merged = mergeHomeFirst(bounded, sorted);
		assert.equal(merged.length, 2);
		assert.equal(merged[0]?.formattedAddress, '1 Home St');
		assert.equal(hitInHomeCounties(bounded[0]!, ['Orange County']), true);
		assert.equal(countyFilterParam(['Orange', 'Lake']), 'Orange|Lake');
		const place = placeFilterParam(['citrus-id', 'marion-id']);
		assert.equal(place, 'place:citrus-id|place:marion-id');
		const url = buildAutocompleteUrl('oak', 'key', 'global', { placeFilter: place, bias: { lat: 28.8, lon: -82.3 } });
		assert.match(url, /limit=10/);
		assert.match(url, /filter=place%3Acitrus-id%7Cplace%3Amarion-id|filter=place:citrus-id\|place:marion-id/);
		assert.equal(url.includes('filter=county'), false);
		assert.equal(url.includes('circle:'), false);
		const ignored = buildAutocompleteUrl('oak', 'key', 'global', { countyFilter: 'Orange|Lake' });
		assert.equal(ignored.includes('county'), false);
		const id = readCountyPlaceId({
			results: [
				{ place_id: 'other', county: 'Lake County' },
				{ place_id: 'citrus-id', county: 'Citrus County', formatted: 'Citrus County, Florida' },
			],
		}, 'Citrus');
		assert.equal(id, 'citrus-id');
		const planned = homeCountyHits(
			[{ formattedAddress: '10 Vault Rd', lat: 1, lon: 2, county: 'Citrus' }],
			[
				{ formattedAddress: '20 Home St', lat: 3, lon: 4, county: 'Marion County' },
				{ formattedAddress: '30 Away St', lat: 5, lon: 6, county: 'Lake' },
			],
			['Citrus County, FL', 'Marion County, FL'],
		);
		assert.deepEqual(planned.hits.map((hit) => hit.formattedAddress), ['10 Vault Rd', '20 Home St']);
		assert.deepEqual(planned.near, ['10 vault rd', '20 home st']);
	});

	it('treats snooze as a real list filter and highlights when it is on', () => {
		assert.equal(filtersDifferFromDefault('active', 'all', 'all'), false);
		assert.equal(filtersDifferFromDefault('active', 'all', 'all', 'snoozed'), true);
		assert.equal(nextSnoozeListFilter('all'), 'snoozed');
		assert.equal(nextSnoozeListFilter('awake'), 'all');
	});

	it('ships the dashboard, ribbon, toast, and reading rules', () => {
		const css = readFileSync('styles.css', 'utf8');
		const main = readFileSync('src/main.ts', 'utf8');
		assert.match(css, /font-size:\s*20\.4px/);
		assert.match(css, /\.hide-props \.metadata-container/);
		assert.match(css, /#6b7a99/);
		assert.match(css, /\.rv-nh-toast \{[^}]*background:\s*transparent/);
		assert.match(css, /\.is-search-open \.rv-locator-toolbar-actions/);
		assert.match(css, /\.rv-locator-sort-pills \{[^}]*flex-wrap:\s*nowrap/);
		assert.match(main, /cardPersonTitle\(file\?\.basename \?\? path, true\)/);
		assert.match(main, /allowBroad: false/);
		assert.match(main, /syncNoteMap/);
		assert.match(main, /is-note-map/);
		assert.match(main, /mountHubMap/);
		assert.doesNotMatch(main, /getLeaf\('split'/);
		assert.doesNotMatch(main, /type: GLANCABLE_VIEW_TYPE/);
		assert.match(readFileSync('src/glancable-view.ts', 'utf8'), /searchReplacesBar/);
		assert.match(readFileSync('src/visit-controls.ts', 'utf8'), /\.rv-stamp-when/);
	});
});
