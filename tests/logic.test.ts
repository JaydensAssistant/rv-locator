import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACTIVE_SORT, NEARBY_COLUMN_ORDER, SORT_PRESETS, hubListIncludesActive, matchesActiveRvFilter, matchesNearbyScope, parsePriority, preferredSortDirection, resolveNearbyOrder, shouldUseActiveSort, visiblePropertyText } from '../src/active-layout';
import { buildGeocodeUrl, formatSpecificAddress, googleMapsAddressLink, normalizeAddress, parseGeocodeBody } from '../src/address';
import { displayCity, parseDisplayAddress } from '../src/address-display';
import { DISTANCE_COLUMN_ID, GEOCODE_ENDPOINT, GEOAPIFY_ATTRIBUTION, OSM_ATTRIBUTION, PRIVACY_NOTICE } from '../src/constants';
import { getCached, rememberResults, trimCache } from '../src/cache';
import { coordString, formatDistance, haversineMeters, latLonFromUnknown } from '../src/distance';
import { calendarDaysSince, dateCellDisplay, dateCellText, formatDriveDate, formatGlancableStampFromRaw, formatGlancableVisitStamp, formatWeekdayDate, isWeekdayProperty, parseDatePropertyNames, parseFlexibleDate, showsElapsedDays } from '../src/dates';
import { applyGeocodeHit, ensureQuotedLocationList, fillCity, fillSuccessfulVisits, locationPair, planGeocodeWork, readAddress } from '../src/frontmatter';
import { decideGeocodePick, isFullConfidence } from '../src/home-base';
import { schedulePickerDismiss } from '../src/picker-gate';
import { applyVisitBody, applyVisitFrontmatter, formatFrontmatterDateTime, formatVisitStamp } from '../src/visit-log';
import { geocodeAddress, GeocodeRequestError } from '../src/geocode-client';
import { RequestPacer } from '../src/pacer';
import { redactSecrets } from '../src/redact';
import { compareNullableNumber, cycleSort, sortRows, sortRowsBy } from '../src/sort';
import { rvNoteTitle, streetShortName } from '../src/note-name';
import { DEFAULT_SETTINGS, mergeSettings, sanitizeNearbySort, type GeocodeHit, type RVLocatorSettings } from '../src/types';

const tacoma = {
	housenumber: '1313',
	street: 'Broadway',
	city: 'Tacoma',
	county: 'Pierce County',
	state: 'Washington',
	postcode: '98402',
	country: 'United States of America',
	formatted: '1313 Broadway, Tacoma, WA 98402, United States of America',
};

describe('geocode request', () => {
	it('uses the documented EU endpoint and sends only the address string', () => {
		const url = new URL(buildGeocodeUrl('  7790 N Voyager Dr, Citrus Heights  ', 'secret-key'));
		assert.equal(url.origin + url.pathname, GEOCODE_ENDPOINT);
		assert.equal(url.host, 'api-eu.geoapify.com');
		assert.deepEqual([...url.searchParams.keys()].sort(), ['apiKey', 'format', 'limit', 'text']);
		assert.equal(url.searchParams.get('text'), '7790 N Voyager Dr, Citrus Heights');
		assert.equal(url.searchParams.get('format'), 'json');
		assert.equal(url.searchParams.get('limit'), '5');
		assert.equal(GEOCODE_ENDPOINT.includes('nominatim'), false);
		assert.equal(GEOCODE_ENDPOINT.includes('googleapis'), false);
		assert.equal(url.searchParams.get('text')?.includes('Alana'), false);
	});

	it('formats the most specific address from returned parts', () => {
		assert.equal(formatSpecificAddress(tacoma), tacoma.formatted);
		assert.equal(
			formatSpecificAddress({ city: 'Citrus Heights', state: 'California', formatted: 'Citrus Heights, CA' }),
			'Citrus Heights, CA',
		);
		assert.equal(
			formatSpecificAddress({
				housenumber: '7790',
				street: 'N Voyager Dr',
				city: 'Citrus Heights',
				county: 'Sacramento County',
				postcode: '95610',
				formatted: 'Citrus Heights, CA',
			}),
			'7790 N Voyager Dr, Citrus Heights, Sacramento County, 95610',
		);
	});

	it('parses a Geoapify JSON body without keeping the api key', () => {
		const hits = parseGeocodeBody({
			results: [
				{
					...tacoma,
					lat: 47.2509449,
					lon: -122.439413,
					address_line1: '1313 Broadway',
					result_type: 'building',
					rank: { confidence: 1 },
					datasource: { sourcename: 'openstreetmap', attribution: '© OpenStreetMap contributors' },
				},
				{ lat: 99, lon: 0 },
			],
		});
		assert.equal(hits.length, 1);
		assert.equal(hits[0]?.formattedAddress.includes('1313 Broadway'), true);
		assert.equal(hits[0]?.city, 'Tacoma');
		assert.equal(hits[0]?.confidence, 1);
		assert.equal(JSON.stringify(hits).includes('secret'), false);
		const textual = parseGeocodeBody({
			results: [{ ...tacoma, lat: 47.25, lon: -122.44, formatted: tacoma.formatted, rank: { confidence: '1.00', confidence_street_level: 0 } }],
		});
		assert.equal(textual[0]?.confidence, 1);
		const streetOnly = parseGeocodeBody({
			results: [{ ...tacoma, lat: 47.25, lon: -122.44, formatted: tacoma.formatted, rank: { confidence_street_level: 1 } }],
		});
		assert.equal(streetOnly[0]?.confidence, undefined);
		assert.equal(isFullConfidence(undefined), false);
		assert.equal(isFullConfidence(1), true);
		assert.equal(isFullConfidence(1.0), true);
		assert.equal(isFullConfidence(0.99), false);
	});

	it('builds a Google Maps search link from the address text', () => {
		assert.equal(
			googleMapsAddressLink('142 Maple Street, Orlando, FL'),
			'https://www.google.com/maps/search/?api=1&query=142%20Maple%20Street%2C%20Orlando%2C%20FL',
		);
		assert.equal(
			googleMapsAddressLink('142 Maple\nStreet,  Orlando'),
			'https://www.google.com/maps/search/?api=1&query=142%20Maple%20Street%2C%20Orlando',
		);
		assert.equal(googleMapsAddressLink('  1313 broadway  '), googleMapsAddressLink('1313 broadway'));
		assert.equal(googleMapsAddressLink('1313 broadway').includes('47.25'), false);
		assert.equal(googleMapsAddressLink('1313 broadway').includes('maps?q='), false);
	});
});

