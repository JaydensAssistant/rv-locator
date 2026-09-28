import type { PriorityBand, PriorityDays } from './types';

/**
 * Urgency is days since Last Spoke divided by the priority threshold.
 * One soft floor: under 3 days, any priority ramps from 0 at day 0 to the full ratio at day 3.
 * There is no other urgency floor. The value keeps growing past 1.
 */
export const URGENCY_RAMP_DAYS = 3;

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
	if (days < URGENCY_RAMP_DAYS) return raw * (days / URGENCY_RAMP_DAYS);
	return raw;
}

/**
 * `floor(urgency)` clamped to 0–5. Urgency 1 is one bang. Urgency 5 and above is the top band.
 * Color uses the same ceiling.
 */
export function urgencyBand(urgency: number | null): number {
	if (urgency == null || !Number.isFinite(urgency)) return 0;
	return Math.min(5, Math.max(0, Math.floor(urgency)));
}

export interface UrgencyMark {
	glyphs: string;
	bold: boolean;
	underline: boolean;
}

export function urgencyMark(band: number): UrgencyMark {
	if (band <= 0) return { glyphs: '', bold: false, underline: false };
	if (band === 1) return { glyphs: '!', bold: false, underline: false };
	if (band === 2) return { glyphs: '!!', bold: false, underline: false };
	if (band === 3) return { glyphs: '!!!', bold: false, underline: false };
	if (band === 4) return { glyphs: '!!!', bold: true, underline: false };
	return { glyphs: '!!!', bold: true, underline: true };
}

/** Green at just-above-zero, red once urgency reaches band 5. Higher urgency stays red. */
export function urgencyAccentColor(urgency: number): string {
	const t = Math.max(0, Math.min(1, urgency / 5));
	const hue = Math.round(130 * (1 - t));
	return `hsl(${hue} 72% 46%)`;
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
