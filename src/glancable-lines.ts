/**
 * Glancable card, top to bottom. Each date sits on its own line.
 * The right rail (priority circle and map pin) is not one of these lines.
 */
export const GLANCABLE_CARD_LINES = [
	{ id: 'name', label: 'Name' },
	{ id: 'place', label: 'Street, city, and distance' },
	{ id: 'last-spoke', label: 'Last Spoke' },
	{ id: 'last-attempted', label: 'Last Attempted' },
	{ id: 'met', label: 'Met' },
	{ id: 'foot', label: 'Met With and successful visits' },
] as const;

export function glancableLineId(index: number): string {
	const line = GLANCABLE_CARD_LINES[index];
	if (!line) throw new Error(`Glancable card has no line ${index}.`);
	return line.id;
}
