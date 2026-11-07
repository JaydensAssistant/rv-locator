import { schedulePickerDismiss } from './picker-gate';

/**
 * One answer from the companion suggester.
 * A name logs that companion. `null` is Skip and still logs the visit.
 * `false` is Cancel: the visit is not logged.
 * Obsidian closes a SuggestModal before `onChooseSuggestion`, so a dismiss
 * waits one turn. A choice in that turn wins. Esc and a click outside cancel.
 */
export type CompanionGateValue = string | null | false;

export interface CompanionPromptGate {
	choose(name: string): void;
	skip(): void;
	cancel(): void;
	closed(schedule: (run: () => void) => void): void;
}

export function createCompanionPromptGate(onDone: (name: CompanionGateValue) => void): CompanionPromptGate {
	let settled = false;
	let chose = false;
	const finish = (name: CompanionGateValue): void => {
		if (settled) return;
		settled = true;
		onDone(name);
	};
	return {
		choose(name: string): void {
			chose = true;
			finish(name);
		},
		skip(): void {
			chose = true;
			finish(null);
		},
		cancel(): void {
			chose = true;
			finish(false);
		},
		closed(schedule: (run: () => void) => void): void {
			schedulePickerDismiss(() => chose, () => finish(false), schedule);
		},
	};
}
