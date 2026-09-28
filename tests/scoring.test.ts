import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { visibleSortPresets } from '../src/active-layout';
import { IDEALITY_COLUMN_ID, URGENCY_COLUMN_ID } from '../src/constants';
import { glancableColumns } from '../src/glancable-density';
import { buildIdealityPlan } from '../src/planner';
import { likelihoodForNow } from '../src/row-score';
import {
	IDEALITY_ALPHA,
	LIKELIHOOD_EMPTY_FLOOR,
	LIKELIHOOD_HOME_CAP,
	URGENCY_RAMP_DAYS,
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
	parseAttemptLog,
	sampleConfidence,
	slotScore,
	suggestReturnDigest,
	type AttemptBuckets,
} from '../src/schedule';
import { settingsGraphs } from '../src/settings-graphs';
import { applyVisitBody } from '../src/visit-log';
import {
	DEFAULT_IDEALITY_FLOOR_DAYS,
	DEFAULT_SETTINGS,
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
		assert.equal(urgencyScore(1.5, 5, thresholds), (1.5 / 4) * (1.5 / 3));
		assert.equal(urgencyScore(1.5, 1, thresholds), (1.5 / 189) * (1.5 / 3));
		assert.equal(urgencyScore(3, 5, thresholds), 3 / 4);
		assert.equal(urgencyScore(3, 1, thresholds), 3 / 189);
		assert.equal(urgencyScore(null, 5, thresholds), null);
		assert.equal(urgencyScore(10, 0, thresholds), null);
		assert.equal(urgencyScore(10, null, thresholds), null);
	});

	it('bands bangs from one at urgency 1 up to bold underlined at 5', () => {
		assert.equal(urgencyBand(0.99), 0);
		assert.equal(urgencyBand(1), 1);
		assert.equal(urgencyBand(1.9), 1);
		assert.equal(urgencyBand(4), 4);
		assert.equal(urgencyBand(5), 5);
		assert.equal(urgencyBand(9.2), 5);
		assert.deepEqual(urgencyMark(1), { glyphs: '!', bold: false, underline: false });
		assert.deepEqual(urgencyMark(2), { glyphs: '!!', bold: false, underline: false });
		assert.deepEqual(urgencyMark(3), { glyphs: '!!!', bold: false, underline: false });
		assert.deepEqual(urgencyMark(4), { glyphs: '!!!', bold: true, underline: false });
		assert.deepEqual(urgencyMark(5), { glyphs: '!!!', bold: true, underline: true });
		assert.equal(urgencyAccentColor(5), urgencyAccentColor(12));
		assert.notEqual(urgencyAccentColor(1), urgencyAccentColor(5));
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
		assert.ok(inside != null && Math.abs(inside - (1 / 36)) < 1e-9);
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
		assert.ok(p4 != null && Math.abs(p4 - (2 / 21)) < 1e-9);
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
		assert.equal(at(0, 0), 'early-morning');
		assert.equal(at(9, 29), 'early-morning');
		assert.equal(at(9, 30), 'late-morning');
		assert.equal(at(11, 59), 'late-morning');
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
		assert.deepEqual(split['3:late-morning'], { homes: 0, trials: 1 });
		assert.deepEqual(split['6:late-morning'], { homes: 1, trials: 1 });
		assert.equal(split['3:late-morning']?.homes, 0);
	});

	it('scores slots with the Laplace rate, confidence, and availability multiplier', () => {
		assert.equal(laplaceRate(1, 5), 2 / 7);
		assert.equal(laplaceRate(0, 0), 0.5);
		assert.equal(laplaceRate(5, 10), 0.5);
		assert.equal(sampleConfidence(0), 0);
		assert.equal(sampleConfidence(5), 5 / 8);
		const half = slotScore(5, 10, 'go-out', { goOut: 1, willing: 0.65 });
		const miss = slotScore(0, 10, 'go-out', { goOut: 1, willing: 0.65 });
		const untried = slotScore(0, 0, 'go-out', { goOut: 1, willing: 0.65 });
		const off = slotScore(5, 10, 'off', { goOut: 1, willing: 0.65 });
		assert.ok(Math.abs(half - (0.5 * (10 / 13) * 1)) < 1e-12);
		assert.ok(half > miss);
		assert.ok(miss > untried);
		assert.equal(untried, 0);
		assert.equal(off, 0);
		assert.ok(half > 0.3);
	});

	it('lists avoid, untried, and strongest as short lines and does not merge weekdays', () => {
		const buckets: AttemptBuckets = {
			'5:late-morning': { homes: 1, trials: 5 },
			'5:afternoon': { homes: 1, trials: 5 },
			'5:evening': { homes: 1, trials: 5 },
		};
		const grid = defaultAvailabilityGrid();
		grid['6:late-morning'] = 'go-out';
		const digest = suggestReturnDigest({
			buckets,
			grid,
			multipliers: { goOut: 1, willing: 0.65 },
			now: new Date(2026, 8, 24, 12, 0, 0),
		});
		assert.equal(digest.text, digest.sentences.join('\n'));
		assert.equal(digest.sentences[0], 'Avoid · Fri late morning, afternoon, evening · 1/5');
		assert.equal(digest.sentences.find((line) => line.startsWith('Untried')), 'Untried · Sat late morning');
		assert.equal(digest.sentences.includes('Strongest · Fri late morning · 1/5 · 0.12 · avoid'), true);
		assert.equal(digest.sentences[0]?.includes('Wed'), false);
		assert.equal(digest.text.includes('Wednesday'), false);
		assert.equal(/\balways\b/i.test(digest.text), false);
		assert.equal(/\bnever\b/i.test(digest.text), false);
		assert.equal(/\b(Alright|You've|do that)\b/.test(digest.text), false);
		assert.equal(digest.sentences.every((line) => !/[.!?]$/.test(line)), true);
		const empty = suggestReturnDigest({
			buckets: {},
			grid,
			multipliers: { goOut: 1, willing: 0.65 },
		});
		assert.deepEqual(empty.sentences, ['No visits yet']);
		assert.equal(/\balways\b/i.test(empty.text), false);
		assert.equal(/\bnever\b/i.test(empty.text), false);

		const half = suggestReturnDigest({
			buckets: { '3:evening': { homes: 5, trials: 10 } },
			grid,
			multipliers: { goOut: 1, willing: 0.65 },
			now: new Date(2026, 8, 24, 12, 0, 0),
		});
		assert.equal(half.sentences.includes('None to avoid'), true);
		assert.equal(half.text.includes('Avoid ·'), false);
		assert.equal(half.sentences.includes('Strongest · Wed evening · 5/10 · 0.25'), true);
	});
});

