import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { directionsUrl } from '../src/address';
import {
	AddressSuggestController,
	type SuggestClock,
	type SuggestFetchResult,
	type SuggestView,
} from '../src/address-suggest';
import { LESSONS, emptyShare, lessonPartOptions, studyPrefill } from '../src/catalog';
import { pinLookForHub } from '../src/map-pins';
import type { GeocodeHit } from '../src/types';
import { appendShareToFirstStamp, applyVisitFrontmatter } from '../src/visit-log';

const LESSON_1 = '01 How Can the Bible Help You?';
const LESSON_2 = '02 The Bible Gives Hope';
const LESSON_3 = '03 Can You Trust the Bible?';

function hit(formattedAddress: string): GeocodeHit {
	return { lat: 28.5, lon: -81.4, formattedAddress };
}

function makeClock(): SuggestClock & { advance(ms: number): void } {
	let now = 0;
	let seq = 1;
	const timers: { id: number; at: number; run: () => void }[] = [];
	return {
		now: () => now,
		schedule(ms, run) {
			const id = seq++;
			timers.push({ id, at: now + ms, run });
			return id;
		},
		cancel(id) {
			const index = timers.findIndex((timer) => timer.id === id);
			if (index >= 0) timers.splice(index, 1);
		},
		advance(ms) {
			const end = now + ms;
			for (;;) {
				const due = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at || a.id - b.id);
				const next = due[0];
				if (!next) break;
				now = next.at;
				const index = timers.findIndex((timer) => timer.id === next.id);
				if (index >= 0) timers.splice(index, 1);
				next.run();
			}
			now = end;
		},
	};
}

