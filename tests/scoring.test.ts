import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { visibleSortPresets } from '../src/active-layout';
import { digestVoiceClass, formatDigestNote, upsertAttemptDigest } from '../src/attempt-digest';
import { calloutTypeForAccent, calloutTypeForChoice } from '../src/suggestion-callout';
import { classifyChromeControl } from '../src/glancable-chrome';
import { IDEALITY_COLUMN_ID } from '../src/constants';
import { glancableColumns } from '../src/glancable-density';
import { displayedUrgency, likelihoodForNow } from '../src/row-score';
import {
	IDEALITY_ALPHA,
	LIKELIHOOD_EMPTY_FLOOR,
	LIKELIHOOD_HOME_CAP,
	URGENCY_RAMP_DAYS,
	URGENCY_RAMP_POWER,
	distanceWeight,
	idealityScore,
	likelihoodMultiplier,
	urgencyAccentColor,
	urgencyBand,
	urgencyBangShapes,
	urgencyGlyphMarkup,
	urgencyMark,
	urgencyScore,
} from '../src/scoring';
import {
	daypartAt,
	defaultAvailabilityGrid,
	laplaceRate,
	migrateAvailabilityGrid,
	parseAttemptLog,
	readAttemptLog,
	sampleConfidence,
	slotScore,
	suggestReturnDigest,
	type AttemptBuckets,
} from '../src/schedule';
import { formatSnoozeUntil, parseSnoozeUntil, snoozeActive, URGENCY_SNOOZE_PROPERTY } from '../src/snooze';
import { settingsGraphs } from '../src/settings-graphs';
import { applyVisitBody, ensureVisitNotesHeading, refreshHomeStampAges, shouldNudgePriority } from '../src/visit-log';
import {
	DEFAULT_IDEALITY_FLOOR_DAYS,
	DEFAULT_TERRITORY_SPAN_MILES,
	DEFAULT_URGENCY_THRESHOLD_DAYS,
	mergeSettings,
} from '../src/types';

const thresholds = DEFAULT_URGENCY_THRESHOLD_DAYS;
const floors = DEFAULT_IDEALITY_FLOOR_DAYS;
const span = DEFAULT_TERRITORY_SPAN_MILES;

describe('urgency', () => {
	it('divides days by the priority threshold and keeps growing past 1', () => {
		assert.equal(urgencyScore(4, 5, thresholds), 1);
		assert.equal(urgencyScore(7, 4, thresholds), 1);
		assert.equal(urgencyScore(21, 3, thresholds), 1);
		assert.equal(urgencyScore(63, 2, thresholds), 1);
		assert.equal(urgencyScore(189, 1, thresholds), 1);
		assert.equal(urgencyScore(8, 5, thresholds), 2);
		assert.ok((urgencyScore(400, 1, thresholds) ?? 0) > 1);
		assert.equal(urgencyScore(12, 5, { ...thresholds, 5: 10 }), 1.2);
	});

	it('ramps toward 0 under 3 days for every priority and is full at day 3', () => {
		assert.equal(URGENCY_RAMP_DAYS, 3);
		assert.equal(urgencyScore(0, 5, thresholds), 0);
		assert.equal(urgencyScore(0, 1, thresholds), 0);
		assert.equal(URGENCY_RAMP_POWER, 2);
		assert.equal(urgencyScore(1.5, 5, thresholds), (1.5 / 4) * ((1.5 / 3) ** 2));
		assert.equal(urgencyScore(1.5, 1, thresholds), (1.5 / 189) * ((1.5 / 3) ** 2));
		assert.equal(urgencyScore(3, 5, thresholds), 3 / 4);
		assert.equal(urgencyScore(3, 1, thresholds), 3 / 189);
		const twoDays = urgencyScore(2, 5, thresholds);
		assert.equal(twoDays, (2 / 4) * ((2 / 3) ** 2));
		assert.ok(twoDays != null && twoDays < 0.35);
		assert.equal(urgencyScore(null, 5, thresholds), null);
		assert.equal(urgencyScore(10, 0, thresholds), null);
		assert.equal(urgencyScore(10, null, thresholds), null);
	});

	it('uses three bands: a circle, then one to three marks, with a hard color jump', () => {
		assert.equal(urgencyBand(0.99), 0);
		assert.equal(urgencyBand(1), 1);
		assert.equal(urgencyBand(1.9), 1);
		assert.equal(urgencyBand(2), 2);
		assert.equal(urgencyBand(2.9), 2);
		assert.equal(urgencyBand(3), 3);
		assert.equal(urgencyBand(4), 3);
		assert.equal(urgencyBand(5), 3);
		assert.equal(urgencyBand(9.2), 3);
		assert.deepEqual(urgencyMark(0.4, 4), { glyphs: '○', band: 0 });
		assert.deepEqual(urgencyMark(1, 4), { glyphs: '!', band: 1 });
		assert.deepEqual(urgencyMark(2, 4), { glyphs: '!!', band: 2 });
		assert.deepEqual(urgencyMark(3, 4), { glyphs: '!!!', band: 3 });
		assert.deepEqual(urgencyMark(8, 4), { glyphs: '!!!', band: 3 });
		assert.deepEqual(urgencyMark(8, 0), { glyphs: '', band: 0 });
		assert.equal(urgencyAccentColor(0), '#1f8a4c');
		assert.equal(urgencyAccentColor(1), '#d6a100');
		assert.equal(urgencyAccentColor(2), '#e06a00');
		assert.equal(urgencyAccentColor(3), '#d63c3c');
		assert.equal(urgencyAccentColor(5), urgencyAccentColor(12));
		assert.notEqual(urgencyAccentColor(0), urgencyAccentColor(1));
		assert.notEqual(urgencyAccentColor(1), urgencyAccentColor(5));
		assert.equal(urgencyAccentColor(2, 0), 'var(--text-faint)');
	});

	it('holds displayed urgency at 0 while a snooze is still ahead', () => {
		assert.equal(URGENCY_SNOOZE_PROPERTY, 'Urgency Snooze');
		const now = new Date(2026, 8, 29, 9, 0, 0);
		assert.equal(formatSnoozeUntil('today', now), '2026-09-29T23:59:59');
		const until = parseSnoozeUntil(formatSnoozeUntil('today', now));
		assert.equal(snoozeActive(until, now), true);
		assert.equal(snoozeActive(until, new Date(2026, 8, 30, 0, 0, 0)), false);
		const week = parseSnoozeUntil(formatSnoozeUntil('7', now));
		assert.equal(week?.getTime(), now.getTime() + 7 * 24 * 60 * 60 * 1000);
		const fortnight = parseSnoozeUntil(formatSnoozeUntil('14', now));
		assert.equal(fortnight?.getTime(), now.getTime() + 14 * 24 * 60 * 60 * 1000);
		assert.equal(displayedUrgency(8, 5, { urgencyThresholdDays: thresholds }, until, now), 0);
		assert.equal(displayedUrgency(8, 0, { urgencyThresholdDays: thresholds }, until, now), null);
		assert.equal(displayedUrgency(4, 5, { urgencyThresholdDays: thresholds }, null, now), 1);
	});
});

