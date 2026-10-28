import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
	LESSONS,
	MEDIA_TITLES,
	NORMAL_LESSON_PARTS,
	PUBLICATION_TITLES,
	REVIEW_QUESTION_COUNTS,
	catalogSuggestions,
	deleteCustom,
	formatStudyFraction,
	lessonPartOptions,
	mediaAliasIndex,
	nextStudyStart,
	publicationAliasIndex,
	rankSuggestions,
	rememberCustom,
	renameCustom,
	emptyShare,
	lessonPillLabel,
	renameLabelInMarkdown,
	shareFromNewRvDraft,
	shareTitles,
	splitTitleSuffix,
	type LessonSpec,
} from '../src/catalog';
import { formatLessonLine, partwayCopy } from '../src/lesson-stops';
import { formatGlanceableCounter } from '../src/dates';
import { CARD_BLANK_IGNORE, cardBlankOpensPin, clusterAppearance, mapPressIsClick, MAP_CLICK_SLOP_PX, orderByHubSort, pinStackZ, popupClearOfChrome, pinStateIcon, rankPinsFromRenderedList, zoomToRevealPin, type MapPin } from '../src/map-pins';
import { SORT_PRESETS, visibleSortPresets } from '../src/active-layout';
import { controlButtonWidth, equalPillWidth, glanceBarHeight, glancePillContentPx, glancePillsThatFit, horizontalScrollDelta, sortLabelFontPx, sortPillSize } from '../src/sort-pills';
import { sideMapMinPx, stackedEmbedCap, stackedStageSplit } from '../src/hub-layout';
import { filtersDifferFromDefault } from '../src/status';
import { openDesktopDatePicker } from '../src/modal-chrome';
import { defaultSortChips } from '../src/types';
import { interpolatePalette, shadeHeats } from '../src/map-shade';
import { insidePriorityFloor } from '../src/scoring';
import { glanceRecordFromNote, matchesGlanceQuery, parseGlanceQuery, type GlanceRecord } from '../src/glance-search';
import { visitButtonLightness } from '../src/visit-buttons';
import { DEFAULT_IDEALITY_FLOOR_DAYS, compactModeFrom, mergeSettings } from '../src/types';
import { newestLessonEnd, shareFromLine, visitExtraMarkup } from '../src/visit-share';

/** Counts ids, classes (including those inside :not/:is), and elements. Enough to compare these selectors. */
function selectorSpecificity(selector: string): [number, number, number] {
	const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
	const classes = selector.match(/\.[\w-]+/g)?.length ?? 0;
	const without = selector
		.replace(/#[\w-]+/g, ' ')
		.replace(/\.[\w-]+/g, ' ')
		.replace(/::[\w-]+/g, ' ')
		.replace(/:[\w-]+(\([^)]*\))?/g, ' ');
	const elements = without.match(/[a-zA-Z][\w-]*/g)?.length ?? 0;
	return [ids, classes, elements];
}

function beatsSpecificity(stronger: [number, number, number], weaker: [number, number, number]): boolean {
	for (let index = 0; index < 3; index += 1) {
		const left = stronger[index] ?? 0;
		const right = weaker[index] ?? 0;
		if (left !== right) return left > right;
	}
	return false;
}

describe('official catalogs', () => {
	it('loads the supplied titles and keeps aliases out of the row', () => {
		assert.equal(PUBLICATION_TITLES.length, 57);
		assert.equal(MEDIA_TITLES.length, 123);
		assert.equal(LESSONS.length, 64);
		assert.equal(PUBLICATION_TITLES[0], '"Can We Enjoy Life Forever?" Tiny Tract');
		assert.equal(LESSONS[12]?.title, 'Section 1 Review');
		assert.equal(LESSONS[12]?.reviewSection, 1);
		assert.equal(LESSONS.at(-1)?.title, 'Section 4 Review');
		assert.equal(PUBLICATION_TITLES.includes('Meeting Invite'), false);
		assert.equal(MEDIA_TITLES.some((title) => title.includes('Caleb and Sofia Video')), false);
		const ranked = catalogSuggestions(PUBLICATION_TITLES, [], 'meeting invite', publicationAliasIndex());
		assert.equal(ranked[0], '"Invitation to Congregation Meetings"');
		const media = catalogSuggestions(MEDIA_TITLES, [], 'precious caleb', mediaAliasIndex());
		assert.equal(media[0]?.includes('You Are Precious to Jehovah'), true);
		assert.equal(media[0]?.includes('Caleb and Sofia'), false);
		const parts = splitTitleSuffix('"Can We Enjoy Life Forever?" Tiny Tract');
		assert.equal(parts.suffix, 'Tiny Tract');
		assert.equal(parts.text.includes('Tiny Tract'), false);
	});

	it('shows a lesson pill as the number then the catalog title', () => {
		assert.equal(lessonPillLabel('Lesson 2'), '02 The Bible Gives Hope');
		assert.equal(lessonPillLabel('2 The Bible Gives Hope'), '02 The Bible Gives Hope');
		assert.equal(lessonPillLabel('Lesson 3 Pt 2'), 'Lesson 3 Pt 2');
	});

	it('keeps a typed title and ranks an exact match ahead of a close one', () => {
		const remembered = rememberCustom([], 'Truth Tract', PUBLICATION_TITLES);
		assert.deepEqual(remembered, ['Truth Tract']);
		assert.deepEqual(rememberCustom(remembered, 'Truth Tract', PUBLICATION_TITLES), remembered);
		const ranked = catalogSuggestions(['Enjoy Life Forever', 'Truth Tract'], ['Truth Tract'], 'Tru');
		assert.equal(ranked[0], 'Truth Tract');
		assert.deepEqual(rankSuggestions('enjoy lif f', ['Enjoy Life Forever', 'Other']), ['Enjoy Life Forever']);
		assert.deepEqual(rankSuggestions('', ['Newest', 'Older']), ['Newest', 'Older']);
	});

	it('renames notes and drops a custom entry from suggestions only', () => {
		const renamed = renameCustom(['Truth Tract', 'Other'], 'truth tract', 'Truth');
		assert.deepEqual(renamed, ['Truth', 'Other']);
		assert.deepEqual(deleteCustom(renamed, 'Truth'), ['Other']);
		const markdown = [
			'---',
			'Left Publications: Truth Tract',
			'Shared Media: Why Study',
			'---',
			'##### stamp <span class="rv-visit-extra rv-left-pub" data-label="Truth Tract" data-from="" data-to="">Left \'Truth Tract\'</span>',
		].join('\n');
		const next = renameLabelInMarkdown(markdown, 'Truth Tract', 'Truth');
		assert.match(next, /Left Publications: Truth$/m);
		assert.match(next, /data-label="Truth"/);
		assert.match(next, /Left 'Truth'/);
		assert.match(next, /Shared Media: Why Study/);
	});
});

