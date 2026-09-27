/**
 * Obsidian's suggest modal closes itself before it reports the chosen row.
 * A dismiss handler that runs inside `onClose` therefore sees "no choice" even
 * when the user just confirmed, and bulk geocode counted that confirm as a skip.
 * Schedule the dismiss check so a pick delivered later in the same turn wins.
 * Closing without a pick still counts as a skip.
 */
export function schedulePickerDismiss(
	chose: () => boolean,
	onDismiss: () => void,
	schedule: (run: () => void) => void,
): void {
	schedule(() => {
		if (!chose()) onDismiss();
	});
}
