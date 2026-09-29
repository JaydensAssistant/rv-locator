import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { visibleSortPresets } from '../src/active-layout';
import { upsertAttemptDigest } from '../src/attempt-digest';
import { IDEALITY_COLUMN_ID, URGENCY_COLUMN_ID } from '../src/constants';
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
	urgencyMark,
	urgencyScore,
} from '../src/scoring';
import {
	daypartAt,
	defaultAvailabilityGrid,
	laplaceRate,
	migrateAvailabilityGrid,
	parseAttemptLog,
	sampleConfidence,
	slotScore,
	suggestReturnDigest,
	type AttemptBuckets,
} from '../src/schedule';
import { formatSnoozeUntil, parseSnoozeUntil, snoozeActive, URGENCY_SNOOZE_PROPERTY } from '../src/snooze';
import { settingsGraphs } from '../src/settings-graphs';
import { applyVisitBody } from '../src/visit-log';
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
			'| Fri | 1/5 | 1/5 | 1/5 |',
			'| Sat | 0/0 | — | — |',
		].join('\n'));
		assert.equal(digest.sentences[0], '**Avoid** Fri morning (1/5), Fri afternoon (1/5), and Fri evening (1/5)');
		assert.equal(digest.sentences[1], '**Try** Sat morning has not been tried');
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
			'| | Fri | Sat |',
			'| --- | --- | --- |',
			'| Morning | 1/5 | 0/0 |',
			'| Afternoon | 1/5 | — |',
			'| Evening | 1/5 | — |',
		].join('\n'));
		const empty = suggestReturnDigest({ buckets: {}, grid: defaultAvailabilityGrid() });
		assert.equal(empty.markdown, 'No May-go-out days');
		assert.equal(empty.table, '');

		const halfGrid = defaultAvailabilityGrid();
		halfGrid['3:evening'] = 'may';
		const half = suggestReturnDigest({
			buckets: { '3:evening': { homes: 5, trials: 10 } },
			grid: halfGrid,
			now: new Date(2026, 8, 24, 12, 0, 0),
		});
		assert.equal(half.sentences[0], '**Avoid** Nothing stands out');
		assert.equal(half.sentences[1], '**Try** Wed evening (5/10)');
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

	it('stores the digest under the Attempt Log title', () => {
		const note = ['> [!note]- Attempt Log', '> - Mon, 9am — Sep 1, 2026 — success', ''].join('\n');
		const next = upsertAttemptDigest(note, 'No May-go-out days');
		assert.equal(next, [
			'> [!note]- Attempt Log',
			'> <!-- rv-locator-digest -->',
			'> No May-go-out days',
			'> <!-- /rv-locator-digest -->',
			'> - Mon, 9am — Sep 1, 2026 — success',
			'',
		].join('\n'));
		const again = upsertAttemptDigest(next ?? '', '| | Morning |\n| --- | --- |\n| Mon | 1/1 |');
		assert.match(again ?? '', /Mon \| 1\/1/);
		assert.equal((again ?? '').includes('No May-go-out days'), false);
		assert.equal(upsertAttemptDigest('no log', 'x'), null);
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
			visibleSortPresets(settings.sortChips).map((preset) => preset.property),
			[
				'rv-locator.distance',
				'note.Priority',
				'note.Last Spoke',
				'note.Last Attempted',
				'note.Met',
				URGENCY_COLUMN_ID,
			],
		);
		assert.equal(visibleSortPresets(settings.sortChips).some((preset) => preset.property === IDEALITY_COLUMN_ID), false);
		const shown = visibleSortPresets(mergeSettings({ sortChips: { ...settings.sortChips, ideality: true } }).sortChips);
		assert.equal(shown.some((preset) => preset.property === IDEALITY_COLUMN_ID), true);

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
