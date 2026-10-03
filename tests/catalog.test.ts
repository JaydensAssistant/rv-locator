import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	LESSONS,
	MEDIA_TITLES,
	NORMAL_LESSON_PARTS,
	PUBLICATION_TITLES,
	REVIEW_QUESTION_COUNTS,
	catalogSuggestions,
	deleteCustom,
	lessonPartOptions,
	rankSuggestions,
	rememberCustom,
	renameCustom,
	emptyShare,
	renameLabelInMarkdown,
	type LessonSpec,
} from '../src/catalog';
import { formatGlanceableCounter } from '../src/dates';
import { insidePriorityFloor } from '../src/scoring';
import { DEFAULT_IDEALITY_FLOOR_DAYS, compactModeFrom, mergeSettings } from '../src/types';
import { newestLessonEnd, shareFromLine, visitExtraMarkup } from '../src/visit-share';

describe('empty catalogs', () => {
	it('ships with no official titles', () => {
		assert.deepEqual(PUBLICATION_TITLES, []);
		assert.deepEqual(MEDIA_TITLES, []);
		assert.deepEqual(LESSONS, []);
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
		assert.equal(compactModeFrom({ compactMode: false }), false);
		assert.equal(compactModeFrom({ compactCardDates: false }), false);
	});
});
