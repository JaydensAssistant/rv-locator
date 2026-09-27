import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACTIVE_SORT, NEARBY_COLUMN_ORDER, SORT_PRESETS, hubListIncludesActive, matchesActiveRvFilter, matchesNearbyScope, parsePriority, preferredSortDirection, resolveNearbyOrder, shouldUseActiveSort, visiblePropertyText } from '../src/active-layout';
import { buildGeocodeUrl, formatSpecificAddress, googleMapsLink, normalizeAddress, parseGeocodeBody } from '../src/address';
import { displayCity, parseDisplayAddress } from '../src/address-display';
import { DISTANCE_COLUMN_ID, GEOCODE_ENDPOINT, GEOAPIFY_ATTRIBUTION, OSM_ATTRIBUTION, PRIVACY_NOTICE } from '../src/constants';
import { getCached, rememberResults, trimCache } from '../src/cache';
import { formatDistance, haversineMeters, latLonFromUnknown, roundCoord } from '../src/distance';
import { calendarDaysSince, dateCellDisplay, dateCellText, formatDriveDate, formatWeekdayDate, isWeekdayProperty, parseDatePropertyNames, parseFlexibleDate, showsElapsedDays } from '../src/dates';
import { applyGeocodeHit, fillCity, fillSuccessfulVisits, planGeocodeWork, readAddress } from '../src/frontmatter';
import { decideGeocodePick, streetTokensMatch } from '../src/home-base';
import { applyVisitBody, applyVisitFrontmatter, formatFrontmatterDateTime, formatVisitStamp } from '../src/visit-log';
import { geocodeAddress, GeocodeRequestError } from '../src/geocode-client';
import { RequestPacer } from '../src/pacer';
import { redactSecrets } from '../src/redact';
import { compareNullableNumber, cycleSort, sortRows, sortRowsBy } from '../src/sort';
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
	});

	it('builds a Google Maps link and does not call a geocoder', () => {
		assert.equal(googleMapsLink(38.7, -121.28), 'https://www.google.com/maps?q=38.7,-121.28');
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
});
