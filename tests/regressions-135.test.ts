import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { Modal } from 'obsidian';
import { directionsUrl } from '../src/address';
import {
	AddressSuggestController,
	type SuggestClock,
	type SuggestFetchResult,
	type SuggestView,
} from '../src/address-suggest';
import { LESSONS, emptyShare, lessonPartOptions, studyPrefill, type VisitShare } from '../src/catalog';
import { mountShareFields, type ShareFieldOptions } from '../src/catalog-fields';
import { pinLookForHub } from '../src/map-pins';
import { CompanionSuggestModal } from '../src/modals';
import type { GeocodeHit } from '../src/types';
import { HUB_STACK_BELOW_PX, hubUsesStackedMap, revealHubCard } from '../src/hub-layout';
import { applyVisitChangeFrontmatter, editVisit, insertVisit, listVisits } from '../src/visit-editor';
import { LiteraturePromptModal, VisitEditModal } from '../src/visit-modals';
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

describe('studied a lesson on every visit modal', () => {
	function options(prefill = studyPrefill(null), initial: VisitShare = emptyShare()): ShareFieldOptions {
		return {
			publications: [],
			media: [],
			customLessons: [],
			lessons: [...LESSONS],
			showLiterature: true,
			showLesson: false,
			optionalLesson: true,
			lessonPrefill: prefill,
			initial,
		};
	}

	function clickLabeled(root: { children: Array<{ text: string; children: never[]; click: () => void }> }, text: string): void {
		const stack = [root];
		while (stack.length > 0) {
			const current = stack.pop();
			if (!current) continue;
			if (current.text === text) {
				current.click();
				return;
			}
			stack.push(...current.children);
		}
		throw new Error(`No control labeled ${text}`);
	}

	it('stays collapsed until opened, then prefills lesson 1 and does not open a suggester', () => {
		const seen: VisitShare[] = [];
		const root = new Modal(null).contentEl;
		const share = mountShareFields(root, options(), (next) => { seen.push(next); });
		assert.equal(share.lesson, '');
		assert.equal(seen.length, 0);
		clickLabeled(root as never, 'Studied a lesson?');
		assert.equal(seen.at(-1)?.lesson, LESSON_1);
		assert.equal(seen.at(-1)?.lessonFrom, 'Intro');
		assert.equal(seen.at(-1)?.lessonTo, 'Review');
		clickLabeled(root as never, 'Studied a lesson?');
		assert.equal(seen.at(-1)?.lesson, '');
		assert.equal(seen.at(-1)?.lessonFrom, '');
		assert.equal(seen.at(-1)?.lessonTo, '');
	});

	it('keeps a lesson already on the visit when the section is opened', () => {
		const stored = { ...emptyShare(), lesson: LESSON_3, lessonFrom: '3', lessonTo: '5' };
		const seen: VisitShare[] = [];
		const root = new Modal(null).contentEl;
		mountShareFields(root, options(studyPrefill(null), stored), (next) => { seen.push(next); });
		clickLabeled(root as never, 'Studied a lesson?');
		assert.equal(seen.length, 0);
	});

	it('uses the same collapsed section on Log visit, past visit, edit, and New RV', () => {
		const source = readFileSync('src/main.ts', 'utf8');
		const fields = source.slice(source.indexOf('private shareFieldOptions'), source.indexOf('private async studyDefaults'));
		assert.match(fields, /showLesson:\s*false/);
		assert.match(fields, /optionalLesson:\s*true/);
		assert.match(fields, /lessonPrefill:\s*defaults/);
		assert.match(fields, /initial:\s*emptyShare\(\)/);
		assert.equal(fields.includes('showLesson: true'), false);
		const edit = source.slice(source.indexOf('private async openEditVisit'), source.indexOf('private confirmDeleteVisit'));
		assert.match(edit, /share:\s*this\.shareFieldOptions\(study, defaults\)/);
		assert.equal(edit.includes('openLesson'), false);
		const newRv = readFileSync('src/new-rv-modal.ts', 'utf8');
		assert.match(newRv, /showLesson:\s*false/);
		assert.match(newRv, /optionalLesson:\s*true/);
		assert.match(newRv, /lessonPrefill:\s*studyPrefill\(null/);
		const suggest = readFileSync('src/suggest-field.ts', 'utf8');
		assert.equal(suggest.includes("addEventListener('focus'"), false);

		const logged: VisitShare[] = [];
		const log = new LiteraturePromptModal({} as never, options(), (share) => { logged.push(share as VisitShare); });
		log.open();
		clickLabeled(log.contentEl as never, 'Log visit');
		assert.equal(logged[0]?.lesson, '');
		const studied: VisitShare[] = [];
		const again = new LiteraturePromptModal({} as never, options(), (share) => { studied.push(share as VisitShare); });
		again.open();
		clickLabeled(again.contentEl as never, 'Studied a lesson?');
		clickLabeled(again.contentEl as never, 'Log visit');
		assert.equal(studied[0]?.lesson, LESSON_1);
		assert.equal(studied[0]?.lessonFrom, 'Intro');
		assert.equal(studied[0]?.lessonTo, 'Review');

		const shared: VisitShare[] = [];
		const companion = new CompanionSuggestModal({} as never, [], () => {}, null, {
			...options(),
			onShare: (share) => { shared.push(share); },
		});
		companion.open();
		clickLabeled(companion.contentEl as never, 'Studied a lesson?');
		assert.equal(shared.at(-1)?.lesson, LESSON_1);

		const past: Array<{ lesson?: string; lessonFrom?: string; lessonTo?: string }> = [];
		const pastModal = new VisitEditModal({} as never, {
			title: 'Log past visit',
			recentCompanions: [],
			share: options(),
			onSave: (facts) => { past.push(facts); },
		});
		pastModal.open();
		clickLabeled(pastModal.contentEl as never, 'Studied a lesson?');
		clickLabeled(pastModal.contentEl as never, 'Save');
		assert.equal(past[0]?.lesson, LESSON_1);
		const body = insertVisit('', {
			when: new Date(2026, 8, 9, 14),
			home: true,
			companion: '',
			lesson: past[0]?.lesson,
			lessonFrom: past[0]?.lessonFrom,
			lessonTo: past[0]?.lessonTo,
		}, { now: new Date(2026, 8, 10, 12) });
		assert.equal(body.split('#####').length - 1, 1);
		assert.equal(body.includes(`«lesson» «${LESSON_1}» «Intro»–«Review»`), true);

		const note = [
			'### Recent Notes:',
			`##### Sat, 10am — Sep 26, 2026 · «lesson» «${LESSON_1}» «Intro»–«Review» <span class="rv-stamp-ago">3 days ago</span>`,
			'`INPUT[textArea:sVisit1Notes]`',
			'Kept note.',
			'',
			'> [!example] Return Suggestions',
			'> > [!note]- Attempt Log',
			'> >- Sat, 10am — Sep 26, 2026 — success',
		].join('\n');
		const entry = listVisits(note)[0];
		assert.ok(entry);
		assert.equal(entry.lesson, LESSON_1);
		const edited: Array<{ lesson?: string }> = [];
		const editModal = new VisitEditModal({} as never, {
			title: 'Edit visit',
			initial: entry,
			recentCompanions: [],
			share: options(studyPrefill({ lesson: LESSON_1, to: 'Review' })),
			onSave: (facts) => { edited.push(facts); },
		});
		editModal.open();
		clickLabeled(editModal.contentEl as never, 'Studied a lesson?');
		clickLabeled(editModal.contentEl as never, 'Save');
		assert.equal(edited[0]?.lesson, LESSON_1);
		const replaced = editVisit(note, entry, {
			when: entry.when,
			home: true,
			companion: '',
			lesson: LESSON_2,
			lessonFrom: 'Intro',
			lessonTo: 'Review',
		}, new Date(2026, 8, 29, 12));
		assert.equal(replaced.split('\n').filter((line) => line.startsWith('#####')).length, 1);
		assert.equal(replaced.includes(`«lesson» «${LESSON_2}» «Intro»–«Review»`), true);
		assert.equal(replaced.includes(LESSON_1), false);
		assert.match(replaced, /`INPUT\[textArea:sVisit1Notes\]`/);
		assert.match(replaced, /Kept note\./);
		const frontmatter: Record<string, unknown> = {
			Studies: 1,
			'Lessons Studied': [LESSON_1],
			'Last Studied': '2026-09-20T10:00:00',
		};
		applyVisitChangeFrontmatter(frontmatter, {
			removed: entry,
			added: {
				when: entry.when,
				home: true,
				companion: '',
				lesson: LESSON_2,
				lessonFrom: 'Intro',
				lessonTo: 'Review',
			},
			remaining: [],
		});
		assert.equal(frontmatter.Studies, 1);
		assert.equal(frontmatter['Last Studied'], '2026-09-26T10:00:00');
		assert.deepEqual(frontmatter['Lessons Studied'], [LESSON_2]);
	});
});

describe('hub pin scroll and narrow stack', () => {
	it('stacks the in-hub map on a phone and on a narrow desktop pane', () => {
		assert.equal(hubUsesStackedMap(true, 1200), true);
		assert.equal(hubUsesStackedMap(false, 335), true);
		assert.equal(hubUsesStackedMap(false, 390), true);
		assert.equal(hubUsesStackedMap(false, HUB_STACK_BELOW_PX - 1), true);
		assert.equal(hubUsesStackedMap(false, HUB_STACK_BELOW_PX), false);
		assert.equal(hubUsesStackedMap(false, 0), false);
		assert.equal(hubUsesStackedMap(false, 0, true), true);
		const glance = readFileSync('src/glancable-view.ts', 'utf8');
		const main = readFileSync('src/main.ts', 'utf8');
		assert.match(glance, /ensureHubScroller\(\)/);
		assert.match(glance, /registerHubScroller\(\(path\) => this\.flashCard\(path\)\)/);
		assert.equal(glance.includes('if (!(Platform.isMobile || Platform.isMobileApp)) return;'), false);
		assert.match(glance, /hubUsesStackedMap\(Boolean\(Platform\.isMobile \|\| Platform\.isMobileApp\), width, this\.plugin\.hubPaneNarrow\)/);
		assert.match(main, /Platform\.isMobile \|\| Platform\.isMobileApp \|\| this\.hubPaneNarrow/);
	});

	it('scrolls the Glancable .rv-locator-scroll column to the tapped card and flashes it', () => {
		const host = globalThis as { HTMLElement?: new () => object };
		if (typeof host.HTMLElement !== 'function') host.HTMLElement = class HTMLElement {};
		const Base = host.HTMLElement as new () => object;
		class Box extends Base {
			parentElement: Box | null = null;
			ownerDocument: { defaultView: { getComputedStyle(node: Box): { overflowY: string; overflow: string } } };
			classList: { contains(name: string): boolean; add(name: string): void };
			scrollTop = 0;
			clientHeight = 0;
			scrollHeight = 0;
			offsetHeight = 0;
			offsetTop = 0;
			private names = new Set<string>();
			private rect = { top: 0, height: 0 };
			constructor(className: string) {
				super();
				for (const name of className.split(/\s+/)) if (name) this.names.add(name);
				this.classList = {
					contains: (name: string) => this.names.has(name),
					add: (name: string) => { this.names.add(name); },
				};
				this.ownerDocument = {
					defaultView: {
						getComputedStyle: (node: Box) => ({ overflowY: node.overflowY, overflow: 'visible' }),
					},
				};
			}
			overflowY = 'visible';
			append(child: Box): void {
				child.parentElement = this;
			}
			closest(selector: string): Box | null {
				const name = selector.startsWith('.') ? selector.slice(1) : selector;
				let cursor: Box | null = this;
				while (cursor) {
					if (cursor.names.has(name)) return cursor;
					cursor = cursor.parentElement;
				}
				return null;
			}
			getBoundingClientRect(): { top: number; height: number } {
				return this.rect;
			}
			place(top: number, height: number): void {
				this.rect = { top, height };
				this.offsetHeight = height;
			}
			scrollIntoView(): void { /* the scrollTop write is the assertion */ }
		}
		const leaf = new Box('workspace-leaf-content');
		const view = new Box('view-content');
		view.overflowY = 'auto';
		view.clientHeight = 800;
		view.scrollHeight = 3000;
		view.place(0, 800);
		const root = new Box('rv-locator-view rv-locator-glancable');
		const scroll = new Box('rv-locator-scroll');
		scroll.clientHeight = 335;
		scroll.scrollHeight = 2400;
		scroll.place(40, 335);
		const card = new Box('rv-locator-card');
		card.place(940, 90);
		leaf.append(view);
		view.append(root);
		root.append(scroll);
		scroll.append(card);
		revealHubCard(scroll as unknown as HTMLElement, card as unknown as HTMLElement);
		assert.equal(scroll.scrollTop, 900 - (335 - 90) / 2);
		assert.equal(view.scrollTop, 940 - (800 - 90) / 2);
		assert.equal(card.classList.contains('rv-card-flash'), true);
		assert.equal(root.scrollTop, 0);
	});
});