async function flush(): Promise<void> {
	for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe('study prefill', () => {
	it('opens the first study on lesson 1 from Intro through Review', () => {
		const next = studyPrefill(null);
		assert.equal(next.lesson, LESSON_1);
		assert.equal(next.from, 'Intro');
		assert.equal(next.to, 'Review');
	});

	it('moves to the next lesson after Review or Summary', () => {
		for (const ended of ['Review', 'Summary']) {
			const next = studyPrefill({ lesson: LESSON_1, to: ended });
			assert.equal(next.lesson, LESSON_2);
			assert.equal(next.from, 'Intro');
			assert.equal(next.to, 'Review');
		}
	});

	it('continues the next part of a lesson stopped in the middle', () => {
		const next = studyPrefill({ lesson: LESSON_3, to: '3' });
		assert.equal(next.lesson, LESSON_3);
		assert.equal(next.from, '4');
		assert.equal(next.to, 'Review');
	});

	it('keeps review-lesson question counts', () => {
		const expected: Record<number, number> = { 1: 10, 2: 15, 3: 12, 4: 12 };
		for (const lesson of LESSONS) {
			if (!lesson.review || !lesson.reviewSection) continue;
			assert.equal(lessonPartOptions(lesson).length, expected[lesson.reviewSection]);
		}
	});
});

describe('visit share writes', () => {
	it('appends literature onto the existing first stamp', () => {
		const body = '##### Wed, 2pm — Sep 9, 2026 <span class="rv-stamp-ago">1d</span>\n';
		const next = appendShareToFirstStamp(body, {
			...emptyShare(),
			publications: 'Enjoy Life Forever',
		});
		assert.equal(next.split('#####').length - 1, 1);
		assert.match(next, /##### Wed, 2pm — Sep 9, 2026 · «book» «Enjoy Life Forever» <span class="rv-stamp-ago"/);
	});

	it('writes literature, media, and lessons into frontmatter', () => {
		const frontmatter: Record<string, unknown> = {};
		applyVisitFrontmatter(frontmatter, 'home', new Date('2026-03-01T15:00:00'), '', {
			...emptyShare(),
			publications: 'Watchtower',
			media: 'Video',
			lesson: LESSON_1,
			lessonFrom: 'Intro',
			lessonTo: 'Review',
		});
		assert.equal(frontmatter['Left Publications'], 'Watchtower');
		assert.equal(frontmatter['Shared Media'], 'Video');
		assert.equal(frontmatter['Studies'], 1);
		assert.ok(frontmatter['Last Studied']);
		assert.deepEqual(frontmatter['Lessons Studied'], [LESSON_1]);
	});
});

describe('logged paths', () => {
	it('sends in-note Home through logNoteHome and returns', () => {
		const script = readFileSync('extras/templater-metabind/rvLog.js', 'utf8');
		const body = script.slice(script.indexOf('async function rvLog'));
		const call = body.indexOf('logNoteHome');
		const insert = body.indexOf('insertHomeHeading');
		assert.ok(call > 0 && call < insert);
		assert.match(body.slice(call, insert), /return;/);
	});

	it('snapshots the New RV draft before Templater create', () => {
		const source = readFileSync('src/main.ts', 'utf8');
		const body = source.slice(source.indexOf('private async launchNewRvTemplate'));
		const draft = body.indexOf('const draft = this.newRvDraft');
		const create = body.indexOf('await create.call');
		assert.ok(draft > 0 && draft < create);
	});

	it('does not open a suggester on focus', () => {
		const source = readFileSync('src/suggest-field.ts', 'utf8');
		assert.equal(source.includes("addEventListener('focus'"), false);
		assert.match(source, /export const SUGGEST_PENDING/);
		assert.match(source, /addEventListener\('input'/);
	});
});

describe('directions', () => {
	it('builds Google, Apple, and Waze links from coordinates or an address', () => {
		assert.equal(
			directionsUrl('google', { lat: 28.5, lon: -81.4, address: '1 Main' }),
			'https://www.google.com/maps/dir/?api=1&destination=28.5%2C-81.4',
		);
		assert.match(directionsUrl('google', { address: '1 Main St', city: 'Orlando' }), /google\.com\/maps\/dir/);
		assert.equal(directionsUrl('apple', { lat: 28.5, lon: -81.4 }), 'https://maps.apple.com/?daddr=28.5,-81.4');
		assert.match(directionsUrl('apple', { address: '1 Main St' }), /^https:\/\/maps\.apple\.com\/\?daddr=/);
		assert.equal(directionsUrl('waze', { lat: 28.5, lon: -81.4 }), 'https://waze.com/ul?ll=28.5,-81.4&navigate=yes');
		assert.match(directionsUrl('waze', { address: '1 Main St' }), /^https:\/\/waze\.com\/ul\?q=/);
	});
});

describe('map look', () => {
	it('follows the hub sort unless a gender or status filter is narrowed', () => {
		assert.equal(pinLookForHub('rv-locator.distance', 'active', 'all'), 'urgency');
		assert.equal(pinLookForHub('rv-locator.urgency', 'active', 'all'), 'urgency');
		assert.equal(pinLookForHub('note.Priority', 'active', 'all'), 'priority');
		assert.equal(pinLookForHub('note.Last Spoke', 'active', 'all'), 'heat');
		assert.equal(pinLookForHub('rv-locator.distance', 'active', 'men'), 'gender');
		assert.equal(pinLookForHub('note.Priority', 'studies', 'all'), 'status');
		assert.equal(pinLookForHub('note.Priority', 'archive', 'women'), 'gender');
	});
});

describe('address suggest', () => {
	it('does not request under 3 characters', async () => {
		const clock = makeClock();
		let calls = 0;
		const controller = new AddressSuggestController(clock, {
			home: async () => {
				calls += 1;
				return { hits: [], allowBroad: false };
			},
			broad: async () => [],
		}, () => {});
		controller.push('ab');
		clock.advance(1000);
		await flush();
		assert.equal(calls, 0);
		assert.equal(controller.requestCount(), 0);
	});

	it('fires on the trailing debounce and clears the max-wait', async () => {
		const clock = makeClock();
		const controller = new AddressSuggestController(clock, {
			home: async () => ({ hits: [hit('123 Main St')], allowBroad: false }),
			broad: async () => [],
		}, () => {});
		controller.push('123');
		clock.advance(200);
		await flush();
		assert.equal(controller.requestCount(), 1);
		clock.advance(400);
		await flush();
		assert.equal(controller.requestCount(), 1);
	});

	it('fires during fast typing before the person stops', async () => {
		const clock = makeClock();
		const sent: string[] = [];
		const controller = new AddressSuggestController(clock, {
			home: async (query) => {
				sent.push(query);
				return { hits: [], allowBroad: false };
			},
			broad: async () => [],
		}, () => {});
		let text = '';
		for (const ch of '123 main street extra') {
			text += ch;
			controller.push(text);
			clock.advance(30);
		}
		assert.equal(controller.requestCount() >= 1, true);
		assert.notEqual(sent[0], text);
	});

	it('keeps a fast home address to one or two autocomplete calls', async () => {
		const clock = makeClock();
		const full = '123 Main Street, Orlando, FL';
		let broad = 0;
		const controller = new AddressSuggestController(clock, {
			home: async () => ({
				hits: [hit(full), hit(`${full} north`), hit(`${full} south`)],
				allowBroad: true,
			}),
			broad: async () => {
				broad += 1;
				return [];
			},
		}, () => {});
		let text = '';
		for (const ch of '123 Main Street') {
			text += ch;
			controller.push(text);
			clock.advance(30);
			await flush();
		}
		clock.advance(400);
		await flush();
		assert.equal(broad, 0);
		assert.equal(controller.requestCount() >= 1 && controller.requestCount() <= 2, true);
	});

	it('does not let an older response replace a newer one', async () => {
		const clock = makeClock();
		const pending: { resolve: (value: SuggestFetchResult) => void }[] = [];
		const views: SuggestView[] = [];
		const controller = new AddressSuggestController(clock, {
			home: (query) => new Promise((resolve) => {
				pending.push({ resolve });
				void query;
			}),
			broad: async () => [],
		}, (view) => { views.push(view); });
		controller.push('123 ma');
		clock.advance(350);
		controller.push('123 main st');
		clock.advance(350);
		assert.equal(pending.length, 2);
		const newer = pending[1];
		const older = pending[0];
		assert.ok(newer && older);
		newer.resolve({ hits: [hit('123 Main St, Orlando')], allowBroad: false });
		await flush();
		older.resolve({ hits: [hit('123 Maple Ave')], allowBroad: false });
		await flush();
		const last = views[views.length - 1];
		assert.ok(last);
		assert.equal(last.hits.some((item) => item.formattedAddress.includes('Main')), true);
		assert.equal(last.hits.some((item) => item.formattedAddress.includes('Maple')), false);
	});

	it('lets the same-generation broader search update the list', async () => {
		const clock = makeClock();
		const views: SuggestView[] = [];
		const controller = new AddressSuggestController(clock, {
			home: async () => ({ hits: [hit('123 Oak Rd, Home')], allowBroad: true }),
			broad: async () => [hit('123 Oak Rd, Far')],
		}, (view) => { views.push(view); });
		controller.push('123 oak');
		clock.advance(200);
		await flush();
		const last = views[views.length - 1];
		assert.ok(last);
		assert.equal(last.hits[0]?.formattedAddress, '123 Oak Rd, Home');
		assert.equal(last.hits.some((item) => item.formattedAddress.includes('Far')), true);
		assert.equal(controller.requestCount(), 2);
	});

	it('skips the broader search once home results suffice', async () => {
		const clock = makeClock();
		let broad = 0;
		const controller = new AddressSuggestController(clock, {
			home: async () => ({
				hits: [hit('1 Home'), hit('2 Home'), hit('3 Home')],
				allowBroad: true,
			}),
			broad: async () => {
				broad += 1;
				return [hit('Far')];
			},
		}, () => {});
		controller.push('home');
		clock.advance(200);
		await flush();
		assert.equal(broad, 0);
		assert.equal(controller.requestCount(), 1);
	});

	it('runs the broader search when home is sparse', async () => {
		const clock = makeClock();
		let broad = 0;
		const controller = new AddressSuggestController(clock, {
			home: async () => ({ hits: [hit('1 Home Rd')], allowBroad: true }),
			broad: async () => {
				broad += 1;
				return [hit('1 Home Rd'), hit('1 Home Far')];
			},
		}, () => {});
		controller.push('1 home');
		clock.advance(200);
		await flush();
		assert.equal(broad, 1);
		assert.equal(controller.requestCount(), 2);
	});

	it('skips a cached query and a prefix the cache already covers', async () => {
		const clock = makeClock();
		const cache = new Map<string, GeocodeHit[]>();
		const controller = new AddressSuggestController(clock, {
			home: async () => ({
				hits: [hit('123 Main Street, Orlando, FL')],
				allowBroad: false,
			}),
			broad: async () => [],
		}, () => {}, cache);
		controller.push('123 ma');
		clock.advance(200);
		await flush();
		assert.equal(controller.requestCount(), 1);
		controller.push('123 ma');
		clock.advance(400);
		await flush();
		assert.equal(controller.requestCount(), 1);
		controller.push('123 main');
		clock.advance(400);
		await flush();
		assert.equal(controller.requestCount(), 1);
	});

	it('holds a third lookup while two are in flight', async () => {
		const clock = makeClock();
		const pending: { resolve: (value: SuggestFetchResult) => void }[] = [];
		let inFlight = 0;
		let peak = 0;
		const controller = new AddressSuggestController(clock, {
			home: () => {
				inFlight += 1;
				peak = Math.max(peak, inFlight);
				return new Promise((resolve) => {
					pending.push({
						resolve: (value) => {
							inFlight -= 1;
							resolve(value);
						},
					});
				});
			},
			broad: async () => [],
		}, () => {});
		controller.push('aaa');
		clock.advance(350);
		controller.push('bbb');
		clock.advance(350);
		controller.push('ccc');
		clock.advance(350);
		assert.equal(controller.requestCount(), 2);
		assert.equal(peak, 2);
		pending[0]?.resolve({ hits: [hit('aaa lane')], allowBroad: false });
		await flush();
		assert.equal(controller.requestCount(), 3);
	});

	it('delays the fourth request past three per second', async () => {
		const clock = makeClock();
		const controller = new AddressSuggestController(clock, {
			home: async (query) => ({ hits: [hit(`${query} only`)], allowBroad: false }),
			broad: async () => [],
		}, () => {});
		for (const query of ['aaa', 'bbb', 'ccc', 'ddd']) {
			controller.push(query);
			clock.advance(200);
			await flush();
		}
		assert.equal(controller.requestCount(), 3);
		clock.advance(500);
		await flush();
		assert.equal(controller.requestCount(), 4);
	});

	it('keeps the last matches on screen while a new lookup is loading', async () => {
		const clock = makeClock();
		let release: ((value: SuggestFetchResult) => void) | null = null;
		let calls = 0;
		const views: SuggestView[] = [];
		const controller = new AddressSuggestController(clock, {
			home: () => {
				calls += 1;
				if (calls === 1) return Promise.resolve({ hits: [hit('Abc Street')], allowBroad: false });
				return new Promise((resolve) => { release = resolve; });
			},
			broad: async () => [],
		}, (view) => { views.push(view); });
		controller.push('abc');
		clock.advance(200);
		await flush();
		controller.push('zzz');
		clock.advance(200);
		const loading = views[views.length - 1];
		assert.ok(loading?.loading);
		assert.equal(loading?.hits.some((item) => item.formattedAddress.includes('Abc')), true);
		release?.({ hits: [hit('Zzz Road')], allowBroad: false });
		await flush();
	});
});