describe('privacy', () => {
	it('redacts the api key from errors', () => {
		const key = 'super-secret-key';
		const message = redactSecrets(
			`failed https://api-eu.geoapify.com/v1/geocode/search?text=Main&apiKey=${key}`,
			key,
		);
		assert.equal(message.includes(key), false);
		assert.equal(message.includes('apiKey=[redacted]'), true);
	});

	it('writes coordinates without copying names, phones, or the note body', () => {
		const frontmatter: Record<string, unknown> = {
			Address: '1313 broadway',
			Name: 'Travis',
			Phone: '555-0100',
			Notes: 'Talked on the porch for twenty minutes.',
		};
		const hit: GeocodeHit = {
			lat: 47.250944967,
			lon: -122.439413029,
			formattedAddress: formatSpecificAddress(tacoma),
			city: 'Tacoma',
			county: 'Pierce County',
			state: 'Washington',
			postcode: '98402',
			country: 'United States of America',
		};
		const settings: RVLocatorSettings = {
			...DEFAULT_SETTINGS,
			cityProperty: 'City',
			countyProperty: '',
		};
		applyGeocodeHit(frontmatter, hit, settings);
		assert.equal(frontmatter.Name, 'Travis');
		assert.equal(frontmatter.Phone, '555-0100');
		assert.equal(frontmatter.Notes, 'Talked on the porch for twenty minutes.');
		assert.equal(frontmatter.Address, '1313 broadway');
		const location = frontmatter.Location;
		const pair = locationPair(hit);
		assert.ok(Array.isArray(location));
		assert.equal(location.length, 2);
		assert.equal(typeof location[0], 'string');
		assert.equal(typeof location[1], 'string');
		assert.deepEqual(location, pair);
		assert.deepEqual(latLonFromUnknown(location), { lat: Number(pair[0]), lon: Number(pair[1]) });
		assert.equal(frontmatter['Map Link'], googleMapsAddressLink('1313 broadway'));
		assert.equal(String(frontmatter['Map Link']).includes(String(pair[0])), false);
		assert.equal(String(frontmatter['Map Link']).includes(String(pair[1])), false);
		assert.equal(frontmatter.City, 'Tacoma');
		assert.equal('County' in frontmatter, false);
		assert.equal('Distance' in frontmatter, false);
	});

	it('plans bulk work from the address property only', () => {
		const settings = DEFAULT_SETTINGS;
		const work = planGeocodeWork([
			{ path: 'a.md', frontmatter: { Address: '10 Main St', Name: 'Ada', Phone: '555' } },
			{ path: 'b.md', frontmatter: { Address: '11 Main St', Location: [1, 2] } },
			{ path: 'c.md', frontmatter: { Name: 'No address here' } },
			{ path: 'd.md', frontmatter: { Address: '   ' } },
		], settings, false);
		assert.deepEqual(work, [{ path: 'a.md', address: '10 Main St' }]);
		const forced = planGeocodeWork([
			{ path: 'b.md', frontmatter: { Address: '11 Main St', Location: [1, 2] } },
		], settings, true);
		assert.equal(forced.length, 1);
		assert.equal(readAddress({ Address: '10 Main' }, 'address'), '10 Main');
	});

	it('writes Location as two quoted-string coordinates and reads them back', () => {
		assert.equal(coordString(29.0313846), '29.0313846');
		assert.equal(coordString(-82.5209372), '-82.5209372');
		assert.equal(coordString(28.985237), '28.985237');
		assert.equal(coordString(-82.4867061), '-82.4867061');
		const frontmatter: Record<string, unknown> = {
			Address: '10 Main St',
			Location: '47.2, -122.4',
		};
		const settings: RVLocatorSettings = { ...DEFAULT_SETTINGS };
		const hit: GeocodeHit = {
			lat: 29.0313846,
			lon: -82.5209372,
			formattedAddress: '10 Main St, Ocala',
			city: 'Ocala',
		};
		applyGeocodeHit(frontmatter, hit, settings);
		const location = frontmatter.Location;
		assert.ok(Array.isArray(location));
		assert.deepEqual(location, ['29.0313846', '-82.5209372']);
		assert.equal(typeof location[0], 'string');
		assert.equal(typeof location[1], 'string');
		assert.equal(frontmatter.Address, '10 Main St');
		assert.equal(frontmatter['Map Link'], googleMapsAddressLink('10 Main St'));
		assert.equal(String(frontmatter['Map Link']).includes('Ocala'), false);
		assert.equal(frontmatter.City, 'Ocala');
		assert.equal('Last Attempted' in frontmatter, false);
		assert.deepEqual(latLonFromUnknown(location), { lat: 29.0313846, lon: -82.5209372 });
		const flowText = latLonFromUnknown(`[${location[0]}, ${location[1]}]`);
		assert.deepEqual(flowText, { lat: 29.0313846, lon: -82.5209372 });
		const skipped = planGeocodeWork([
			{ path: 'listed.md', frontmatter: { Address: '10 Main St', Location: location } },
			{ path: 'old.md', frontmatter: { Address: '11 Main St', Location: [28.985237, -82.4867061] } },
		], settings, false);
		assert.equal(skipped.length, 0);
		assert.equal('Distance' in frontmatter, false);
		const blocked = { ...DEFAULT_SETTINGS, locationProperty: 'Address' };
		const locked: Record<string, unknown> = { Address: 'keep me' };
		applyGeocodeHit(locked, hit, blocked);
		assert.equal(locked.Address, 'keep me');
		assert.equal('Location' in locked, false);

		const numeric = `---\nAddress: 10 Main St\nLocation:\n  - 28.985237\n  - -82.4867061\nCity: Ocala\n---\n\nNotes stay.\n`;
		const quoted = ensureQuotedLocationList(numeric, 'Location', ['28.985237', '-82.4867061']);
		assert.match(quoted, /Location:\n {2}- "28.985237"\n {2}- "-82.4867061"/);
		assert.match(quoted, /Address: 10 Main St/);
		assert.match(quoted, /City: Ocala/);
		assert.match(quoted, /Notes stay\./);
		assert.equal(quoted.includes('\n  - 28.985237\n'), false);
		assert.equal(quoted.includes('\n  - -82.4867061\n'), false);
		const again = ensureQuotedLocationList(quoted, 'Location', ['28.985237', '-82.4867061']);
		assert.equal(again, quoted);
		const flow = `---\nAddress: keep\nLocation: [28.985237, -82.4867061]\n---\n`;
		const fromFlow = ensureQuotedLocationList(flow, 'Location', ['28.985237', '-82.4867061']);
		assert.match(fromFlow, /Address: keep/);
		assert.match(fromFlow, /Location:\n {2}- "28.985237"\n {2}- "-82.4867061"\n---/);
		assert.equal(ensureQuotedLocationList(numeric, 'Address', ['1', '2']), numeric);
		assert.equal(ensureQuotedLocationList(numeric, 'Location', ['1', '2'], 'Location'), numeric);
		const crlf = '---\r\nAddress: 10 Main St\r\nLocation:\r\n  - 1\r\n  - -2\r\n---\r\n\r\nBody\r\n';
		const crlfOut = ensureQuotedLocationList(crlf, 'Location', ['29.0313846', '-82.5209372']);
		assert.match(crlfOut, /Address: 10 Main St\r\nLocation:\r\n {2}- "29.0313846"\r\n {2}- "-82.5209372"\r\n---\r\n\r\nBody/);
	});
});