describe('lesson sections', () => {
	it('uses intro, numbered points, and one Outro for an official lesson', () => {
		const lesson = LESSONS.find((item) => item.title.startsWith('12 '));
		assert.ok(lesson);
		assert.deepEqual(lessonPartOptions(lesson ?? null), ['Intro', '1', '2', '3', '4', '5', '6', 'Outro']);
		assert.equal(formatLessonLine(lesson?.title ?? '', '3'), 'Lesson 12, point 3');
		assert.equal(formatLessonLine(lesson?.title ?? '', 'Intro'), 'Lesson 12, Intro');
		assert.equal(formatLessonLine(lesson?.title ?? '', 'Outro'), 'Lesson 12, Outro');
		const review = LESSONS.find((item) => item.title === 'Section 1 Review');
		assert.equal(lessonPartOptions(review ?? null).length, 10);
		assert.equal(formatLessonLine('Section 1 Review', '4'), 'Section 1 Review, question 4');
		assert.deepEqual(partwayCopy(['Intro', '1', '2', '3'], 2), { done: 'Done through 2', next: 'Next time: point 3' });
	});

	it('uses intro through review for a normal lesson and question counts for a marked review', () => {
		const normal: LessonSpec = { title: 'Sample lesson', review: false };
		assert.deepEqual(lessonPartOptions(normal), [...NORMAL_LESSON_PARTS]);
		assert.equal(lessonPartOptions(null).length, NORMAL_LESSON_PARTS.length);
		assert.equal(lessonPartOptions({ title: 'Section one review', review: true, reviewSection: 1 }).length, REVIEW_QUESTION_COUNTS[1]);
		assert.equal(lessonPartOptions({ title: 'Section two review', review: true, reviewSection: 2 }).length, 15);
		assert.equal(lessonPartOptions({ title: 'Section three review', review: true, reviewSection: 3 }).length, 12);
		assert.equal(lessonPartOptions({ title: 'Section four review', review: true, reviewSection: 4 }).length, 12);
		assert.equal(lessonPartOptions({ title: 'Unmarked review', review: true })[0], '1');
		assert.equal(lessonPartOptions({ title: 'Unmarked review', review: true }).length, 10);
	});
});

describe('New RV share draft', () => {
	it('does not throw when a New RV draft has no publications', () => {
		const draft = {
			name: 'Ada',
			address: '1 Distant Road',
			priority: 1,
			publications: undefined,
			publicationList: undefined,
			media: undefined,
			mediaList: undefined,
			lesson: undefined,
			lessonFrom: undefined,
			lessonTo: undefined,
			extraLesson: undefined,
			notes: undefined,
			companion: undefined,
		};
		assert.equal(shareFromNewRvDraft(draft), null);
		assert.deepEqual(shareTitles(undefined), []);
		assert.deepEqual(shareTitles(undefined, [' Tract ', '']), ['Tract']);
		const written = shareFromNewRvDraft({
			publications: ' Tract ',
			media: undefined,
			lesson: undefined,
			notes: undefined,
			companion: ' Sam ',
		});
		assert.equal(written?.publications, 'Tract');
		assert.deepEqual(written?.publicationList, ['Tract']);
		assert.equal(written?.media, '');
		assert.equal(written?.lesson, '');
		assert.equal(written?.companion, 'Sam');
	});
});

describe('visit share markup', () => {
	it('round-trips the newest lesson end', () => {
		const share = { ...emptyShare(), publications: 'Tract', media: 'Video', lesson: 'Sample lesson', lessonFrom: 'Intro', lessonTo: '3' };
		const line = `##### Sat ${visitExtraMarkup(share)}`;
		const read = shareFromLine(line);
		assert.equal(read.publications, 'Tract');
		assert.equal(read.media, 'Video');
		assert.equal(read.lesson, 'Sample lesson');
		assert.equal(read.lessonFrom, 'Intro');
		assert.equal(read.lessonTo, '3');
		assert.equal(newestLessonEnd(`${line}\nolder`), '3');
		assert.match(line, /· «book» «Tract»/);
		assert.match(line, /· «film» «Video»/);
		assert.match(line, /· «lesson» «Sample lesson»/);
		assert.doesNotMatch(line, /Left|Shared|Covered/);
		assert.doesNotMatch(line, /<span/);
		const many = visitExtraMarkup({
			...emptyShare(),
			publications: 'Tract',
			publicationList: ['Tract', 'Brochure'],
			media: 'Video',
			mediaList: ['Video', 'Another film'],
		});
		assert.match(many, /· «book» «Tract» · «book» «Brochure» · «film» «Video» · «film» «Another film»/);
		const legacy = shareFromLine('##### Sat · Left «Tract» · Shared «Video» · Covered «Sample lesson» «Intro»–«3»');
		assert.equal(legacy.publications, 'Tract');
		assert.equal(legacy.media, 'Video');
		assert.equal(legacy.lesson, 'Sample lesson');
		assert.equal(legacy.lessonTo, '3');
	});

	it('advances a finished lesson and stays in a lesson that is still open', () => {
		const finished = nextStudyStart('01 How Can the Bible Help You?', 'Summary');
		assert.equal(finished.lesson, '02 The Bible Gives Hope');
		assert.equal(finished.from, 'Intro');
		const mid = nextStudyStart('01 How Can the Bible Help You?', '3');
		assert.equal(mid.lesson, '01 How Can the Bible Help You?');
		assert.equal(mid.from, '4');
		const review = nextStudyStart('12 What Will Help You to Keep Studying the Bible?', 'Summary');
		assert.equal(review.lesson, 'Section 1 Review');
		assert.equal(review.from, '1');
		assert.deepEqual(formatStudyFraction(2, 6, 'lessons-studies'), { ratio: '2/6', withDecimal: '2/6 (0.33)' });
		assert.equal(formatStudyFraction(2, 6, 'studies-lessons').ratio, '6/2');
	});
});

