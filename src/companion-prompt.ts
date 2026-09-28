import { schedulePickerDismiss } from './picker-gate';

/**
 * One answer from the companion suggester.
 * Obsidian closes a SuggestModal before `onChooseSuggestion`, so resolving a
 * skip inside `onClose` drops the chosen name. `closed` defers that skip until
 * after a choice in the same turn. Esc still resolves empty. Skip does too.
 */
export interface CompanionPromptGate {
	choose(name: string): void;
	skip(): void;
	closed(schedule: (run: () => void) => void): void;
}

export function createCompanionPromptGate(onDone: (name: string | null) => void): CompanionPromptGate {
	let settled = false;
	let chose = false;
	const finish = (name: string | null): void => {
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
		closed(schedule: (run: () => void) => void): void {
			schedulePickerDismiss(() => chose, () => finish(null), schedule);
		},
	};
}