describe('ideality', () => {
	it('lands near 1 at both anchors and follows territory span', () => {
		assert.equal(IDEALITY_ALPHA, 0.555);
		const due = idealityScore({
			days: 4,
			priority: 5,
			miles: span,
			thresholds,
			floors,
			territorySpan: span,
		});
		const far = idealityScore({
			days: 42,
			priority: 1,
			miles: 1,
			thresholds,
			floors,
			territorySpan: span,
		});
		assert.ok(due != null && Math.abs(due - 1) < 0.01);
		assert.ok(far != null && Math.abs(far - 1) < 0.01);
		const wider = idealityScore({
			days: 4,
			priority: 5,
			miles: 30,
			thresholds,
			floors,
			territorySpan: 30,
		});
		assert.ok(wider != null && Math.abs(wider - 1) < 0.01);
		const closer = idealityScore({
			days: 4,
			priority: 5,
			miles: 15,
			thresholds,
			floors,
			territorySpan: 30,
		});
		assert.ok(closer != null && Math.abs((closer) - (2 ** IDEALITY_ALPHA)) < 0.01);
		const onTop = idealityScore({
			days: 4,
			priority: 5,
			miles: 0,
			thresholds,
			floors,
			territorySpan: span,
		});
		assert.ok(onTop != null && Number.isFinite(onTop) && onTop > 1);
		assert.equal(idealityScore({
			days: 4,
			priority: 5,
			miles: null,
			thresholds,
			floors,
			territorySpan: span,
		}), null);
		assert.equal(distanceWeight(span, span), 1);
	});

	it('fades inside each priority floor instead of cutting off', () => {
		const inside = idealityScore({
			days: 1,
			priority: 5,
			miles: span,
			thresholds,
			floors,
			territorySpan: span,
		});
		assert.ok(inside != null && Math.abs(inside - (1 / 108)) < 1e-9);
		const atFloor = idealityScore({
			days: 3,
			priority: 5,
			miles: span,
			thresholds,
			floors,
			territorySpan: span,
		});
		assert.equal(atFloor, (3 / 4));
		const p4 = idealityScore({
			days: 2,
			priority: 4,
			miles: span,
			thresholds,
			floors,
			territorySpan: span,
		});
		assert.ok(p4 != null && Math.abs(p4 - (4 / 63)) < 1e-9);
		const custom = idealityScore({
			days: 5,
			priority: 5,
			miles: span,
			thresholds,
			floors: { ...floors, 5: 10 },
			territorySpan: span,
		});
		const unfaded = idealityScore({
			days: 5,
			priority: 5,
			miles: span,
			thresholds,
			floors: { ...floors, 5: 3 },
			territorySpan: span,
		});
		assert.ok(custom != null && unfaded != null && Math.abs(custom - unfaded * 0.5) < 1e-9);
		assert.equal(idealityScore({
			days: 0,
			priority: 5,
			miles: span,
			thresholds,
			floors,
			territorySpan: span,
		}), 0);
	});

	it('holds distance at 1 for the planner', () => {
		const held = idealityScore({
			days: 4,
			priority: 5,
			miles: 1,
			thresholds,
			floors,
			territorySpan: span,
			holdDistance: true,
		});
		assert.equal(held, 1);
	});
});