describe('glanceable counters and floors', () => {
	it('counts days, then weeks, then months, then years', () => {
		assert.equal(formatGlanceableCounter(0), '0d');
		assert.equal(formatGlanceableCounter(1), '1d');
		assert.equal(formatGlanceableCounter(14), '14d');
		assert.equal(formatGlanceableCounter(21), '21d');
		assert.equal(formatGlanceableCounter(64), '64d');
		assert.equal(formatGlanceableCounter(365), '365d');
	});

	it('uses the recency floors as the ideality cliff', () => {
		assert.deepEqual(DEFAULT_IDEALITY_FLOOR_DAYS, { 1: 63, 2: 21, 3: 7, 4: 5, 5: 3 });
		assert.equal(insidePriorityFloor(2, 5, DEFAULT_IDEALITY_FLOOR_DAYS), true);
		assert.equal(insidePriorityFloor(3, 5, DEFAULT_IDEALITY_FLOOR_DAYS), false);
		assert.equal(insidePriorityFloor(62, 1, DEFAULT_IDEALITY_FLOOR_DAYS), true);
		assert.equal(insidePriorityFloor(63, 1, DEFAULT_IDEALITY_FLOOR_DAYS), false);
	});

	it('treats a missing compact key as on and an explicit off as off', () => {
		assert.equal(compactModeFrom({}), true);
		assert.equal(mergeSettings({}).compactMode, true);
		assert.equal(mergeSettings({}).leftAlignSuggestionBullets, true);
		assert.equal(mergeSettings({}).glancableIconScale, 1.2);
		assert.equal(mergeSettings({}).splitCityLine, false);
		assert.equal(mergeSettings({}).showStudyLiterature, false);
		assert.equal(mergeSettings({}).centerVisitNotes, true);
		assert.equal(mergeSettings({ centerVisitNotes: false }).centerVisitNotes, false);
		assert.equal(mergeSettings({}).studyRatio, 'lessons-studies');
		assert.equal(mergeSettings({ studyShowSpoke: true }).studyShowSpoke, true);
		assert.equal(mergeSettings({}).studyShowAttempted, false);
		assert.equal(mergeSettings({}).mapShade, 'urgency');
		assert.equal(mergeSettings({ mapShade: 'city' }).mapShade, 'city');
		assert.equal(mergeSettings({ mapShade: 'distance' as 'urgency' }).mapShade, 'urgency');
		assert.equal(compactModeFrom({ compactMode: false }), false);
		assert.equal(compactModeFrom({ compactCardDates: false }), false);
	});
});

function samplePin(patch: Partial<MapPin> = {}): MapPin {
	return {
		path: 'a.md',
		name: 'A',
		lat: 0,
		lon: 0,
		priority: 1,
		urgency: 1,
		days: 1,
		color: '#1f8a4c',
		glyph: '!',
		fresh: false,
		stateIcon: null,
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
		...patch,
	};
}

describe('map pin state and shade', () => {
	it('uses a distinct ghost icon and lets cooldown win', () => {
		assert.equal(pinStateIcon(true, false), 'hourglass');
		assert.equal(pinStateIcon(false, true), 'ban');
		assert.equal(pinStateIcon(true, true), 'hourglass');
		assert.equal(pinStateIcon(false, false), null);
	});

	it('shades every sort except nearness inside the palette', () => {
		const rows = [
			{ priority: 1, spokeDays: 1, attemptedDays: 2, metDays: 9, city: 'Austin', ideality: 0.2 },
			{ priority: 5, spokeDays: 40, attemptedDays: 3, metDays: 1, city: 'Zion', ideality: 0.9 },
		];
		assert.deepEqual(shadeHeats('urgency', rows), [0, 0]);
		assert.deepEqual(shadeHeats('priority', rows), [0, 1]);
		assert.equal(shadeHeats('city', rows)[0], 0);
		assert.equal(shadeHeats('city', rows)[1], 1);
		assert.equal(interpolatePalette(0, ['#000000', '#ffffff']), '#000000');
		assert.equal(interpolatePalette(1, ['#000000', '#ffffff']), '#ffffff');
		assert.equal(equalPillWidth([12, 40, 18]), 40);
	});

	it('colors a cluster from the most urgent pin and ghosts only an all-ghost cluster', () => {
		const low = samplePin({ urgency: 1, priority: 5, color: '#1f8a4c' });
		const high = samplePin({ path: 'b.md', urgency: 3, priority: 1, color: '#d63c3c' });
		const tied = samplePin({ path: 'c.md', urgency: 3, priority: 4, color: '#e06a00' });
		assert.deepEqual(clusterAppearance([low, high]), { color: '#d63c3c', ghost: false });
		assert.equal(clusterAppearance([high, tied]).color, '#e06a00');
		const ghosts = [
			samplePin({ stateIcon: 'hourglass', urgency: 0, color: '#d6a100', fresh: true }),
			samplePin({ path: 'b.md', stateIcon: 'ban', urgency: 2, color: '#d63c3c', fresh: false }),
		];
		assert.deepEqual(clusterAppearance(ghosts), { color: '#d63c3c', ghost: true });
		assert.equal(clusterAppearance([ghosts[0]!, low]).ghost, false);
		assert.equal(clusterAppearance([]).color, '');
		assert.equal(clusterAppearance([]).ghost, false);
	});

	it('treats a map press as a click only inside the slop', () => {
		assert.equal(mapPressIsClick(0, 0), true);
		assert.equal(mapPressIsClick(MAP_CLICK_SLOP_PX, 0), true);
		assert.equal(mapPressIsClick(3, 4), true);
		assert.equal(mapPressIsClick(MAP_CLICK_SLOP_PX + 1, 0), false);
		assert.equal(mapPressIsClick(4, 4), false);
	});
});

