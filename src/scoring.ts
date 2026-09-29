import type { PriorityBand, PriorityDays } from './types';

/**
 * Urgency is days since Last Spoke divided by the priority threshold.
 * Under 3 days the ratio is multiplied by (days / 3) squared, so a high priority
 * stays well below 1 around 2 days. At day 3 the ramp is 1 and the score is the raw ratio.
 * There is no other urgency floor. The value keeps growing past 1.
 *
 * Ideality planner (the upcoming-slot ranking view, its toggle, and its command)
 * was removed in 1.2.6. It may return later. Ideality as a score stays.
 */
export const URGENCY_RAMP_DAYS = 3;

/** Squares the under-3-day fade so priority 5 is not near urgency 1 by about 2 days. */
export const URGENCY_RAMP_POWER = 2;

/** Chosen so P5 at 4 days at the territory span, and P1 at 6 weeks at 1 mile, both land near 1. */
export const IDEALITY_ALPHA = 0.555;

/** Same-point distance stays finite. About 80 meters. */
const MIN_IDEALITY_MILES = 0.05;

/**
 * Strong homes may raise ideality a little. The cap stays modest so a lower-urgency RV
 * does not leapfrog someone much more overdue just by being home.
 */
export const LIKELIHOOD_HOME_CAP = 1.25;

/** Strong empties pull down harder than homes bump up. */
export const LIKELIHOOD_EMPTY_FLOOR = 0.45;

export function urgencyScore(days: number | null, priority: number | null, thresholds: PriorityDays): number | null {
	if (days == null || !Number.isFinite(days) || days < 0) return null;
	if (!isPriorityBand(priority)) return null;
	const threshold = thresholds[priority];
	if (!Number.isFinite(threshold) || threshold <= 0) return null;
	const raw = days / threshold;
	if (days < URGENCY_RAMP_DAYS) {
		return raw * (days / URGENCY_RAMP_DAYS) ** URGENCY_RAMP_POWER;
	}
	return raw;
}

/**
 * Three bands. Below 1 is band 0 (a green circle). 1 is yellow, 2 is orange, 3 and above is red.
 */
export function urgencyBand(urgency: number | null): 0 | 1 | 2 | 3 {
	if (urgency == null || !Number.isFinite(urgency) || urgency < 1) return 0;
	if (urgency < 2) return 1;
	if (urgency < 3) return 2;
	return 3;
}

export interface UrgencyMark {
	glyphs: string;
	band: 0 | 1 | 2 | 3;
}

/**
 * Priority above 0 and urgency under 1 uses a circle. Bands 1–3 are one to three marks.
 * The glyph size does not shrink as marks are added, and marks are not bold or underlined.
 * Priority 0 has no urgency glyph.
 */
export function urgencyMark(urgency: number | null, priority: number | null): UrgencyMark {
	const band = urgencyBand(urgency);
	if (priority == null || priority <= 0) return { glyphs: '', band: 0 };
	if (band === 0) return { glyphs: '○', band: 0 };
	if (band === 1) return { glyphs: '!', band: 1 };
	if (band === 2) return { glyphs: '!!', band: 2 };
	return { glyphs: '!!!', band: 3 };
}

/**
 * Drawn bangs and the low-urgency ring. Bar width matches the card-circle stroke
 * so the marks stay short and heavy instead of a thin system-font exclamation.
 * Priority 0 has no glyph.
 */
export function urgencyGlyphMarkup(glyphs: string): string {
	if (glyphs === '○') {
		return '<svg viewBox="0 0 28 28" aria-hidden="true" focusable="false"><circle cx="14" cy="14" r="5.1" fill="none" stroke="currentColor" stroke-width="2.8"/></svg>';
	}
	const count = glyphs === '!' ? 1 : glyphs === '!!' ? 2 : glyphs === '!!!' ? 3 : 0;
	if (count === 0) return '';
	const centers = count === 1 ? [14] : count === 2 ? [10.6, 17.4] : [7.4, 14, 20.6];
	const marks = centers.map((cx) => {
		const x = (cx - 1.4).toFixed(2);
		return `<rect x="${x}" y="6.4" width="2.8" height="8.4" rx="1.4"/><circle cx="${cx}" cy="18.5" r="1.5"/>`;
	}).join('');
	return `<svg viewBox="0 0 28 28" aria-hidden="true" focusable="false" fill="currentColor">${marks}</svg>`;
}

/** Green below 1, then a distinct yellow, orange, and red. Priority 0 stays neutral grey. */
export function urgencyAccentColor(urgency: number | null, priority: number | null = 1): string {
	if (priority == null || priority <= 0) return 'var(--text-faint)';
	const band = urgencyBand(urgency);
	if (band === 0) return '#1f8a4c';
	if (band === 1) return '#d6a100';
	if (band === 2) return '#e06a00';
	return '#d63c3c';
}

export function distanceWeight(miles: number, territorySpan: number, alpha = IDEALITY_ALPHA): number | null {
	if (!Number.isFinite(miles) || miles < 0) return null;
	if (!Number.isFinite(territorySpan) || territorySpan <= 0) return null;
	if (!Number.isFinite(alpha)) return null;
	const safe = Math.max(miles, MIN_IDEALITY_MILES);
	return (territorySpan / safe) ** alpha;
}

/**
 * Ideality is urgency times a distance weight. Inside a priority's floor window the score fades
 * toward 0 (day 0) instead of dropping off a cliff. `holdDistance` forces the weight to 1.
 */
export function idealityScore(args: {
	days: number | null;
	priority: number | null;
	miles: number | null;
	thresholds: PriorityDays;
	floors: PriorityDays;
	territorySpan: number;
	holdDistance?: boolean;
}): number | null {
	const urgency = urgencyScore(args.days, args.priority, args.thresholds);
	if (urgency == null || args.days == null || !isPriorityBand(args.priority)) return null;
	let weight = 1;
	if (!args.holdDistance) {
		if (args.miles == null) return null;
		const weighted = distanceWeight(args.miles, args.territorySpan);
		if (weighted == null) return null;
		weight = weighted;
	}
	let score = urgency * weight;
	const floor = args.floors[args.priority];
	if (Number.isFinite(floor) && floor > 0 && args.days < floor) {
		score *= args.days / floor;
	}
	return score;
}

/**
 * Maps the Laplace rate onto a multiplier around 1.
 * No visits, and a thin sample, stay near 1. A real 50% rate stays 1.
 * Full-confidence homes approach {@link LIKELIHOOD_HOME_CAP}. Full-confidence empties approach {@link LIKELIHOOD_EMPTY_FLOOR}.
 */
export function likelihoodMultiplier(homes: number, trials: number): number {
	const n = Math.max(0, trials);
	const h = Math.min(Math.max(0, homes), n);
	const rate = (h + 1) / (n + 2);
	const confidence = n / (n + 3);
	const delta = rate - 0.5;
	if (delta >= 0) return 1 + delta * 2 * (LIKELIHOOD_HOME_CAP - 1) * confidence;
	return 1 + delta * 2 * (1 - LIKELIHOOD_EMPTY_FLOOR) * confidence;
}

export function isPriorityBand(priority: number | null): priority is PriorityBand {
	return priority === 1 || priority === 2 || priority === 3 || priority === 4 || priority === 5;
}