describe('dayparts and return suggester', () => {
	it('starts evening at 4:30 and keeps the other boundaries', () => {
		const at = (hour: number, minute: number) => daypartAt(new Date(2026, 8, 25, hour, minute, 0));
		assert.equal(at(0, 0), 'morning');
		assert.equal(at(9, 29), 'morning');
		assert.equal(at(9, 30), 'morning');
		assert.equal(at(11, 59), 'morning');
		assert.equal(at(12, 0), 'afternoon');
		assert.equal(at(16, 29), 'afternoon');
		assert.equal(at(16, 30), 'evening');
		assert.equal(at(23, 59), 'evening');
	});

	it('reads Attempt Log stamps into weekday × daypart buckets', () => {
		const evening = applyVisitBody('', 'home', new Date(2026, 8, 26, 16, 30, 0));
		const eveningBuckets = parseAttemptLog(evening);
		assert.deepEqual(eveningBuckets['6:evening'], { homes: 1, trials: 1 });
		const afternoon = applyVisitBody('', 'miss', new Date(2026, 8, 25, 16, 29, 0));
		assert.deepEqual(parseAttemptLog(afternoon)['5:afternoon'], { homes: 0, trials: 1 });
		const split = parseAttemptLog([
			'> [!note]- Attempt Log',
			'> - Wed, 10am — Sep 23, 2026 — not home',
			'> - Sat, 10am — Sep 26, 2026 — success',
			'### Sat, 10am — Sep 26, 2026',
		].join('\n'));
		assert.deepEqual(split['3:morning'], { homes: 0, trials: 1 });
		assert.deepEqual(split['6:morning'], { homes: 1, trials: 1 });
		assert.equal(split['3:morning']?.homes, 0);
	});

	it('scores may-go-out slots with the Laplace rate and confidence', () => {
		assert.equal(laplaceRate(1, 5), 2 / 7);
		assert.equal(laplaceRate(0, 0), 0.5);
		assert.equal(laplaceRate(5, 10), 0.5);
		assert.equal(sampleConfidence(0), 0);
		assert.equal(sampleConfidence(5), 5 / 8);
		const half = slotScore(5, 10, 'may');
		const miss = slotScore(0, 10, 'may');
		const untried = slotScore(0, 0, 'may');
		const off = slotScore(5, 10, 'off');
		assert.ok(Math.abs(half - (0.5 * (10 / 13))) < 1e-12);
		assert.ok(half > miss);
		assert.ok(miss > untried);
		assert.equal(untried, 0);
		assert.equal(off, 0);
		assert.ok(half > 0.3);
	});

	it('tables only may-go-out dayparts and names dayparts in the footers', () => {
		const buckets: AttemptBuckets = {
			'5:morning': { homes: 1, trials: 5 },
			'5:afternoon': { homes: 1, trials: 5 },
			'5:evening': { homes: 1, trials: 5 },
		};
		const grid = defaultAvailabilityGrid();
		grid['5:morning'] = 'may';
		grid['5:afternoon'] = 'may';
		grid['5:evening'] = 'may';
		grid['6:morning'] = 'may';
		const digest = suggestReturnDigest({
			buckets,
			grid,
			now: new Date(2026, 8, 24, 12, 0, 0),
		});
		assert.equal(digest.table, [
			'| | Morning | Afternoon | Evening |',
			'| --- | --- | --- | --- |',
			'| Sun | 0/0 | 0/0 | 0/0 |',
			'| Mon | 0/0 | 0/0 | 0/0 |',
			'| Tue | 0/0 | 0/0 | 0/0 |',
			'| Wed | 0/0 | 0/0 | 0/0 |',
			'| Thu | 0/0 | 0/0 | 0/0 |',
			'| Fri | 1/5 | 1/5 | 1/5 |',
			'| Sat | 0/0 | 0/0 | 0/0 |',
		].join('\n'));
		assert.equal(digest.table.includes('—'), false);
		const mayDays = suggestReturnDigest({
			buckets,
			grid,
			days: 'may',
			now: new Date(2026, 8, 24, 12, 0, 0),
		});
		assert.equal(mayDays.table, [
			'| | Morning | Afternoon | Evening |',
			'| --- | --- | --- | --- |',
			'| Fri | 1/5 | 1/5 | 1/5 |',
			'| Sat | 0/0 | — | — |',
		].join('\n'));
		assert.deepEqual(digest.sentences, [
			'Avoid: **Fri morning/afternoon/evening (1/5)**',
			'Untried: Sat',
		]);
		assert.match(digest.table, /^\| \| Morning \|/);
		assert.equal(digest.markdown.includes('— Home'), false);
		assert.equal(digest.markdown.includes('— Not home'), false);
		assert.equal(digest.markdown.includes('Try:'), false);
		assert.equal(digest.markdown.includes('Nothing stands out'), false);
		assert.equal(digest.markdown.includes('has not been tried'), false);
		assert.equal(digest.markdown.startsWith(digest.table), true);
		assert.equal(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/.test(digest.markdown), false);
		assert.equal(/\b(Alright|You've|always|never|do that)\b/i.test(digest.markdown), false);
		const columns = suggestReturnDigest({
			buckets,
			grid,
			orientation: 'columns',
			now: new Date(2026, 8, 24, 12, 0, 0),
		});
		assert.equal(columns.table, [
			'| | Sun | Mon | Tue | Wed | Thu | Fri | Sat |',
			'| --- | --- | --- | --- | --- | --- | --- | --- |',
			'| Morning | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 1/5 | 0/0 |',
			'| Afternoon | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 1/5 | 0/0 |',
			'| Evening | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 1/5 | 0/0 |',
		].join('\n'));
		const empty = suggestReturnDigest({ buckets: {}, grid: defaultAvailabilityGrid() });
		assert.equal(empty.sentences[0], 'No May-go-out days');
		assert.match(empty.table, /\| Sun \| 0\/0 \| 0\/0 \| 0\/0 \|/);
		assert.match(empty.table, /\| Sat \| 0\/0 \| 0\/0 \| 0\/0 \|/);
		assert.equal(empty.table.includes('—'), false);
		const mayEmpty = suggestReturnDigest({ buckets: {}, grid: defaultAvailabilityGrid(), days: 'may' });
		assert.equal(mayEmpty.markdown, 'No May-go-out days');
		assert.equal(mayEmpty.table, '');

		const halfGrid = defaultAvailabilityGrid();
		halfGrid['3:evening'] = 'may';
		const half = suggestReturnDigest({
			buckets: { '3:evening': { homes: 5, trials: 10 } },
			grid: halfGrid,
			now: new Date(2026, 8, 24, 12, 0, 0),
		});
		assert.deepEqual(half.sentences, ['Try: **Wed evening (5/10)**']);
		assert.equal(half.markdown.includes('Avoid:'), false);
		assert.equal(half.markdown.includes('Untried:'), false);
	});

	it('buckets may-go-out cells by soft rate and omits empty lines', () => {
		const one = voiceFor({ '5:morning': { homes: 1, trials: 1 } }, ['5:morning']);
		assert.deepEqual(one, ['Try: **Fri morning (1/1)**']);
		const miss = voiceFor({ '5:morning': { homes: 0, trials: 1 } }, ['5:morning']);
		assert.deepEqual(miss, ['Unsure: Fri morning (0/1)']);
		const strong = voiceFor({ '5:morning': { homes: 2, trials: 5 } }, ['5:morning']);
		assert.deepEqual(strong, ['Try: **Fri morning (2/5)**']);
		const cold = voiceFor({ '5:morning': { homes: 1, trials: 5 } }, ['5:morning']);
		assert.deepEqual(cold, ['Avoid: **Fri morning (1/5)**']);
		const thin = voiceFor({ '5:morning': { homes: 1, trials: 4 } }, ['5:morning']);
		assert.deepEqual(thin, ['Unsure: Fri morning (1/4)']);
		const empty = voiceFor({ '5:morning': { homes: 0, trials: 3 } }, ['5:morning']);
		assert.deepEqual(empty, ['Avoid: **Fri morning (0/3)**']);
		assert.equal(empty.some((line) => line.startsWith('Try:')), false);

		const tied = voiceFor({
			'6:afternoon': { homes: 1, trials: 1 },
			'6:evening': { homes: 2, trials: 2 },
			'6:morning': { homes: 1, trials: 1 },
		}, ['6:morning', '6:afternoon', '6:evening']);
		assert.equal(tied[0], 'Try: **Sat evening (2/2)** · Sat morning (1/1) · Sat afternoon (1/1)');
		const same = voiceFor({
			'6:afternoon': { homes: 1, trials: 1 },
			'6:evening': { homes: 1, trials: 1 },
		}, ['6:afternoon', '6:evening']);
		assert.equal(same[0], 'Try: **Sat afternoon (1/1)** · **Sat evening (1/1)**');

		const collapsed = voiceFor({}, ['3:morning', '3:afternoon', '3:evening', '5:morning', '5:afternoon']);
		assert.deepEqual(collapsed, ['Untried: Wed · Fri']);
		const partialDay = voiceFor(
			{ '5:evening': { homes: 1, trials: 1 } },
			['5:morning', '5:afternoon', '5:evening'],
		);
		assert.equal(partialDay[0], 'Try: **Fri evening (1/1)**');
		assert.equal(partialDay[1], 'Untried: Fri morning/afternoon');
		const mixed = voiceFor({
			'5:morning': { homes: 0, trials: 1 },
			'5:afternoon': { homes: 0, trials: 1 },
		}, ['5:morning', '5:afternoon', '5:evening']);
		assert.deepEqual(mixed, [
			'Unsure: Fri morning/afternoon (0/1)',
			'Untried: Fri evening',
		]);
	});

	it('lists Avoid, Try, Unsure, then Untried and bolds every worst Avoid tie', () => {
		const lines = voiceFor({
			'1:morning': { homes: 0, trials: 1 },
			'2:evening': { homes: 0, trials: 0 },
			'3:afternoon': { homes: 1, trials: 1 },
			'5:morning': { homes: 0, trials: 3 },
			'6:evening': { homes: 0, trials: 3 },
			'6:afternoon': { homes: 1, trials: 5 },
		}, ['1:morning', '2:evening', '3:afternoon', '5:morning', '6:afternoon', '6:evening']);
		assert.deepEqual(lines, [
			'Avoid: **Fri morning (0/3)** · Sat afternoon (1/5) · **Sat evening (0/3)**',
			'Try: **Wed afternoon (1/1)**',
			'Unsure: Mon morning (0/1)',
			'Untried: Tue',
		]);
		assert.equal(lines.some((line) => line.startsWith('Try:')) , true);
		const noTry = voiceFor({
			'5:morning': { homes: 0, trials: 3 },
		}, ['5:morning']);
		assert.equal(noTry.some((line) => line.startsWith('Try:')), false);
	});

	it('counts Home and Not home from Attempt Log stamps, not a stale 0/0 table', () => {
		const note = [
			'> [!note]- Attempt Log',
			'> <!-- rv-locator-digest -->',
			'> | Wed | 0/0 | 0/0 | — |',
			'> <!-- /rv-locator-digest -->',
			'> - Wed, 2pm — Sep 9, 2026 — success',
			'> - Wed, 10am — Sep 16, 2026 — not home',
			'### Wed, 2pm — Sep 9, 2026',
		].join('\n');
		const log = readAttemptLog(note);
		assert.deepEqual(log.buckets['3:afternoon'], { homes: 1, trials: 1 });
		assert.deepEqual(log.buckets['3:morning'], { homes: 0, trials: 1 });
		assert.equal(log.entries.length, 2);
		const grid = defaultAvailabilityGrid();
		grid['3:morning'] = 'may';
		grid['3:afternoon'] = 'may';
		const digest = suggestReturnDigest({
			buckets: log.buckets,
			entries: log.entries,
			grid,
			now: new Date(2026, 8, 24, 12, 0, 0),
		});
		assert.match(digest.table, /\| Wed \| 0\/1 \| 1\/1 \| 0\/0 \|/);
		assert.match(digest.table, /\| Sun \| 0\/0 \| 0\/0 \| 0\/0 \|/);
		assert.equal(digest.table.includes('—'), false);
		assert.equal(digest.markdown.includes('Wed, 2pm — Sep 9, 2026 — Home'), false);
		assert.equal(digest.markdown.includes('Wed, 10am — Sep 16, 2026 — Not home'), false);
		assert.equal(digest.sentences[0]?.startsWith('Try:'), true);
		const homeWord = readAttemptLog('> - Fri, 1pm — Sep 18, 2026 — Home');
		assert.deepEqual(homeWord.buckets['5:afternoon'], { homes: 1, trials: 1 });
		const headingsOnly = readAttemptLog('### Wed, 2pm — Sep 9, 2026 <span class="rv-stamp-ago">20 days ago</span>');
		assert.deepEqual(headingsOnly.buckets['3:afternoon'], { homes: 1, trials: 1 });
		assert.equal(digestVoiceClass('Try: **Sat evening (2/2)**'.replaceAll('**', '')), 'is-try');
		assert.equal(digestVoiceClass('Untried: Wed'), 'is-untried');
		assert.equal(digestVoiceClass('Unsure: Fri morning (0/1)'), 'is-unsure');
		assert.equal(digestVoiceClass('Avoid: Wed evening (0/4)'), 'is-avoid');
		assert.equal(digestVoiceClass('Wed, 2pm — Sep 9, 2026 — Home'), 'is-history');
	});

	it('asks for priority only on every Nth home', () => {
		assert.equal(shouldNudgePriority('home', 1, 3), false);
		assert.equal(shouldNudgePriority('home', 2, 3), false);
		assert.equal(shouldNudgePriority('home', 3, 3), true);
		assert.equal(shouldNudgePriority('home', 6, 3), true);
		assert.equal(shouldNudgePriority('miss', 3, 3), false);
		assert.equal(shouldNudgePriority('miss', 2, 3), false);
		assert.equal(shouldNudgePriority('unknown', 3, 3), false);
		assert.equal(shouldNudgePriority('home', 2, 2), true);
		assert.equal(shouldNudgePriority('miss', 2, 2), false);
	});

	it('resets an untouched willing grid and keeps a real choice as may go out', () => {
		const legacy: Record<string, string> = {};
		for (let weekday = 0; weekday < 7; weekday += 1) {
			for (const daypart of ['early-morning', 'late-morning', 'afternoon', 'evening']) {
				legacy[`${weekday}:${daypart}`] = 'willing';
			}
		}
		assert.equal(Object.values(migrateAvailabilityGrid(legacy)).every((level) => level === 'off'), true);
		const chosen = {
			...legacy,
			'1:evening': 'go-out',
			'2:early-morning': 'off',
			'2:late-morning': 'willing',
		};
		const next = migrateAvailabilityGrid(chosen);
		assert.equal(next['1:evening'], 'may');
		assert.equal(next['1:morning'], 'may');
		assert.equal(next['2:morning'], 'may');
		assert.equal(next['0:afternoon'], 'may');
		const partial = migrateAvailabilityGrid({ '4:afternoon': 'willing' });
		assert.equal(partial['4:afternoon'], 'may');
		assert.equal(partial['4:morning'], 'off');
		const fresh = defaultAvailabilityGrid();
		fresh['0:evening'] = 'may';
		assert.equal(migrateAvailabilityGrid(fresh)['0:evening'], 'may');
	});

	it('keeps days as rows unless the user swapped to columns', () => {
		const settings = mergeSettings(undefined);
		assert.equal(settings.digestOrientation, 'rows');
		assert.equal(settings.digestDays, 'all');
		assert.equal(mergeSettings({ digestOrientation: 'columns' }).digestOrientation, 'columns');
		assert.equal(mergeSettings({ digestOrientation: 'rows' }).digestOrientation, 'rows');
		assert.equal(mergeSettings({ digestDays: 'may' }).digestDays, 'may');
		assert.equal(mergeSettings({}).digestDays, 'all');
		assert.equal(mergeSettings({}).suggestionColor, 'auto');
		assert.equal(mergeSettings({ suggestionColor: 'grey' }).suggestionColor, 'grey');
		assert.equal(mergeSettings({ suggestionColor: 'example' }).suggestionColor, 'auto');
		const grid = defaultAvailabilityGrid();
		grid['0:morning'] = 'may';
		grid['0:afternoon'] = 'may';
		const digest = suggestReturnDigest({ buckets: {}, grid });
		assert.match(digest.table, /^\| \| Morning \| Afternoon \|/);
		assert.match(digest.table, /\| Sun \| 0\/0 \| 0\/0 \| 0\/0 \|/);
		assert.match(digest.table, /\| Sat \| 0\/0 \| 0\/0 \| 0\/0 \|/);
		assert.equal(digest.table.includes('—'), false);
		assert.equal(/^\| Morning \|/m.test(digest.table), false);
		const mayOnly = suggestReturnDigest({ buckets: {}, grid, days: 'may' });
		assert.equal(mayOnly.table.includes('| Mon |'), false);
		assert.match(mayOnly.table, /\| Sun \| 0\/0 \| 0\/0 \|/);
	});

	it('shows real counts on off days in all-weekdays mode and dashes only in may-go-out mode', () => {
		const grid = defaultAvailabilityGrid();
		grid['2:afternoon'] = 'may';
		grid['5:morning'] = 'may';
		grid['5:evening'] = 'may';
		const buckets: AttemptBuckets = {
			'2:afternoon': { homes: 1, trials: 1 },
			'0:morning': { homes: 2, trials: 3 },
		};
		const all = suggestReturnDigest({ buckets, grid });
		assert.match(all.table, /\| Sun \| 2\/3 \| 0\/0 \| 0\/0 \|/);
		assert.match(all.table, /\| Tue \| 0\/0 \| 1\/1 \| 0\/0 \|/);
		assert.equal(all.table.includes('—'), false);
		assert.equal(all.sentences.join('\n').includes('Sun'), false);
		const may = suggestReturnDigest({ buckets, grid, days: 'may' });
		assert.equal(may.table.includes('| Sun |'), false);
		assert.match(may.table, /\| Tue \| — \| 1\/1 \| — \|/);
	});

	it('maps the theme accent to a Return Suggestions callout and lets the color setting win', () => {
		assert.equal(calloutTypeForAccent({ h: 210, s: 80, l: 50 }), 'info');
		assert.equal(calloutTypeForAccent({ h: 120, s: 60, l: 40 }), 'success');
		assert.equal(calloutTypeForAccent({ h: 40, s: 90, l: 50 }), 'warning');
		assert.equal(calloutTypeForAccent({ h: 5, s: 70, l: 50 }), 'failure');
		assert.equal(calloutTypeForAccent({ h: 355, s: 70, l: 20 }), 'danger');
		assert.equal(calloutTypeForAccent({ h: 330, s: 60, l: 45 }), 'bug');
		assert.equal(calloutTypeForAccent({ h: 280, s: 70, l: 55 }), 'example');
		assert.equal(calloutTypeForAccent({ h: 200, s: 5, l: 40 }), 'quote');
		assert.equal(calloutTypeForAccent(null), 'example');
		assert.equal(calloutTypeForChoice('blue', { h: 280, s: 80, l: 50 }), 'info');
		assert.equal(calloutTypeForChoice('auto', { h: 280, s: 80, l: 50 }), 'example');
		assert.equal(calloutTypeForChoice('dark-red', null), 'danger');
		assert.equal(calloutTypeForChoice('not-a-color', { h: 120, s: 80, l: 40 }), 'success');
		const grid = defaultAvailabilityGrid();
		const digest = suggestReturnDigest({ buckets: {}, grid, days: 'may' });
		const note = [
			'### Visit Notes:',
			'##### Mon, 9am — Sep 1, 2026 <span class="rv-stamp-ago">1 day ago</span>',
			'',
			'> [!example] Return Suggestions',
			'> No May-go-out days',
			'>',
			'> > [!note]- Attempt Log',
			'> >',
			'> >- Mon, 9am — Sep 1, 2026 — success',
			'',
		].join('\n');
		const purple = upsertAttemptDigest(note, digest, { suggestionType: 'example' });
		const blue = upsertAttemptDigest(note, digest, { suggestionType: calloutTypeForChoice('blue', null) });
		assert.equal(purple?.includes('> [!example] Return Suggestions'), true);
		assert.equal(blue?.includes('> [!info] Return Suggestions'), true);
		assert.equal(blue?.includes('> [!example] Return Suggestions'), false);
		assert.equal(blue?.includes('> >- Mon, 9am — Sep 1, 2026 — success'), true);
		assert.equal(ensureVisitNotesHeading('##### Tue, 2pm — Sep 9, 2026 <span class="rv-stamp-ago">0 days ago</span>\n').startsWith('### Visit Notes:\n#####'), true);
		assert.equal(ensureVisitNotesHeading('### Visit Notes:\n##### Tue, 2pm — Sep 9, 2026\n').split('### Visit Notes:').length, 2);
	});

	it('places the suggester quote above Attempt Log and the table inside it', () => {
		const grid = defaultAvailabilityGrid();
		grid['1:morning'] = 'may';
		grid['1:evening'] = 'may';
		const digest = suggestReturnDigest({
			buckets: {
				'1:morning': { homes: 0, trials: 4 },
				'1:evening': { homes: 2, trials: 2 },
			},
			grid,
			days: 'may',
		});
		const body = formatDigestNote(digest);
		assert.equal(body.includes(digest.table), false);
		assert.equal(body.startsWith('> Avoid:'), true);
		assert.ok(body.indexOf('> Avoid:') < body.indexOf('> Try:'));
		assert.equal(body.includes('> [!note]'), false);
		const note = [
			'### Mon, 9am — Sep 1, 2026',
			'',
			'%% rv-locator-digest %%',
			'',
			digest.table,
			'',
			'> Avoid: old',
			'> Try: old',
			'',
			'%% /rv-locator-digest %%',
			'',
			'> [!note]+ Attempt Log',
			'> <!-- rv-locator-digest -->',
			'> | Mon | 0/0 |',
			'> <!-- /rv-locator-digest -->',
			'> - Mon, 9am — Sep 1, 2026 — success',
			'',
		].join('\n');
		const next = upsertAttemptDigest(note, digest, { suggestionType: 'example' });
		assert.ok(next);
		const lines = (next ?? '').split('\n');
		const suggestionsAt = lines.findIndex((line) => line === '> [!example] Return Suggestions');
		const avoidAt = lines.findIndex((line) => line.startsWith('> Avoid:'));
		const tryAt = lines.findIndex((line) => line.startsWith('> Try:'));
		const logAt = lines.findIndex((line) => line === '> > [!note]+ Attempt Log');
		const tableAt = lines.findIndex((line) => line.startsWith('> >| |'));
		const bulletAt = lines.findIndex((line) => line.startsWith('> >- Mon, 9am'));
		assert.ok(suggestionsAt >= 0 && suggestionsAt < avoidAt && avoidAt < tryAt && tryAt < logAt && logAt < tableAt && tableAt < bulletAt);
		assert.equal(lines[logAt - 1], '>');
		assert.equal(lines[logAt + 1], '> >');
		assert.equal(lines.includes('%% rv-locator-digest %%'), false);
		assert.equal(lines.includes('%% /rv-locator-digest %%'), false);
		assert.equal(lines.includes('<!-- rv-locator-digest -->'), false);
		assert.equal(lines.includes('> <!-- rv-locator-digest -->'), false);
		assert.equal(lines.filter((line) => line.startsWith('| |')).length, 0);
		assert.equal(lines.includes('> [!note]+ Attempt Log'), false);
		assert.equal(next, upsertAttemptDigest(next ?? '', digest, { suggestionType: 'example' }));
		const switched = upsertAttemptDigest(next ?? '', digest, { suggestionType: 'info' });
		assert.equal(switched?.includes('> [!info] Return Suggestions'), true);
		assert.equal(switched?.includes('> [!example] Return Suggestions'), false);
		assert.equal(switched?.includes('> > [!note]+ Attempt Log'), true);
		const noSchedule = { table: '', sentences: ['No May-go-out days'], text: 'No May-go-out days' };
		const closed = upsertAttemptDigest('> [!note]- Attempt Log\n> - old — success\n', noSchedule);
		assert.equal(closed, [
			'> [!example] Return Suggestions',
			'> No May-go-out days',
			'>',
			'> > [!note]- Attempt Log',
			'> >',
			'> >- old — success',
			'',
		].join('\n'));
		const collapsed = upsertAttemptDigest('> [!note]+ Attempt Log\n> - old — success\n', noSchedule, { collapse: true });
		assert.equal(collapsed?.includes('> > [!note]- Attempt Log'), true);
		assert.equal(collapsed?.includes('[!note]+ Attempt Log'), false);
		const kept = upsertAttemptDigest('> [!note]+ Attempt Log\n> - old — success\n', noSchedule);
		assert.equal(kept?.includes('> > [!note]+ Attempt Log'), true);
		assert.equal(upsertAttemptDigest('no log', noSchedule), null);
		const aged = refreshHomeStampAges([
			'### Tue, 10am — Sep 29, 2026',
			'',
			'### Wed, 2pm — Sep 9, 2026 <span class="rv-stamp-ago">1 day ago</span>',
			'',
			'### Visit Notes:',
			'',
			'## Not a visit',
		].join('\n'), new Date(2026, 8, 29, 12, 0, 0));
		assert.equal(aged.includes('##### Tue, 10am — Sep 29, 2026 <span class="rv-stamp-ago">0 days ago</span>'), true);
		assert.equal(aged.includes('##### Wed, 2pm — Sep 9, 2026 <span class="rv-stamp-ago">20 days ago</span>'), true);
		assert.equal(aged.includes('### Visit Notes:'), true);
		assert.equal(aged.includes('## Not a visit'), true);
		const later = refreshHomeStampAges(aged, new Date(2026, 8, 30, 8, 0, 0));
		assert.equal(later.includes('<span class="rv-stamp-ago">1 day ago</span>'), true);
		assert.equal(later.includes('<span class="rv-stamp-ago">21 days ago</span>'), true);
		const counted = readAttemptLog(later);
		assert.deepEqual(counted.buckets['2:morning'], { homes: 1, trials: 1 });
		assert.deepEqual(counted.buckets['3:afternoon'], { homes: 1, trials: 1 });
	});

	it('draws heavy bangs and a band 0 inner ring', () => {
		const triple = urgencyGlyphMarkup('!!!');
		assert.equal(triple.split('<rect ').length - 1, 3);
		assert.equal(triple.includes('width="3.2"'), true);
		assert.equal(triple.includes('height="12.6"'), true);
		assert.equal(triple.includes('fill="currentColor"'), true);
		assert.equal(triple.includes('width="1.7"'), false);
		assert.equal(triple.includes('!'), false);
		assert.equal(urgencyBangShapes('!!!').filter((shape) => shape.kind === 'rect').length, 3);
		const ring = urgencyBangShapes('○');
		assert.equal(ring.length, 1);
		assert.equal(ring[0]?.kind, 'circle');
		assert.equal(ring[0]?.attr.fill, 'none');
		assert.equal(ring[0]?.attr.stroke, 'currentColor');
		assert.equal(ring[0]?.attr.class, 'is-ring');
		assert.equal(urgencyGlyphMarkup('○').includes('class="is-ring"'), true);
		assert.equal(urgencyGlyphMarkup('!!').split('<rect ').length - 1, 2);
		assert.equal(urgencyGlyphMarkup('!').split('<rect ').length - 1, 1);
		assert.equal(urgencyGlyphMarkup(''), '');
		assert.equal(urgencyMark(3, 5).glyphs, '!!!');
		assert.equal(urgencyMark(0.2, 4).glyphs, '○');
		assert.equal(urgencyMark(0.2, 4).band, 0);
		assert.equal(urgencyMark(4, 0).glyphs, '');
	});

	it('moves a raised Try threshold into Unsure and keeps the Avoid baseline', () => {
		const grid = defaultAvailabilityGrid();
		grid['5:morning'] = 'may';
		const buckets = { '5:morning': { homes: 1, trials: 1 } };
		const baseline = suggestReturnDigest({ buckets, grid });
		assert.equal(baseline.sentences[0]?.startsWith('Try:'), true);
		const raised = suggestReturnDigest({
			buckets,
			grid,
			thresholds: { trySoftMin: 0.9 },
		});
		assert.equal(raised.sentences[0]?.startsWith('Unsure:'), true);
		const cold = suggestReturnDigest({
			buckets: { '5:morning': { homes: 0, trials: 3 } },
			grid,
			thresholds: { avoidMinTrials: 5 },
		});
		assert.equal(cold.sentences[0]?.startsWith('Unsure:'), true);
	});
});

describe('home likelihood', () => {
	it('barely moves on a thin sample, caps homes, and pulls empties down', () => {
		assert.equal(likelihoodMultiplier(0, 0), 1);
		assert.ok(Math.abs(likelihoodMultiplier(1, 1) - 1) < 0.05);
		assert.equal(likelihoodMultiplier(5, 10), 1);
		const home = likelihoodMultiplier(30, 30);
		const empty = likelihoodMultiplier(0, 30);
		assert.ok(home > 1 && home <= LIKELIHOOD_HOME_CAP);
		assert.ok(empty < 0.7 && empty >= LIKELIHOOD_EMPTY_FLOOR - 0.001);
		assert.ok(likelihoodMultiplier(1000, 1000) <= LIKELIHOOD_HOME_CAP + 1e-9);
		const wedMisses: AttemptBuckets = { '3:morning': { homes: 0, trials: 20 } };
		const now = new Date(2026, 8, 26, 10, 0, 0);
		assert.equal(likelihoodForNow(wedMisses, now), 1);
		assert.ok(likelihoodForNow(wedMisses, new Date(2026, 8, 23, 10, 0, 0)) < 1);
	});

});

describe('settings defaults', () => {
	it('ships priority 4, hidden ideality, and live graphs', () => {
		const settings = mergeSettings(undefined);
		assert.equal(settings.defaultNewRvPriority, 4);
		assert.equal(settings.territorySpanMiles, 15);
		assert.equal(settings.sortChips.urgency, true);
		assert.equal(settings.sortChips.ideality, false);
		assert.equal(settings.sortChips.distance, true);
		assert.equal(settings.homeLikelihoodEnabled, false);
		assert.equal(settings.digestOrientation, 'rows');
		assert.equal(settings.digestDays, 'all');
		assert.equal(settings.priorityNudgeEvery, 3);
		assert.equal(Object.values(settings.availabilityGrid).every((level) => level === 'off'), true);
		assert.equal(settings.availabilityGrid['5:evening'], 'off');
		assert.equal(settings.glancablePaddingY, 8);
		assert.equal(settings.glancablePaddingX, 10);
		assert.equal(settings.glancableFontScale, 1);
		assert.equal(settings.glancableMaxLineChars, 0);
		assert.equal(settings.glancableLines.name, true);
		assert.equal(settings.glancableLines.distance, true);
		assert.equal(settings.glancableLines.visits, true);
		assert.deepEqual(
			visibleSortPresets(settings.sortChips).map((preset) => preset.id),
			['urgency', 'distance', 'priority', 'spoke', 'attempted', 'met'],
		);
		assert.equal(visibleSortPresets(settings.sortChips).some((preset) => preset.property === IDEALITY_COLUMN_ID), false);
		const shown = visibleSortPresets(mergeSettings({ sortChips: { ...settings.sortChips, ideality: true } }).sortChips);
		assert.deepEqual(
			shown.map((preset) => preset.id),
			['ideality', 'urgency', 'distance', 'priority', 'spoke', 'attempted', 'met'],
		);
		assert.equal(settings.digestTrySoftMin, 0.42);
		assert.equal(settings.digestAvoidSoftMax, 0.3);
		assert.equal(settings.digestAvoidMinTrials, 3);
		assert.equal(settings.digestTryMinHomes, 1);
		assert.equal(settings.glancableChrome.hideToolbar, false);
		assert.equal(settings.glancableChrome.hideNew, true);
		assert.equal(settings.glancableChrome.hideSort, false);
		assert.equal(mergeSettings({ digestTrySoftMin: 0.5 }).digestTrySoftMin, 0.5);
		assert.equal(mergeSettings({ digestTrySoftMin: 2 }).digestTrySoftMin, 0.42);
		assert.equal(mergeSettings({ glancableChrome: { hideToolbar: true, hideNew: false } }).glancableChrome.hideToolbar, true);
		assert.equal(mergeSettings({ glancableChrome: { hideToolbar: true, hideNew: false } }).glancableChrome.hideNew, false);
		assert.equal(mergeSettings({ glancableChrome: { hideToolbar: true, hideNew: false } }).glancableChrome.hideCode, false);
		assert.equal(classifyChromeControl({ className: 'bases-toolbar-item bases-toolbar-views-menu', label: 'Glancable', icon: '' }), 'views');
		assert.equal(classifyChromeControl({ className: 'bases-toolbar-item bases-toolbar-sort-menu', label: '', icon: '' }), 'sort');
		assert.equal(classifyChromeControl({ className: 'bases-toolbar-item bases-toolbar-filter-menu', label: '', icon: '' }), 'filter');
		assert.equal(classifyChromeControl({ className: 'bases-toolbar-item bases-toolbar-properties-menu', label: '', icon: '' }), 'properties');
		assert.equal(classifyChromeControl({ className: 'bases-toolbar-item bases-toolbar-new-item-menu', label: 'New', icon: '' }), 'new');
		assert.equal(classifyChromeControl({ className: 'search-input-container', label: 'Search', icon: '' }), 'search');
		assert.equal(classifyChromeControl({ className: 'clickable-icon', label: '</>', icon: 'svg-icon lucide-code' }), 'code');

		assert.equal(glancableColumns(360, settings), 1);
		assert.equal(glancableColumns(679, settings), 1);
		assert.equal(glancableColumns(680, settings), 2);
		const cramped = mergeSettings({
			glancableMaxLineChars: 10,
			glancableFontScale: 0.6,
			glancablePaddingX: 0,
		});
		assert.equal(glancableColumns(420, cramped), 2);

		const graphs = settingsGraphs(settings);
		assert.equal(graphs.likelihood, '');
		assert.match(graphs.ladder, /Urgency by days/);
		assert.match(graphs.ladder, /stroke="var\(--rv-graph-axis\)"/);
		assert.match(graphs.ladder, /var\(--rv-graph-guide\)/);
		assert.match(graphs.ladder, /var\(--rv-series-5\)/);
		assert.match(graphs.ladder, />days</);
		assert.match(graphs.ladder, />urgency</);
		assert.equal(graphs.ladder.includes('#888'), false);
		assert.equal(graphs.ladder.includes('#bbb'), false);
		assert.equal(graphs.ladder.includes('#d64545'), false);
		assert.match(graphs.ramp, /3d/);
		assert.match(graphs.ideality, /Ideality vs miles/);
		assert.match(graphs.floors, /Ideality floors/);
		const shifted = settingsGraphs(mergeSettings({
			urgencyThresholdDays: { ...settings.urgencyThresholdDays, 5: 10 },
			territorySpanMiles: 30,
			idealityFloorDays: { ...settings.idealityFloorDays, 5: 9 },
			homeLikelihoodEnabled: true,
		}));
		assert.notEqual(shifted.ladder, graphs.ladder);
		assert.notEqual(shifted.ramp, graphs.ramp);
		assert.notEqual(shifted.ideality, graphs.ideality);
		assert.notEqual(shifted.floors, graphs.floors);
		assert.match(shifted.likelihood, /Home-likelihood multiplier/);
	});
});

function voiceFor(
	counts: AttemptBuckets,
	mayKeys: readonly string[],
): string[] {
	const grid = defaultAvailabilityGrid();
	for (const key of mayKeys) grid[key] = 'may';
	return suggestReturnDigest({
		buckets: counts,
		grid,
		now: new Date(2026, 8, 24, 12, 0, 0),
	}).sentences;
}