describe('cache and pacing', () => {
	it('reuses a normalized address and does not grow forever', () => {
		const hit: GeocodeHit = { lat: 1, lon: 2, formattedAddress: '10 Main St' };
		let cache = rememberResults({}, ['  10   MAIN St '], [hit], 10);
		assert.deepEqual(getCached(cache, '10 main st'), [hit]);
		assert.equal(normalizeAddress('  10   MAIN,St '), '10 main, st');
		for (let i = 0; i < 5; i += 1) {
			cache = rememberResults(cache, [`place ${i}`], [{ lat: i, lon: i, formattedAddress: `place ${i}` }], i);
		}
		const trimmed = trimCache(cache, 2);
		assert.equal(Object.keys(trimmed).length, 2);
	});

	it('waits between requests and backs off after 429', async () => {
		let clock = 1_000;
		const pacer = new RequestPacer(750, () => clock);
		const slept: number[] = [];
		const sleep = async (ms: number) => {
			slept.push(ms);
			clock += ms;
		};
		const calls: string[] = [];
		const fetchImpl: typeof fetch = async (input) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			calls.push(url);
			if (calls.length === 1) {
				return new Response('{}', { status: 429, headers: { 'retry-after': '2' } });
			}
			return new Response(JSON.stringify({
				results: [{ lat: 38.7, lon: -121.2, formatted: '10 Main St', city: 'Citrus Heights' }],
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		};
		const hits = await geocodeAddress('10 Main St', 'secret-key', {
			fetchImpl,
			sleep,
			pacer,
			aborted: () => false,
		});
		assert.equal(calls.length, 2);
		assert.equal(slept.includes(2000), true);
		assert.equal(hits[0]?.city, 'Citrus Heights');
		assert.equal(calls[0]?.includes('apiKey=secret-key'), true);
		assert.equal(calls[0]?.includes('phone'), false);
	});

	it('does not retry an invalid key', async () => {
		let calls = 0;
		const fetchImpl: typeof fetch = async () => {
			calls += 1;
			return new Response('{}', { status: 401 });
		};
		await assert.rejects(
			() => geocodeAddress('10 Main St', 'secret-key', {
				fetchImpl,
				sleep: async () => undefined,
				pacer: new RequestPacer(0),
				aborted: () => false,
			}),
			(error: unknown) => error instanceof GeocodeRequestError && error.status === 401 && error.retryable === false,
		);
		assert.equal(calls, 1);
	});
});

describe('distance and dates', () => {
	it('measures a degree of latitude and formats miles', () => {
		const meters = haversineMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
		assert.ok(Math.abs(meters - 111194.9) < 2);
		assert.equal(haversineMeters({ lat: 10, lon: 10 }, { lat: 10, lon: 10 }), 0);
		assert.equal(formatDistance(160.9344, 'miles'), '0.1 mi');
		assert.equal(formatDistance(16, 'miles'), '< 0.1 mi');
		assert.equal(formatDistance(1609.344, 'miles'), '1.0 mi');
		assert.equal(formatDistance(16093.44, 'miles'), '10 mi');
		assert.equal(formatDistance(1500, 'kilometers'), '1.5 km');
	});

	it('keeps missing distances last in both directions', () => {
		const rows = [
			{ lat: 1, lon: 0, sortKeys: {}, id: 'far' },
			{ lat: null, lon: null, sortKeys: {}, id: 'none' },
			{ lat: 0, lon: 0, sortKeys: {}, id: 'near' },
		];
		const asc = sortRows(rows, { property: 'rv-locator.distance', direction: 'ASC' }, { lat: 0, lon: 0 }, 'rv-locator.distance');
		assert.deepEqual(asc.map((row) => row.id), ['near', 'far', 'none']);
		const desc = sortRows(rows, { property: 'rv-locator.distance', direction: 'DESC' }, { lat: 0, lon: 0 }, 'rv-locator.distance');
		assert.deepEqual(desc.map((row) => row.id), ['far', 'near', 'none']);
		assert.equal(compareNullableNumber(null, 1, 'DESC'), 1);
	});

	it('cycles back to the base order instead of locking distance sort', () => {
		assert.deepEqual(cycleSort(null, 'note.Met'), { property: 'note.Met', direction: 'ASC' });
		assert.deepEqual(cycleSort({ property: 'note.Met', direction: 'ASC' }, 'note.Met'), { property: 'note.Met', direction: 'DESC' });
		assert.equal(cycleSort({ property: 'note.Met', direction: 'DESC' }, 'note.Met'), null);
	});

	it('forces Nearby columns so Priority stays beside Distance', () => {
		const full = [...NEARBY_COLUMN_ORDER];
		assert.deepEqual(resolveNearbyOrder([]), full);
		assert.deepEqual(resolveNearbyOrder(['file.name']), full);
		assert.deepEqual(resolveNearbyOrder(['file.name', 'note.Last Spoke', 'note.Met']), full);
		assert.deepEqual(resolveNearbyOrder(['file.name', 'note.Address']), full);
		assert.deepEqual(
			resolveNearbyOrder(['file.name', 'Priority', 'Last Spoke', 'Met', 'Visits', 'Address', 'Met With', 'Map Link']),
			full,
		);
		assert.deepEqual(resolveNearbyOrder(['file.name', 'note.Taken']), [...full, 'note.Taken']);
		const scrambled = resolveNearbyOrder([
			'file.name',
			'note.Address',
			'note.Last Spoke',
			'note.Map Link',
			'note.Priority',
			'note.Met',
			'note.Met With',
			'note.Visits',
			'note.Taken',
		]);
		assert.deepEqual(scrambled, [...full, 'note.Taken']);
		assert.equal(scrambled[1], DISTANCE_COLUMN_ID);
		assert.equal(scrambled[2], 'note.Priority');
		assert.equal(scrambled[scrambled.indexOf('note.Last Spoke') + 1], 'note.Last Attempted');
		assert.equal(scrambled[scrambled.indexOf('note.Last Attempted') + 1], 'note.Met');
		assert.equal(scrambled[scrambled.length - 1], 'note.Taken');
		assert.deepEqual(SORT_PRESETS.map((preset) => preset.label), ['Nearest', 'Priority', 'Last Spoke', 'Last Attempted']);
		const cased = resolveNearbyOrder([], ['note.priority', 'note.address']);
		assert.ok(cased.includes('note.priority'));
		assert.ok(cased.includes('note.address'));
		assert.ok(cased.includes('note.Last Spoke'));
		assert.equal(ACTIVE_SORT.some((item) => item.property === DISTANCE_COLUMN_ID), false);
		assert.equal(shouldUseActiveSort([]), true);
		assert.equal(shouldUseActiveSort([{ property: 'file.name', direction: 'ASC' }]), true);
		assert.equal(shouldUseActiveSort([{ property: 'note.Priority', direction: 'DESC' }]), false);
		assert.equal(preferredSortDirection('note.Priority'), 'DESC');
		assert.equal(preferredSortDirection('note.Met'), 'DESC');
		assert.equal(preferredSortDirection(DISTANCE_COLUMN_ID), 'ASC');
		assert.deepEqual(ACTIVE_SORT.map((item) => item.property), [
			'note.Priority',
			'note.Last Spoke',
			'note.Met',
			'file.backlinks',
			'file.name',
		]);
	});

	it('keeps the Active RV filter and does not use the map view link', () => {
		assert.equal(matchesActiveRvFilter({
			folder: 'Ministry',
			priority: 4,
			hubTexts: ['[[Return Visits Hub]]'],
		}), true);
		assert.equal(matchesActiveRvFilter({
			folder: 'Ministry',
			priority: 2,
			hubTexts: ['Return Visits Hub.md'],
		}), true);
		assert.equal(matchesActiveRvFilter({
			folder: '+/Templates',
			priority: 4,
			hubTexts: ['[[Return Visits Hub]]'],
		}), false);
		assert.equal(matchesActiveRvFilter({
			folder: 'Ministry',
			priority: 0,
			hubTexts: ['[[Return Visits Hub|Hub]]'],
		}), false);
		assert.equal(matchesActiveRvFilter({
			folder: 'Ministry',
			priority: 3,
			hubTexts: ['[[Return Visits.base]]'],
		}), false);
		const hub = ['[[Return Visits Hub]]'];
		assert.equal(matchesNearbyScope('all', { folder: 'Ministry', priority: 0, hubTexts: hub }), true);
		assert.equal(matchesNearbyScope('all', { folder: 'Ministry', priority: 4, hubTexts: hub }), true);
		assert.equal(matchesNearbyScope('all', { folder: 'Ministry', priority: null, hubTexts: hub }), true);
		assert.equal(matchesNearbyScope('inactive', { folder: 'Ministry', priority: 0, hubTexts: hub }), true);
		assert.equal(matchesNearbyScope('inactive', { folder: 'Ministry', priority: 2, hubTexts: hub }), false);
		assert.equal(matchesNearbyScope('active', { folder: 'Ministry', priority: 0, hubTexts: hub }), false);
		assert.equal(matchesNearbyScope('inactive', { folder: '+/Templates', priority: 0, hubTexts: hub }), false);
		assert.equal(hubListIncludesActive(['"[[Return Visits Hub]]"']), true);
		assert.equal(hubListIncludesActive(['[[Other note]]']), false);
		assert.equal(parsePriority(4), 4);
		assert.equal(parsePriority(0), 0);
		assert.equal(parsePriority('5'), 5);
		assert.equal(parsePriority('High'), null);
		assert.equal(parsePriority('Medium'), null);
		assert.equal(parsePriority('Low'), null);
		assert.equal(visiblePropertyText('"[[Return Visits Hub]]"'), 'Return Visits Hub');
		assert.equal(visiblePropertyText('Person 1'), 'Person 1');
	});

	it('sorts like Active RVs before any distance override', () => {
		const rows = [
			activeRow('low', 1, '2026-09-20', 'B', 2),
			activeRow('high-old', 4, '2026-03-28', 'A', 1),
			activeRow('high-new', 4, '2026-09-09', 'C', 0),
		];
		const sorted = sortRowsBy(rows, ACTIVE_SORT, null, DISTANCE_COLUMN_ID);
		assert.deepEqual(sorted.map((item) => item.id), ['high-new', 'high-old', 'low']);
		const tied = sortRowsBy([
			activeRow('met-old', 4, '2026-09-09', 'D', 0, '2026-05-01'),
			activeRow('met-new', 4, '2026-09-09', 'C', 0, '2026-09-18 16:45'),
		], ACTIVE_SORT, null, DISTANCE_COLUMN_ID);
		assert.deepEqual(tied.map((item) => item.id), ['met-new', 'met-old']);
	});

	it('formats Last Spoke and Met dates with the weekday', () => {
		assert.equal(dateCellText('2026-09-09T13:38:03', 'weekday'), 'Wed, Sep 9, 2026');
		assert.equal(dateCellText('2026-09-18 16:45', 'weekday'), 'Fri, Sep 18, 2026');
		assert.equal(dateCellText('2026-09-20T10:44', 'weekday'), 'Sun, Sep 20, 2026');
		assert.equal(dateCellText('2026-09-20T10:44', 'short'), 'Sep 20, 2026');
		assert.equal(dateCellText('2026-03-28 11:20', 'weekday'), 'Sat, Mar 28, 2026');
		assert.equal(dateCellText('', 'weekday'), null);
		assert.equal(dateCellText('true', 'weekday'), null);
		assert.equal(dateCellText('false', 'short'), null);
		assert.deepEqual(dateCellDisplay('', true), { text: '—', title: 'No date', empty: true });
		assert.deepEqual(dateCellDisplay('   ', false), { text: '—', title: 'No date', empty: true });
		assert.equal(dateCellDisplay('yes', true).empty, true);
		assert.equal(dateCellDisplay('2026-09-09T13:38:03', true).text, 'Wed, Sep 9, 2026');
		assert.equal(dateCellDisplay('2026-09-09T13:38:03', true).dow, 'Wed');
		assert.equal(dateCellDisplay('2026-03-28 11:20', true).text, 'Sat, Mar 28, 2026');
		assert.equal(formatWeekdayDate(parseFlexibleDate('2026-03-28 11:20') as Date), 'Sat, Mar 28, 2026');
		const names = parseDatePropertyNames('Last Spc, Met\nLast Spoke');
		assert.deepEqual(names, ['Last Spoke', 'Met']);
		assert.equal(isWeekdayProperty('Last Spoke', 'Last Spc', names), true);
		assert.equal(isWeekdayProperty('Met', 'Met', names), true);
		assert.equal(isWeekdayProperty('Phone', 'Phone', names), false);
		const spoke = formatDriveDate('2026-09-09T13:38:03');
		assert.equal(spoke.text, 'Wed, 2pm');
		assert.equal(spoke.title, '2026-09-09T13:38:03');
		assert.equal(spoke.dow, 'Wed');
		assert.equal(spoke.rest, 'Sep 9, 2026');
		assert.equal(spoke.time, '2pm');
		assert.equal(formatDriveDate('2026-09-18 16:45').text, 'Fri, 5pm');
		assert.equal(formatDriveDate('2026-09-18 16:45').rest, 'Sep 18, 2026');
		const dateOnly = formatDriveDate('2026-09-09');
		assert.equal(dateOnly.text, 'Wed');
		assert.equal(dateOnly.rest, 'Sep 9, 2026');
		assert.equal(dateOnly.time, undefined);
		assert.equal(formatDriveDate('2026-09-09T23:45').text, 'Thu, 12am');
		assert.equal(formatDriveDate('2026-09-09T23:45').rest, 'Sep 10, 2026');
		assert.equal(formatDriveDate('').empty, true);
		assert.equal(formatDriveDate('true').empty, true);
		assert.equal(formatGlancableStampFromRaw('2026-09-09T13:38:03'), 'Wed, 2pm — Sep 9, 2026');
		assert.equal(formatGlancableStampFromRaw('2026-09-09'), 'Wed — Sep 9, 2026');
		assert.equal(formatGlancableVisitStamp(new Date(2026, 8, 9, 13, 38, 3)), 'Wed, 2pm — Sep 9, 2026');
		assert.equal(formatGlancableVisitStamp(new Date(2026, 8, 9, 23, 45, 0)), 'Thu, 12am — Sep 10, 2026');
		const today = new Date(2026, 8, 26);
		assert.equal(calendarDaysSince('2026-09-09T13:38:03', today), 17);
		assert.equal(calendarDaysSince('2026-09-09T23:45', today), 17);
		assert.equal(calendarDaysSince('2026-09-26', today), 0);
		assert.equal(calendarDaysSince('2026-09-27', today), null);
		assert.equal(calendarDaysSince('', today), null);
		assert.equal(calendarDaysSince('true', today), null);
		assert.equal(showsElapsedDays('Last Spoke', 'Last Spc'), true);
		assert.equal(showsElapsedDays('Last Attempted', 'Last Attempted'), true);
		assert.equal(showsElapsedDays('Met', 'Met'), true);
		assert.equal(showsElapsedDays('Met With', 'Met With'), false);
	});
});

describe('address display', () => {
	it('splits a US street and city and leaves odd lines whole', () => {
		assert.deepEqual(parseDisplayAddress('1313 Broadway, Citrus Springs, FL 34434'), {
			street: '1313 Broadway',
			city: 'Citrus Springs',
		});
		assert.deepEqual(parseDisplayAddress('456 SW Dunnellon Rd, Dunnellon, FL'), {
			street: '456 SW Dunnellon Rd',
			city: 'Dunnellon',
		});
		assert.deepEqual(parseDisplayAddress('789 N Crystal St, Crystal River FL 34428'), {
			street: '789 N Crystal St',
			city: 'Crystal River',
		});
		assert.equal(parseDisplayAddress('PO Box 12, Crystal River, FL'), null);
		assert.equal(parseDisplayAddress('Citrus Springs, FL'), null);
		assert.equal(parseDisplayAddress('1313 Broadway'), null);
		assert.equal(parseDisplayAddress(''), null);
		assert.equal(displayCity('Dunnellon', '1313 Broadway, Citrus Springs, FL 34434'), 'Dunnellon');
		assert.equal(displayCity('', '1313 Broadway, Citrus Springs, FL 34434'), 'Citrus Springs');
		assert.equal(displayCity(undefined, 'PO Box 12, Crystal River, FL'), null);
	});
});

describe('successful visits', () => {
	it('copies Visits only when Successful Visits is missing', () => {
		const missing = { Visits: 4, Address: '1 Main St' };
		assert.equal(fillSuccessfulVisits(missing), true);
		assert.equal(missing['Successful Visits'], 4);
		assert.equal('Last Attempted' in missing, false);

		const already = { Visits: 4, 'Successful Visits': 2 };
		assert.equal(fillSuccessfulVisits(already), false);
		assert.equal(already['Successful Visits'], 2);

		const blank = { Visits: '3', 'Successful Visits': '' };
		assert.equal(fillSuccessfulVisits(blank), true);
		assert.equal(blank['Successful Visits'], 3);

		const noVisits: Record<string, unknown> = { Address: '1 Main St' };
		assert.equal(fillSuccessfulVisits(noVisits), false);
		assert.equal('Successful Visits' in noVisits, false);

		const zero = { Visits: 0 };
		assert.equal(fillSuccessfulVisits(zero), true);
		assert.equal(zero['Successful Visits'], 0);
	});

	it('writes City from the geocoder or the address, and backfills only when location exists', () => {
		const fromResult: Record<string, unknown> = { Address: 'old' };
		applyGeocodeHit(fromResult, {
			lat: 28.99,
			lon: -82.45,
			formattedAddress: '789 N Crystal St, Crystal River, FL 34428',
			city: 'Crystal River',
		}, DEFAULT_SETTINGS);
		assert.equal(fromResult.Address, 'old');
		assert.equal(fromResult.City, 'Crystal River');
		assert.equal(fromResult['Map Link'], googleMapsAddressLink('old'));
		assert.equal(String(fromResult['Map Link']).includes('Crystal'), false);

		const fromAddress: Record<string, unknown> = {};
		applyGeocodeHit(fromAddress, {
			lat: 28.99,
			lon: -82.45,
			formattedAddress: '456 SW Dunnellon Rd, Dunnellon, FL',
		}, DEFAULT_SETTINGS);
		assert.equal('Address' in fromAddress, false);
		assert.equal(fromAddress.City, 'Dunnellon');
		assert.equal(fromAddress['Map Link'], googleMapsAddressLink('456 SW Dunnellon Rd, Dunnellon, FL'));
		assert.equal('Visits' in fromAddress, false);
		assert.equal('Successful Visits' in fromAddress, false);
		assert.equal('Last Attempted' in fromAddress, false);

		const ready = {
			Address: '1313 Broadway, Citrus Springs, FL 34434',
			Location: [28.99, -82.45],
			Visits: 2,
		};
		assert.equal(fillCity(ready), true);
		assert.equal(ready.City, 'Citrus Springs');
		assert.equal(ready.Visits, 2);
		assert.equal('Successful Visits' in ready, false);
		assert.equal('Last Attempted' in ready, false);
		assert.equal(fillCity(ready), false);

		const kept = { Address: '1313 Broadway, Citrus Springs, FL 34434', Location: [1, 2], City: 'Inverness' };
		assert.equal(fillCity(kept), false);
		assert.equal(kept.City, 'Inverness');

		const noLocation = { Address: '1313 Broadway, Citrus Springs, FL 34434' };
		assert.equal(fillCity(noLocation), false);
		assert.equal('City' in noLocation, false);

		const odd = { Address: 'PO Box 12, Crystal River, FL', Location: [1, 2] };
		assert.equal(fillCity(odd), false);
		assert.equal('City' in odd, false);
	});
});

describe('settings', () => {
	it('keeps defaults and the saved key', () => {
		const merged = mergeSettings({ geoapifyApiKey: 'abc', distanceUnit: 'kilometers' });
		assert.equal(merged.addressProperty, 'Address');
		assert.deepEqual(merged.homeCounties, []);
		const homes = mergeSettings({ homeCounties: ['Orange', 'orange county', 'Lake'] });
		assert.deepEqual(homes.homeCounties, ['Orange', 'Lake']);
		assert.equal(merged.locationProperty, 'Location');
		assert.equal(merged.mapLinkProperty, 'Map Link');
		assert.equal(merged.cityProperty, '');
		assert.deepEqual(merged.datePropertiesForWeekday, ['Last Spoke', 'Met', 'Last Attempted']);
		const legacy = mergeSettings({ weekdayDateProperties: 'Last Spc, Met' } as Partial<RVLocatorSettings>);
		assert.deepEqual(legacy.datePropertiesForWeekday, ['Last Spoke', 'Met', 'Last Attempted']);
		const saved = mergeSettings({ datePropertiesForWeekday: ['Last Spoke', 'Met'] });
		assert.deepEqual(saved.datePropertiesForWeekday, ['Last Spoke', 'Met', 'Last Attempted']);
		const cleared = mergeSettings({ datePropertiesForWeekday: [] });
		assert.deepEqual(cleared.datePropertiesForWeekday, []);
		assert.deepEqual(sanitizeNearbySort(undefined), { property: DISTANCE_COLUMN_ID, direction: 'ASC' });
		assert.deepEqual(sanitizeNearbySort({ property: 'note.Priority', direction: 'DESC' }), {
			property: 'note.Priority',
			direction: 'DESC',
		});
		assert.deepEqual(sanitizeNearbySort({ property: 'note.Met', direction: 'SIDEWAYS' }), {
			property: DISTANCE_COLUMN_ID,
			direction: 'ASC',
		});
		assert.equal(merged.geoapifyApiKey, 'abc');
		assert.equal(merged.distanceUnit, 'kilometers');
		assert.equal(merged.distanceTest, false);
		assert.equal(merged.testLatitude, 28.54);
		assert.equal(merged.testLongitude, -81.38);
		const testing = mergeSettings({ distanceTest: true, testLatitude: 28.5, testLongitude: '-81.4' });
		assert.equal(testing.distanceTest, true);
		assert.equal(testing.testLatitude, 28.5);
		assert.equal(testing.testLongitude, -81.4);
		const bad = mergeSettings({ distanceTest: false, testLatitude: 999, testLongitude: 'nope' });
		assert.equal(bad.distanceTest, false);
		assert.equal(bad.testLatitude, 28.54);
		assert.equal(bad.testLongitude, -81.38);
		assert.equal(OSM_ATTRIBUTION.includes('OpenStreetMap'), true);
		assert.equal(GEOAPIFY_ATTRIBUTION, 'Powered by Geoapify');
		assert.equal(PRIVACY_NOTICE, 'Addresses are sent to Geoapify to look up coordinates.');
	});
});

describe('home base pick', () => {
	const maple: GeocodeHit = {
		lat: 1,
		lon: 2,
		formattedAddress: '142 Maple St, Orlando, FL 32801, United States',
		housenumber: '142',
		street: 'Maple Street',
		county: 'Orange County',
		city: 'Orlando',
		confidence: 1,
	};
	const hammock: GeocodeHit = {
		lat: 1,
		lon: 2,
		formattedAddress: '10 Oak Hammock Ln, Orlando, FL',
		housenumber: '10',
		street: 'Oak Hammock Lane',
		county: 'Orange County',
		confidence: 1,
	};

	it('auto-picks the only in-home hit when confidence is 1.00', () => {
		const both = decideGeocodePick([maple, hammock], ['Orange']);
		assert.equal(both.hit, null);
		const only = decideGeocodePick([maple, { ...hammock, county: 'Lake County' }], ['orange county']);
		assert.equal(only.hit?.street, 'Maple Street');
		const decimal = decideGeocodePick([{ ...maple, confidence: 1.0 }], ['Orange']);
		assert.equal(decimal.hit?.street, 'Maple Street');
		const low = decideGeocodePick(
			[{ ...maple, county: 'Seminole County' }, { ...hammock, confidence: 0.2 }],
			['Orange'],
		);
		assert.equal(low.hit, null);
	});

	it('shows the picker when confidence is missing, not 1, home is empty, or several hits are in-home', () => {
		assert.equal(decideGeocodePick([maple], []).hit, null);
		assert.equal(decideGeocodePick([{ ...hammock, confidence: undefined }], ['Orange']).hit, null);
		assert.equal(decideGeocodePick([{ ...hammock, confidence: 0.99 }], ['Orange']).hit, null);
		assert.equal(decideGeocodePick([{ ...maple, county: 'Seminole County' }], ['Orange']).hit, null);
		assert.equal(decideGeocodePick([maple, hammock], ['Orange County']).hit, null);
		const blocked = { ...DEFAULT_SETTINGS, countyProperty: 'Address' };
		const frontmatter: Record<string, unknown> = { Address: 'keep me' };
		applyGeocodeHit(frontmatter, maple, blocked);
		assert.equal(frontmatter.Address, 'keep me');
		assert.deepEqual(frontmatter.Location, ['1', '2']);
	});
});

describe('picker confirm', () => {
	function settle(order: ReadonlyArray<'close' | 'pick'>): 'updated' | 'passed' | null {
		let chose = false;
		let settled: 'updated' | 'passed' | null = null;
		const later: Array<() => void> = [];
		const finish = (kind: 'updated' | 'passed') => {
			if (settled) return;
			settled = kind;
		};
		for (const event of order) {
			if (event === 'close') {
				schedulePickerDismiss(() => chose, () => finish('passed'), (run) => later.push(run));
				continue;
			}
			chose = true;
			finish('updated');
		}
		for (const run of later) run();
		return settled;
	}

	it('counts a confirmed pick after the modal closes, and a bare close as a skip', () => {
		assert.equal(settle(['close', 'pick']), 'updated');
		assert.equal(settle(['pick', 'close']), 'updated');
		assert.equal(settle(['close']), 'passed');
	});
});

describe('new RV note title', () => {
	it('uses the householder and a short street name', () => {
		assert.equal(streetShortName('142 Maple Street, Orlando, FL'), 'Maple');
		assert.equal(streetShortName('88 Cypress Ave'), 'Cypress');
		assert.equal(streetShortName('10 Oak Hammock Lane, Orlando'), 'Oak Hammock');
		assert.equal(streetShortName('7790 N Voyager Dr, Citrus Heights'), 'Voyager');
		assert.equal(streetShortName('1313 Broadway, Tacoma, WA'), 'Broadway');
		assert.equal(streetShortName('142 maple street'), 'Maple');
		assert.equal(rvNoteTitle('Alex', '142 Maple Street, Orlando'), 'Alex on Maple');
		assert.equal(rvNoteTitle('Riley', '88 Cypress Ave'), 'Riley on Cypress');
		assert.equal(rvNoteTitle('Sam', '10 Oak Hammock Ln'), 'Sam on Oak Hammock');
		assert.equal(rvNoteTitle('A/B', '1 Main St'), 'A B on Main');
		assert.equal(rvNoteTitle('', '142 Maple Street'), 'Maple');
		assert.equal(rvNoteTitle('Alex', ''), 'Alex');
	});
});

describe('visit log', () => {
	const now = new Date(2026, 8, 26, 23, 12, 4);

	it('logs a home visit without touching Address', () => {
		assert.equal(formatVisitStamp(now), 'Sat, 11pm — Sep 26, 2026');
		assert.equal(formatVisitStamp(now), formatGlancableVisitStamp(now));
		assert.equal(formatFrontmatterDateTime(now), '2026-09-26T23:12:04');
		const frontmatter: Record<string, unknown> = { Address: '142 Maple Street', Visits: 2, 'Successful Visits': 1 };
		applyVisitFrontmatter(frontmatter, 'home', now);
		assert.equal(frontmatter.Address, '142 Maple Street');
		assert.equal(frontmatter.Visits, 3);
		assert.equal(frontmatter['Successful Visits'], 2);
		assert.equal(frontmatter['Last Spoke'], '2026-09-26T23:12:04');
		assert.equal(frontmatter['Last Attempted'], '2026-09-26T23:12:04');
		const body = applyVisitBody('Talked on the porch.\n', 'home', now);
		assert.equal(body, [
			'Talked on the porch.',
			'',
			'### Sat, 11pm — Sep 26, 2026',
			'',
			'> [!note]- Attempt Log',
			'> - Sat, 11pm — Sep 26, 2026 — success',
			'',
		].join('\n'));
		assert.equal(body.includes('## Attempt Log'), false);
		const stampAt = body.indexOf('### Sat, 11pm — Sep 26, 2026');
		const logAt = body.indexOf('> [!note]- Attempt Log');
		assert.ok(stampAt >= 0 && stampAt < logAt);
	});

	it('logs a miss on Visits and Last Attempted only', () => {
		const frontmatter: Record<string, unknown> = {
			Address: '142 Maple Street',
			Visits: 2,
			'Successful Visits': 1,
			'Last Spoke': '2026-09-01T10:00:00',
		};
		applyVisitFrontmatter(frontmatter, 'miss', now);
		assert.equal(frontmatter.Address, '142 Maple Street');
		assert.equal(frontmatter.Visits, 3);
		assert.equal(frontmatter['Successful Visits'], 1);
		assert.equal(frontmatter['Last Spoke'], '2026-09-01T10:00:00');
		assert.equal(frontmatter['Last Attempted'], '2026-09-26T23:12:04');
		const body = applyVisitBody('', 'miss', now);
		assert.equal(body.includes('## Sat, 11pm — Sep 26, 2026'), false);
		assert.equal(body, [
			'> [!note]- Attempt Log',
			'> - Sat, 11pm — Sep 26, 2026 — not home',
			'',
		].join('\n'));
		const again = applyVisitBody(body, 'miss', now);
		assert.equal(again, [
			'> [!note]- Attempt Log',
			'> - Sat, 11pm — Sep 26, 2026 — not home',
			'> - Sat, 11pm — Sep 26, 2026 — not home',
			'',
		].join('\n'));
	});

	it('appends inside an existing collapsed or expanded Attempt Log callout', () => {
		const collapsed = '> [!note]- Attempt Log\n> - Mon, 9am — Sep 1, 2026 — success\n';
		const next = applyVisitBody(collapsed, 'miss', now);
		assert.equal(next, [
			'> [!note]- Attempt Log',
			'> - Mon, 9am — Sep 1, 2026 — success',
			'> - Sat, 11pm — Sep 26, 2026 — not home',
			'',
		].join('\n'));

		const expanded = [
			'> [!note]+ Attempt Log',
			'> - Mon, 9am — Sep 1, 2026 — not home',
			'',
			'Footer.',
			'',
		].join('\n');
		const more = applyVisitBody(expanded, 'home', now);
		assert.equal(more, [
			'### Sat, 11pm — Sep 26, 2026',
			'',
			'> [!note]+ Attempt Log',
			'> - Mon, 9am — Sep 1, 2026 — not home',
			'> - Sat, 11pm — Sep 26, 2026 — success',
			'',
			'Footer.',
			'',
		].join('\n'));
		assert.ok(more.indexOf('### Sat, 11pm — Sep 26, 2026') < more.indexOf('> [!note]+ Attempt Log'));
	});

	it('skips a home stamp that already exists as ## or ###', () => {
		const existing = [
			'### Sat, 11pm — Sep 26, 2026',
			'',
			'> [!note]- Attempt Log',
			'> - Sat, 11pm — Sep 26, 2026 — success',
			'',
		].join('\n');
		const next = applyVisitBody(existing, 'home', now);
		assert.equal(next.split('\n').filter((line) => line === '### Sat, 11pm — Sep 26, 2026').length, 1);
		assert.equal(next.includes('> - Sat, 11pm — Sep 26, 2026 — success\n> - Sat, 11pm — Sep 26, 2026 — success'), true);

		const legacy = existing.replace('### Sat', '## Sat');
		const kept = applyVisitBody(legacy, 'home', now);
		assert.equal(kept.includes('## Sat, 11pm — Sep 26, 2026'), true);
		assert.equal(kept.includes('### Sat, 11pm — Sep 26, 2026'), false);
		assert.equal(kept.split('\n').filter((line) => line.trim() === '## Sat, 11pm — Sep 26, 2026').length, 1);
	});

	it('migrates a legacy ## Attempt Log heading into a collapsed callout', () => {
		const legacy = [
			'Notes.',
			'',
			'## Attempt Log',
			'- Mon, 9am — Sep 1, 2026 — success',
			'',
			'## Later',
			'keep',
			'',
		].join('\n');
		const next = applyVisitBody(legacy, 'miss', now);
		assert.equal(next.includes('## Attempt Log'), false);
		assert.equal(next, [
			'Notes.',
			'',
			'> [!note]- Attempt Log',
			'> - Mon, 9am — Sep 1, 2026 — success',
			'> - Sat, 11pm — Sep 26, 2026 — not home',
			'',
			'## Later',
			'keep',
			'',
		].join('\n'));
	});

	it('accepts unmarked and tight Attempt Log callout variants', () => {
		const plain = '> [!note] Attempt Log\n> - old — success\n';
		const next = applyVisitBody(plain, 'miss', now);
		assert.equal(next, [
			'> [!note] Attempt Log',
			'> - old — success',
			'> - Sat, 11pm — Sep 26, 2026 — not home',
			'',
		].join('\n'));

		const tight = '>[!note]- Attempt Log\n>- old — not home\n';
		const more = applyVisitBody(tight, 'miss', now);
		assert.equal(more, [
			'>[!note]- Attempt Log',
			'>- old — not home',
			'> - Sat, 11pm — Sep 26, 2026 — not home',
			'',
		].join('\n'));

		const spaced = '> [!NOTE] - Attempt Log\n> - old — success\n';
		const spacedNext = applyVisitBody(spaced, 'miss', now);
		assert.equal(spacedNext, [
			'> [!NOTE] - Attempt Log',
			'> - old — success',
			'> - Sat, 11pm — Sep 26, 2026 — not home',
			'',
		].join('\n'));
	});
});

function activeRow(id: string, priority: number, lastSpoke: string, name: string, backlinks: number, met?: string) {
	const metStamp = met ? Date.parse(met.includes('T') || met.includes(' ') ? met.replace(' ', 'T') : `${met}T00:00:00`) : null;
	return {
		id,
		lat: null,
		lon: null,
		sortKeys: {
			'note.Priority': { kind: 'number' as const, value: priority },
			'note.Last Spoke': { kind: 'date' as const, value: Date.parse(`${lastSpoke}T00:00:00Z`) },
			'note.Met': metStamp == null || Number.isNaN(metStamp)
				? { kind: 'empty' as const }
				: { kind: 'date' as const, value: metStamp },
			'file.backlinks': { kind: 'number' as const, value: backlinks },
			'file.name': { kind: 'text' as const, value: name },
		},
	};
}
