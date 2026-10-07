/**
 * Lightness ladder for the five in-note visit buttons.
 * The first step keeps the urgency accent unless that accent is washed out
 * or near-black. Later steps move down inside the same band.
 */
export const VISIT_BUTTON_STEPS: readonly { floor: string; ceiling: string; drop: string }[] = [
	{ floor: '0.46', ceiling: '0.80', drop: '0' },
	{ floor: '0.42', ceiling: '0.74', drop: '0.06' },
	{ floor: '0.38', ceiling: '0.68', drop: '0.12' },
	{ floor: '0.36', ceiling: '0.62', drop: '0.18' },
	{ floor: '0.34', ceiling: '0.56', drop: '0.24' },
];

/** OKLCH lightness for visit button `index` (0 = leftmost) from the accent lightness. */
export function visitButtonLightness(sourceL: number, index: number): number {
	const step = VISIT_BUTTON_STEPS[index] ?? VISIT_BUTTON_STEPS[VISIT_BUTTON_STEPS.length - 1];
	if (!step) return sourceL;
	const dropped = sourceL - Number(step.drop);
	return Math.min(Number(step.ceiling), Math.max(Number(step.floor), dropped));
}