describe('home likelihood and planner', () => {
	it('barely moves on a thin sample, caps homes, and pulls empties down', () => {
		assert.equal(likelihoodMultiplier(0, 0), 1);
		assert.ok(Math.abs(likelihoodMultiplier(1, 1) - 1) < 0.05);
		assert.equal(likelihoodMultiplier(5, 10), 1);
		const home = likelihoodMultiplier(30, 30);
		const empty = likelihoodMultiplier(0, 30);
		assert.ok(home > 1 && home <= LIKELIHOOD_HOME_CAP);
		assert.ok(empty < 0.7 && empty >= LIKELIHOOD_EMPTY_FLOOR - 0.001);
		assert.ok(likelihoodMultiplier(1000, 1000) <= LIKELIHOOD_HOME_CAP + 1e-9);
		const wedMisses: AttemptBuckets = { '3:late-morning': { homes: 0, trials: 20 } };
		const now = new Date(2026, 8, 26, 10, 0, 0);
		assert.equal(likelihoodForNow(wedMisses, now), 1);
		assert.ok(likelihoodForNow(wedMisses, new Date(2026, 8, 23, 10, 0, 0)) < 1);
	});

	it('ranks a slot by that slot’s likelihood while distance weight stays 1', () => {
		const settings = mergeSettings({
			...DEFAULT_SETTINGS,
			homeLikelihoodEnabled: true,
			idealityPlannerEnabled: true,
		});
		const days = 4;
		const priority = 5;
		const plan = buildIdealityPlan({
			settings,
			now: new Date(2026, 8, 26, 8, 0, 0),
			people: [
				{
					name: 'Home',
					days,
					priority,
					buckets: { '6:evening': { homes: 12, trials: 12 } },
				},
				{
					name: 'Away',
					days,
					priority,
					buckets: {
						'6:evening': { homes: 0, trials: 12 },
						'3:evening': { homes: 12, trials: 12 },
					},
				},
			],
		});
		const saturdayEvening = plan.find((slot) => slot.label === 'Saturday evening');
		assert.ok(saturdayEvening);
		assert.equal(saturdayEvening?.rows[0]?.name, 'Home');
		assert.ok((saturdayEvening?.rows[0]?.ideality ?? 0) > (saturdayEvening?.rows[1]?.ideality ?? 0));
		const wednesdayEvening = plan.find((slot) => slot.label === 'Wednesday evening');
		assert.equal(wednesdayEvening?.rows[0]?.name, 'Away');
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
		assert.equal(settings.idealityPlannerEnabled, false);
		assert.equal(settings.availabilityMultipliers.goOut, 1);
		assert.equal(settings.availabilityMultipliers.willing, 0.65);
		assert.equal(settings.availabilityGrid['5:evening'], 'willing');
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
		assert.match(graphs.ladder, /stroke="var\(--rv-graph-guide\)"/);
		assert.match(graphs.ladder, /fill="var\(--text-normal\)"/);
		assert.match(graphs.ladder, /stroke="var\(--rv-series-5\)"/);
		assert.equal(graphs.ladder.includes('#888'), false);
		assert.equal(graphs.ladder.includes('#bbb'), false);
		assert.equal(graphs.ladder.includes('#d64545'), false);
		assert.match(graphs.ramp, /3d/);
		assert.match(graphs.ideality, /Ideality vs miles/);
		assert.match(graphs.ideality, /stroke="var\(--rv-series-urgency\)"/);
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
		assert.match(shifted.likelihood, /stroke="var\(--rv-series-home\)"/);
		assert.match(shifted.likelihood, /stroke="var\(--rv-series-none\)"/);
		assert.equal(shifted.likelihood.includes('#888'), false);
	});
});
