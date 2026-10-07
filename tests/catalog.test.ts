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
	renameLabelInMarkdown,
	splitTitleSuffix,
	type LessonSpec,
} from '../src/catalog';
import { formatGlanceableCounter } from '../src/dates';
import { pinStateIcon } from '../src/map-pins';
import { interpolatePalette, shadeHeats } from '../src/map-shade';
import { insidePriorityFloor } from '../src/scoring';
import { equalPillWidth } from '../src/sort-pills';
import { DEFAULT_IDEALITY_FLOOR_DAYS, compactModeFrom, mergeSettings } from '../src/types';
import { newestLessonEnd, shareFromLine, visitExtraMarkup } from '../src/visit-share';

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
		assert.equal(formatGlanceableCounter(0), 'Today');
		assert.equal(formatGlanceableCounter(1), '1 day');
		assert.equal(formatGlanceableCounter(20), '20 days');
		assert.equal(formatGlanceableCounter(21), '3 weeks');
		assert.equal(formatGlanceableCounter(63), '9 weeks');
		assert.equal(formatGlanceableCounter(64), '2 months');
		assert.equal(formatGlanceableCounter(365), '12 months');
		assert.equal(formatGlanceableCounter(366), '1 year');
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
});

describe('in-note urgency chrome', () => {
	it('steps visit buttons, stretches the underlined address, tints hub text, and centers stamps', () => {
		const css = readFileSync(path.join(process.cwd(), 'styles.css'), 'utf8');
		assert.equal(/nth-child\(n\)[^{]*\{[^}]*--rv-visit-btn-bg:\s*var\(--rv-urgency-accent/.test(css), false);
		for (const child of [1, 2, 3, 4, 5]) {
			const block = css.match(new RegExp(String.raw`\.rv-dashboard \.mb-button-group\.mb-button-group > span\.mb-button\.rv-visit-btn:nth-child\(${child}\) > button\.mb-button-inner \{([^}]*)\}`))?.[1] ?? '';
			assert.match(block, /oklch\(from var\(--rv-urgency-accent, var\(--interactive-accent\)\)/);
		}
		const address = [...css.matchAll(/a\.rv-address-link \{([^}]*)\}/g)].map((match) => match[1] ?? '');
		assert.equal(address.some((block) => /justify-self:\s*start/.test(block)), false);
		const stretched = address.find((block) => /width:\s*100%/.test(block) && /justify-self:\s*stretch/.test(block) && /text-decoration:\s*underline/.test(block));
		assert.ok(stretched);
		const hubHover = [...css.matchAll(/\.markdown-preview-view \.rv-dashboard a\.internal-link\.rv-hub-chip:hover[^{]*\{([^}]*)\}/g)].at(-1)?.[1] ?? '';
		assert.match(hubHover, /color:\s*var\(--rv-urgency-accent, var\(--text-accent\)\)/);
		assert.doesNotMatch(hubHover, /text-decoration:\s*none/);
		assert.match(css, /body\.rv-center-visit-notes \.rv-dashboard :is\(h3, h5\)\.rv-visit-stamp > \.rv-stamp-lead \{[^}]*flex-grow:\s*0/);
		assert.match(css, /body\.rv-center-visit-notes \.rv-dashboard :is\(h3, h5\)\.rv-visit-stamp > \.rv-stamp-ago[^{]*\{[^}]*margin-left:\s*0/);
	});
});