describe('in-note urgency chrome', () => {
	it('steps visit buttons, stretches the underlined address, tints hub text, and centers stamps', () => {
		const css = readFileSync(path.join(process.cwd(), 'styles.css'), 'utf8');
		assert.equal(/nth-child\(n\)[^{]*\{[^}]*--rv-visit-btn-bg:\s*var\(--rv-urgency-accent/.test(css), false);
		for (const child of [1, 2, 3, 4, 5]) {
			const block = css.match(new RegExp(String.raw`\.rv-dashboard \.mb-button-group\.mb-button-group > span\.mb-button\.rv-visit-btn:nth-child\(${child}\) > button\.mb-button-inner \{([^}]*)\}`))?.[1] ?? '';
			assert.match(block, /oklch\(from var\(--rv-urgency-accent, var\(--interactive-accent\)\) clamp\(0\.\d+, (?:l|calc\(l - 0\.\d+\)), 0\.\d+\) clamp\(0\.05, c, 0\.16\)/);
		}
		assert.match(css, /\.rv-dashboard \.mb-button-group\.mb-button-group > span\.mb-button\.rv-visit-btn:nth-child\(1\) > button\.mb-button-inner \{[^}]*clamp\(0\.46, l, 0\.80\)/);
		assert.match(css, /\.rv-visit-btn > button\.mb-button-inner svg \{\s*color: #fff;/);
		assert.match(css, /\.rv-dashboard textarea \{[^}]*font-family: var\(--font-interface/);
		assert.match(css, /\.rv-locator-sort-preset \{[^}]*padding: 2px 6px;[^}]*letter-spacing: -0\.02em;/);
		assert.doesNotMatch(css, /\.rv-sort-label \{[^}]*text-overflow: ellipsis/);
		const address = [...css.matchAll(/a\.rv-address-link \{([^}]*)\}/g)].map((match) => match[1] ?? '');
		assert.equal(address.some((block) => /justify-self:\s*start/.test(block)), false);
		const stretched = address.find((block) => /width:\s*100%/.test(block) && /justify-self:\s*stretch/.test(block) && /text-decoration:\s*underline/.test(block));
		assert.ok(stretched);
		const hubHover = [...css.matchAll(/\.markdown-preview-view \.rv-dashboard a\.internal-link\.rv-hub-chip:hover[^{]*\{([^}]*)\}/g)].at(-1)?.[1] ?? '';
		assert.match(hubHover, /color:\s*var\(--rv-urgency-accent, var\(--text-accent\)\)/);
		assert.doesNotMatch(hubHover, /text-decoration:\s*none/);
		assert.match(css, /body\.rv-center-visit-notes \.rv-dashboard :is\(h3, h5\)\.rv-visit-stamp > \.rv-stamp-lead \{[^}]*flex-grow:\s*0/);
		assert.match(css, /body\.rv-center-visit-notes \.rv-dashboard :is\(h3, h5\)\.rv-visit-stamp > \.rv-stamp-ago[^{]*\{[^}]*margin-left:\s*0/);
		assert.match(css, /\.workspace-leaf-content:not\(\.is-urgency-ready\) :is\([\s\S]*\.mb-button\.rv-visit-btn/);
		assert.match(css, /\.rv-map \.rv-map-pins > button\.rv-map-pin \{[^}]*background-color: var\(--background-secondary\);/);
		assert.match(css, /\.rv-map \.rv-map-pins > button\.rv-map-pin \{[^}]*background: linear-gradient\(color-mix\(in srgb, var\(--pin-color, var\(--interactive-accent\)\) 13%, transparent\), color-mix\(in srgb, var\(--pin-color, var\(--interactive-accent\)\) 13%, transparent\)\), var\(--background-secondary\);/);
		assert.match(css, /\.rv-map \.rv-map-pins > button\.rv-map-pin \{[^}]*color: var\(--pin-color, var\(--interactive-accent\)\)/);
		assert.match(css, /\.rv-map \.rv-map-pins > button\.rv-map-pin \.rv-urgency-glyph \{[^}]*color: var\(--pin-color, var\(--interactive-accent\)\)/);
		const ghostPin = css.match(/\.rv-map \.rv-map-pins > button\.rv-map-pin\.is-fresh \{([^}]*)\}/)?.[1] ?? '';
		assert.doesNotMatch(ghostPin, /transparent/);
		assert.match(ghostPin, /opacity:\s*1/);
		assert.match(ghostPin, /background-color: color-mix\(in srgb, var\(--background-primary\) 88%, var\(--background-primary\)\)/);
		assert.match(css, /\.rv-map \.rv-map-pins > button\.rv-map-pin\.is-fresh \{[^}]*border: 2\.5px dotted var\(--pin-color/);
		assert.match(css, /\.rv-map \.rv-map-pins > button\.rv-map-pin:not\(\.is-drop\) svg \{[^}]*width: 21px !important;[^}]*height: 21px !important/);
		assert.match(css, /\.rv-map \.rv-map-pins > button\.rv-map-pin\.is-drop \.rv-pin-shape svg \{[^}]*width: 42px !important;[^}]*height: 54px !important/);
		assert.doesNotMatch(css, /\.rv-map-card\.rv-locator-glancable \{[^}]*--rv-control-size: 38px/);
		assert.match(css, /\.rv-map-card \.rv-locator-urgency,\s*\n\.rv-map-card \.rv-locator-priority-pill,\s*\n\.rv-map-card \.rv-locator-map-pin \{[^}]*width: var\(--rv-control-size, 28px\)/);
		assert.match(css, /\.rv-map \.rv-map-pins > button\.rv-map-cluster \{[^}]*background-color: var\(--background-secondary\);/);
		assert.match(css, /\.rv-map \.rv-map-pins > button\.rv-map-cluster \{[^}]*background: linear-gradient\(color-mix\(in srgb, var\(--pin-color, var\(--interactive-accent\)\) 13%, transparent\), color-mix\(in srgb, var\(--pin-color, var\(--interactive-accent\)\) 13%, transparent\)\), var\(--background-secondary\);/);
		assert.match(css, /\.rv-map \.rv-map-pins > button\.rv-map-cluster\.is-fresh \{[^}]*border: 2\.5px dotted var\(--pin-color/);
		const themeButton = selectorSpecificity('button:not(.clickable-icon)');
		for (const selector of [
			'.rv-map .rv-map-pins > button.rv-map-pin',
			'.rv-map .rv-map-pins > button.rv-map-cluster',
		]) {
			assert.equal(beatsSpecificity(selectorSpecificity(selector), themeButton), true, selector);
		}
		assert.equal(
			beatsSpecificity(
				selectorSpecificity('.rv-map .rv-map-pins > button.rv-map-pin.is-fresh'),
				selectorSpecificity('.rv-map .rv-map-pins > button.rv-map-pin'),
			),
			true,
		);
		assert.equal(
			beatsSpecificity(
				selectorSpecificity('.rv-map .rv-map-pins > button.rv-map-cluster.is-fresh'),
				selectorSpecificity('.rv-map .rv-map-pins > button.rv-map-cluster'),
			),
			true,
		);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-search-slot \{/);
		assert.match(css, /:is\(\.rv-locator-view, \.rv-qf-badges, \.rv-map-card\) \.rv-locator-urgency \{/);
		const map = readFileSync(path.join(process.cwd(), 'src/map-view.ts'), 'utf8');
		assert.doesNotMatch(map, /file-text/);
		assert.match(map, /openMapNote\(pin\.path\)/);
		assert.match(map, /export const MAP_PIN_PX = 48/);
		assert.match(map, /export const MAP_PIN_GLYPH_PX = 29\.4/);
		assert.match(map, /export const MAP_CLUSTER_PX = 53/);
		assert.match(map, /sizePinGlyph\(head,/);
		assert.match(map, /paintGlanceCard\?\.\(shell, pin\.path\)/);
		assert.doesNotMatch(map, /MAP_POPUP_BADGE_PX/);
		assert.doesNotMatch(map, /getPropertyValue\('--rv-control-size'\)/);
		assert.equal(48, Math.round(42 * 1.15));
		assert.equal(21, Math.round(18 * 1.15));
		assert.equal(53, Math.round(46 * 1.15));
		assert.match(map, /groupPinStacks\(/);
		assert.doesNotMatch(map, /paintClusters\(/);
		assert.match(map, /mapPressIsClick\(/);
		assert.match(map, /rv-map-fullscreen/);
		assert.match(map, /arrow-left/);
		assert.doesNotMatch(map, /rv-map-back/);
		assert.doesNotMatch(map, /paintSorts/);
		const glance = readFileSync(path.join(process.cwd(), 'src/glancable-view.ts'), 'utf8');
		const nearby = readFileSync(path.join(process.cwd(), 'src/nearby-view.ts'), 'utf8');
		assert.match(glance, /searchReplacesBar/);
		assert.match(glance, /is-search-open/);
		assert.match(glance, /rv-locator-search-slot/);
		assert.match(nearby, /searchSlot/);
		assert.match(css, /width: 48px/);
		assert.match(css, /width: 21px !important/);
		assert.match(css, /width: 53px/);
		assert.doesNotMatch(css, /--rv-control-size: 38px/);
	});

	it('keeps the leftmost visit button on the accent and floors the darkest step', () => {
		const amber = 0.7386;
		assert.equal(visitButtonLightness(amber, 0), amber);
		const steps = [0, 1, 2, 3, 4].map((index) => visitButtonLightness(amber, index));
		assert.deepEqual(steps, [...steps].sort((a, b) => b - a));
		assert.ok((steps[4] ?? 0) >= 0.34);
		assert.ok((steps[0] ?? 0) > (steps[4] ?? 0));
		assert.equal(visitButtonLightness(0.95, 0), 0.8);
		assert.equal(visitButtonLightness(0.1, 0), 0.46);
		assert.equal(visitButtonLightness(0.1, 4), 0.34);
	});
});

describe('glancable smart search', () => {
	const now = new Date(2026, 9, 7, 15, 0, 0);
	const query = 'Met yesterday left brochure dog Jamie';

	function person(patch: Partial<GlanceRecord> = {}): GlanceRecord {
		return {
			name: 'Pat Example',
			address: '1 Main St',
			city: 'Austin',
			met: new Date(2026, 9, 6, 16, 30),
			spoke: new Date(2026, 8, 1, 10, 0),
			attempted: new Date(2026, 8, 2, 10, 0),
			studied: null,
			literature: 'Enjoy Life Forever Brochure',
			media: '',
			lessons: '',
			taken: '',
			notes: 'Talked about a dog named Jamie',
			...patch,
		};
	}

	it('matches met yesterday, a brochure, and both note words together', () => {
		const parsed = parseGlanceQuery(query, now);
		assert.equal(matchesGlanceQuery(person(), parsed), true);
		assert.equal(matchesGlanceQuery(person({ met: new Date(2026, 9, 7, 11, 0) }), parsed), false);
		assert.equal(matchesGlanceQuery(person({ literature: 'Something Tiny Tract' }), parsed), false);
		assert.equal(matchesGlanceQuery(person({ notes: 'Talked about a dog' }), parsed), false);
		assert.equal(matchesGlanceQuery(person({ spoke: new Date(2026, 9, 6, 16, 30), met: new Date(2026, 8, 1, 10, 0) }), parseGlanceQuery('Spoke yesterday', now)), true);
		assert.equal(matchesGlanceQuery(person(), parseGlanceQuery('Spoke yesterday', now)), false);
		assert.equal(matchesGlanceQuery(person(), parseGlanceQuery('', now)), true);
		assert.equal(matchesGlanceQuery(person(), parseGlanceQuery('Austin', now)), true);
	});

	it('sizes each sort pill to one control button', () => {
		const control = controlButtonWidth(260);
		const pill = sortPillSize(control);
		assert.equal(pill.width, `${control}px`);
		assert.equal(pill.minWidth, pill.width);
		assert.equal(pill.flexBasis, pill.width);
		assert.equal(pill.height, '40px');
		assert.equal(pill.flex, `0 0 ${control}px`);
		assert.equal(horizontalScrollDelta(0, 48, false), 48);
		assert.equal(horizontalScrollDelta(30, 4, false), 30);
		assert.equal(horizontalScrollDelta(0, 48, true), 48);
		const css = readFileSync(path.join(process.cwd(), 'styles.css'), 'utf8');
		assert.match(css, /touch-action:\s*pan-x !important/);
		assert.match(css, /\.rv-locator-sortbar:has\(> \.rv-sort-close\) \{\s*overflow:\s*visible !important/);
		assert.match(css, /\.rv-locator-sort-pills \{\s*display:\s*flex !important;\s*flex:\s*0 0 auto !important;\s*flex-wrap:\s*nowrap !important/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-sort-scroll \{[^}]*scrollbar-width:\s*none/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-sort-scroll::-webkit-scrollbar \{[^}]*display:\s*none;[^}]*height:\s*0/);
		assert.doesNotMatch(css, /\.rv-locator-sortbar:has\(> \.rv-sort-close\) \{[^}]*padding:\s*2px 4px 0 !important/);
		assert.match(css, /padding-bottom:\s*calc\(var\(--navbar-height, 52px\) \+ var\(--navbar-bottom-offset, 34px\) \+ 8px\)/);
		assert.match(css, /\.rv-locator-toolbar-actions > button \{[^}]*box-sizing:\s*border-box !important;[^}]*border-width:\s*1px !important/);
		assert.match(css, /\.rv-locator-toolbar-actions > \.rv-locator-new-rv \{[^}]*border-color:\s*transparent !important/);
		assert.equal(sortLabelFontPx(30, 40), 12);
		assert.equal(sortLabelFontPx(40, 40), 12);
		assert.equal(sortLabelFontPx(42, 40), 11.43);
		assert.equal(sortLabelFontPx(44, 40), 10.91);
		assert.equal(sortLabelFontPx(80, 40), 10);
	});

	it('stacks phone labels, fills the hub, and keeps the map credit on the map edge', () => {
		const css = readFileSync(path.join(process.cwd(), 'styles.css'), 'utf8');
		const snippet = readFileSync(path.join(process.cwd(), 'extras/templater-metabind/rv-dashboard.css'), 'utf8');
		const glance = readFileSync(path.join(process.cwd(), 'src/glancable-view.ts'), 'utf8');
		const map = readFileSync(path.join(process.cwd(), 'src/map-view.ts'), 'utf8');
		const modal = readFileSync(path.join(process.cwd(), 'src/new-rv-modal.ts'), 'utf8');
		assert.match(css, /grid-template-columns:\s*max-content minmax\(0, 1fr\)/);
		assert.match(snippet, /grid-template-columns:\s*max-content minmax\(0, 1fr\)/);
		assert.match(css, /p\.rv-hub-owned > strong[\s\S]*width:\s*max-content/);
		assert.doesNotMatch(css, /p\.rv-hub-owned > strong,\s*\n[\s\S]{0,240}text-overflow:\s*ellipsis/);
		assert.match(css, /\.rv-locator-view\.is-map-fullscreen \.rv-hub-map/);
		assert.match(css, /flex:\s*0 0 14px/);
		assert.match(css, /\.rv-hub-map-handle::before \{[^}]*height:\s*40px/);
		assert.match(css, /\.rv-map-credit \{[^}]*right:\s*0;[^}]*bottom:\s*0/);
		assert.match(css, /\.rv-map-credit,\s*\n\.rv-map-scale \{[^}]*font-size:\s*10px;[^}]*line-height:\s*14px/);
		assert.match(css, /\.rv-map-bar \{[^}]*flex-direction:\s*column/);
		assert.doesNotMatch(map, /aria-label': 'Zoom in'/);
		assert.match(map, /aria-label': 'Show all'/);
		assert.match(map, /invalidateSize/);
		assert.match(map, /applyRenderedOrder/);
		assert.match(glance, /publishPinOrder/);
		assert.match(css, /input\[type="date"\].*::-webkit-calendar-picker-indicator/);
		assert.match(css, /is-embed-capped/);
		assert.match(css, /\.rv-locator-view\.is-side-map \.rv-hub-map \{[^}]*min-height:\s*70vh/);
		assert.match(css, /font-size:\s*12px/);
		assert.doesNotMatch(css, /\.rv-locator-sort-pills \.rv-sort-label \{[^}]*text-overflow:\s*ellipsis/);
		const chips = visibleSortPresets(defaultSortChips()).length;
		assert.equal(glancePillContentPx(390, chips) > 42, true);
		assert.equal(glancePillContentPx(430, chips) > glancePillContentPx(390, chips), true);
		assert.equal(stackedEmbedCap(844, 110), 734);
		assert.deepEqual(stackedStageSplit(650), { cards: 363, map: 273 });
		assert.equal(sideMapMinPx(900), 630);
		assert.equal(filtersDifferFromDefault('active', 'all', 'all'), false);
		assert.equal(filtersDifferFromDefault('archive', 'all', 'all'), true);
		const shown = ['Dale', 'Marcus', 'Ada', 'Cy', 'Eve', 'Fay', 'Bo'];
		for (const preset of SORT_PRESETS) {
			const facts = shown.map((name, index) => ({
				name,
				lat: index,
				lon: index,
				priority: index + 1,
				days: index * 3,
				attemptedDays: 6 - index,
				metDays: index,
				city: name,
				ideality: index / 10,
			}));
			const sorted = orderByHubSort(facts, { property: preset.property, direction: preset.defaultDirection }, { lat: 0, lon: 0 }, { 1: 30, 2: 30, 3: 21, 4: 14, 5: 7 });
			const pins = sorted.map((row) => ({ path: row.name, rank: 0 }));
			const ranked = rankPinsFromRenderedList(pins.filter((pin) => pin.path !== 'Ada'), shown);
			assert.deepEqual(ranked.map((pin) => pin.path), shown.filter((name) => name !== 'Ada'));
			assert.equal(ranked.find((pin) => pin.path === 'Cy')?.rank, shown.indexOf('Cy'));
			assert.equal(ranked[0]?.rank, 0);
		}
		const shifted = popupClearOfChrome({ x: 400, y: 80 }, { width: 280, height: 160 }, { width: 480, height: 320 });
		assert.equal(shifted.left + 280 <= 480 - 56, true);
		const low = popupClearOfChrome({ x: 180, y: 800 }, { width: 280, height: 320 }, { width: 390, height: 844 });
		assert.equal(low.top >= 4, true);
		assert.equal(low.top + 320 <= 844 - 14, true);
		assert.equal(low.top + 320 < 800, true);
		let opened = 0;
		openDesktopDatePicker({ type: 'date', showPicker() { opened += 1; } } as HTMLInputElement, false);
		assert.equal(opened, 1);
		openDesktopDatePicker({ type: 'date', showPicker() { opened += 1; } } as HTMLInputElement, true);
		assert.equal(opened, 1);
		assert.match(css, /\.rv-hub-fill \{[^}]*padding-bottom:\s*0 !important/);
		assert.doesNotMatch(css, /[^-\w]height:\s*70vh/);
		assert.match(css, /min-height:\s*70vh/);
		assert.match(modal, /rv-locator-modal/);
		assert.match(css, /@media \(max-width: 520px\) \{[^}]*\.rv-locator-modal \.setting-item \{[^}]*flex-direction:\s*column !important/);
		assert.match(glance, /highlightMapPin/);
		assert.match(glance, /cardBlankOpensPin/);
		assert.match(map, /popupPath/);
		assert.match(map, /zoomToRevealPin/);
		assert.match(map, /focus: \(path, center, source\) => \{ this\.focusPath\(path, center, source\)/);
		assert.match(map, /clearPinFlash/);
		assert.doesNotMatch(map, /openCard\(pins, selected\.pin/);
		assert.equal(glancePillsThatFit(390, chips), chips);
		assert.equal(glancePillsThatFit(430, chips), chips);
		assert.equal(glanceBarHeight(), 84);
		assert.equal(cardBlankOpensPin(false, false), false);
		assert.equal(cardBlankOpensPin(true, true), false);
		assert.equal(cardBlankOpensPin(true, false), true);
		assert.match(CARD_BLANK_IGNORE, /button/);
		assert.equal(zoomToRevealPin(12), 13);
		assert.equal(zoomToRevealPin(15), 15);
		assert.ok(pinStackZ(0) > pinStackZ(3));
		assert.ok(pinStackZ(4, true) > pinStackZ(0));
		const ranked = orderByHubSort([
			{ name: 'Low', lat: 0, lon: 0, priority: 1, days: 1, attemptedDays: 1, metDays: 1, city: 'A', ideality: 0.1 },
			{ name: 'High', lat: 0, lon: 0, priority: 5, days: 40, attemptedDays: 2, metDays: 2, city: 'B', ideality: 0.9 },
		], { property: 'note.Priority', direction: 'DESC' }, null, { 1: 30, 2: 30, 3: 21, 4: 14, 5: 7 });
		assert.equal(ranked[0]?.name, 'High');
		assert.equal(ranked[1]?.name, 'Low');
	});

	it('reads visit notes and stamp literature off the note', () => {
		const record = glanceRecordFromNote({
			name: 'Pat Example',
			address: '1 Main St',
			city: '',
			frontmatter: {
				Met: '2026-10-06T16:30',
				City: 'Austin',
				'sVisit1Notes': 'Talked about a dog named Jamie',
			},
			body: '##### Tue, 4pm — Oct 6, 2026 · «book» «Enjoy Life Forever Brochure»',
		});
		assert.equal(matchesGlanceQuery(record, parseGlanceQuery(query, now)), true);
	});
});

describe('round 1.3.5 callouts, embeds, and modals', () => {
	const read = (file: string): string => readFileSync(path.join(process.cwd(), file), 'utf8');

	it('paints the map popup with the glancable card and keeps one list scroller', () => {
		const map = read('src/map-view.ts');
		const glance = read('src/glancable-view.ts');
		const css = read('styles.css');
		assert.match(glance, /paintCardForPath/);
		assert.match(glance, /registerGlancePainter/);
		assert.match(map, /paintGlanceCard/);
		assert.match(map, /popupCardWidth/);
		assert.match(map, /glanceLayoutWidth/);
		assert.match(map, /glancableCardWidthPx/);
		assert.match(glance, /glancableCardWidthPx/);
		assert.match(read('src/main.ts'), /popupLeafPx/);
		assert.match(read('src/main.ts'), /popupScrollbarPx/);
		assert.doesNotMatch(map, /frame\.width - 24/);
		assert.doesNotMatch(read('src/sort-pills.ts'), /containSortRow/);
		assert.doesNotMatch(glance, /containSortRow/);
		assert.doesNotMatch(map, /private dateSlot\(/);
		assert.match(css, /\.rv-map-card \{[^}]*width:\s*auto/);
		assert.doesNotMatch(css, /min\(20rem/);
		assert.match(css, /\.rv-dashboard \.rv-map-open \{/);
		assert.doesNotMatch(css, /(^|\n)\.rv-map-open \{/);
		assert.match(read('src/main.ts'), /paintNoteGlanceCard/);
		assert.match(css, /\.rv-locator-view\.is-side-map \.rv-hub-map \{[^}]*min-height:\s*70vh/);
		assert.match(css, /\.rv-locator-view\.is-side-map,\s*\n\.rv-locator-view\.is-side-map \.rv-locator-stage[\s\S]*min-height:\s*0 !important/);
		assert.match(css, /\.view-content:has\(\.rv-locator-view\.is-side-map\)/);
		assert.doesNotMatch(glance, /padding-right', '0'/);
	});

	it('shows Man and Woman, edits attributes, and keeps a normal embed unless the class is set', () => {
		const modal = read('src/new-rv-modal.ts');
		const chrome = read('src/note-chrome.ts');
		const glance = read('src/glancable-view.ts');
		const settings = read('src/settings-tab.ts');
		const css = read('styles.css');
		const mount = modal.slice(modal.indexOf('export function mountGenderButton'), modal.indexOf('export interface AttributeDraft'));
		assert.match(mount, /setIcon\(el, icon\)/);
		assert.match(mount, /rv-gender-word/);
		assert.ok(mount.indexOf('setIcon(el, icon)') < mount.indexOf('rv-gender-word'));
		assert.match(modal, /setTitle\('Edit attributes'\)/);
		assert.match(modal, /rv-attr-fields/);
		assert.match(chrome, /aria-label': 'Edit attributes'/);
		const dash = chrome.slice(chrome.indexOf('function decorateDashboardHeading'), chrome.indexOf('function decorateNoteTitle'));
		assert.match(dash, /more-horizontal/);
		assert.match(dash, /renameNote\(path\)/);
		assert.doesNotMatch(dash, /new Menu|sliders-horizontal/);
		assert.doesNotMatch(chrome, /aria-label': 'Rename'/);
		assert.match(css, /\.rv-edit-attributes \.rv-attr-fields > \.setting-item\.rv-gender-choice \{[^}]*margin-top:\s*12px !important/);
		assert.match(glance, /rv-locator-full-base/);
		assert.match(glance, /wideHubFrame/);
		assert.match(settings, /Copy class/);
		assert.match(settings, /rv-locator-full-base/);
		assert.match(css, /\.markdown-preview-view\.rv-locator-full-base \.inline-title/);
		assert.match(css, /\.markdown-preview-view\.rv-locator-full-base \.metadata-container/);
		assert.match(css, /--file-line-width:\s*100%/);
		assert.match(css, /\.markdown-preview-view\.rv-locator-full-base\.is-readable-line-width \.markdown-preview-sizer,\s*\n\.markdown-source-view\.rv-locator-full-base \.cm-sizer,[\s\S]*max-width:\s*none !important/);
		const main = read('src/main.ts');
		assert.match(main, /reopenRenamedNote/);
		assert.match(main, /preview\.rerender\(true\)/);
		assert.match(main, /type: 'empty'/);
		assert.match(main, /\.mb-unloaded/);
		assert.match(main, /holdNoteView/);
		assert.match(main, /getEphemeralState/);
		assert.match(main, /keepRenameMode/);
		assert.match(main, /reopenSameLeaf/);
		assert.doesNotMatch(main, /reopenDetachedLeaf/);
		assert.doesNotMatch(main, /leaf\.detach\(\)/);
		const sameLeaf = main.slice(main.indexOf('private async reopenSameLeaf'), main.indexOf('private applyHeldScroll'));
		assert.match(sameLeaf, /setViewState\(\{ type: 'empty', state: \{\} \}\)/);
		assert.match(sameLeaf, /leaf\.openFile\(file/);
		assert.doesNotMatch(sameLeaf, /getLeaf\('tab'\)/);
		assert.match(main, /FOCUS_ATTEMPTS = 80/);
		const focus = main.slice(main.indexOf('private async focusVisitNotes'), main.indexOf('private openPicker'));
		assert.match(focus, /setActiveLeaf\(leaf, \{ focus: true \}\)/);
		assert.match(focus, /armVisitNoteFocus\(view\.containerEl, name \?\? ''/);
		assert.match(css, /\.modal\.rv-edit-attributes \.rv-modal-actions \{[^}]*margin-top:\s*12px !important/);
		assert.match(css, /--file-margins:\s*0px/);
		const visit = read('src/visit-display.ts');
		const arm = visit.slice(visit.indexOf('export function armVisitNoteFocus'), visit.indexOf('export function placeVisitNoteFocus'));
		assert.match(arm, /requestAnimationFrame/);
		assert.match(arm, /placeCaret/);
		assert.doesNotMatch(arm, /setTimeout/);
	});

	it('marks unknown home counties, enlarges callout titles, and pads the study block', () => {
		const settings = read('src/settings-tab.ts');
		const css = read('styles.css');
		const main = read('src/main.ts');
		const chrome = read('src/note-chrome.ts');
		assert.match(settings, /rv-county-chip/);
		assert.match(settings, /is-invalid/);
		assert.match(css, /\.rv-county-chip\.is-invalid/);
		assert.match(css, /font-size: 16px;\s*\n\tline-height: 1\.2/);
		assert.match(css, /\.rv-locator-modal \.rv-study-optional \{[^}]*border-top: 1px solid var\(--background-modifier-border\)/);
		assert.match(css, /\.rv-locator-companion-modal \.rv-locator-suggest-actions\.rv-modal-actions \{[^}]*padding-top: 12px/);
		assert.match(main, /quietCreateGeocode/);
		assert.match(chrome, /column-gap', '8px'/);
		assert.match(chrome, /grid-template-columns', 'subgrid'/);
		assert.match(chrome, /width', 'max-content'/);
		assert.match(chrome, /justify-self', 'end'/);
		assert.match(css, /justify-self: end !important/);
		assert.match(css, /\.rv-modal-section \{[^}]*margin-top:\s*12px/);
		assert.match(css, /\.rv-modal-section \{[^}]*padding-top:\s*12px/);
		assert.match(css, /\.rv-locator-modal \.rv-share-list \{[^}]*border-top: 1px solid var\(--background-modifier-border\)/);
		assert.match(css, /\.rv-locator-modal \.rv-share-list \{[^}]*margin-top:\s*12px/);
		assert.match(css, /\.rv-share-list \+ \.rv-share-list \{[^}]*margin-top:\s*12px/);
	});
});
