import { idealityScore, likelihoodMultiplier } from './scoring';
import {
	availabilityKey,
	daypartLabel,
	upcomingSlots,
	weekdayName,
	type AttemptBuckets,
	type UpcomingSlot,
} from './schedule';
import type { RVLocatorSettings } from './types';

export interface PlannerPerson {
	name: string;
	days: number | null;
	priority: number | null;
	buckets: AttemptBuckets;
}

export interface PlannerRow {
	name: string;
	ideality: number;
}

export interface PlannerSlotView {
	label: string;
	rows: PlannerRow[];
}

/** Home likelihood must be on. Distance is held at the territory span, so the slot decides. */
export function plannerActive(settings: Pick<RVLocatorSettings, 'homeLikelihoodEnabled' | 'idealityPlannerEnabled'>): boolean {
	return settings.homeLikelihoodEnabled && settings.idealityPlannerEnabled;
}

export function buildIdealityPlan(args: {
	people: readonly PlannerPerson[];
	settings: RVLocatorSettings;
	now: Date;
	limit?: number;
}): PlannerSlotView[] {
	const slots = upcomingSlots(args.settings.availabilityGrid, args.now, args.settings.availabilityMultipliers);
	const limit = args.limit ?? 5;
	return slots.map((slot) => ({
		label: `${weekdayName(slot.weekday)} ${daypartLabel(slot.daypart)}`,
		rows: rankSlot(args.people, slot, args.settings).slice(0, limit),
	}));
}

function rankSlot(people: readonly PlannerPerson[], slot: UpcomingSlot, settings: RVLocatorSettings): PlannerRow[] {
	const ranked: PlannerRow[] = [];
	for (const person of people) {
		const score = personIdeality(person, slot, settings);
		if (score == null) continue;
		ranked.push({ name: person.name, ideality: score });
	}
	ranked.sort((a, b) => b.ideality - a.ideality || a.name.localeCompare(b.name));
	return ranked;
}

function personIdeality(person: PlannerPerson, slot: UpcomingSlot, settings: RVLocatorSettings): number | null {
	const base = idealityScore({
		days: person.days,
		priority: person.priority,
		miles: settings.territorySpanMiles,
		thresholds: settings.urgencyThresholdDays,
		floors: settings.idealityFloorDays,
		territorySpan: settings.territorySpanMiles,
		holdDistance: true,
	});
	if (base == null) return null;
	const count = person.buckets[availabilityKey(slot.weekday, slot.daypart)] ?? { homes: 0, trials: 0 };
	return base * likelihoodMultiplier(count.homes, count.trials);
}
