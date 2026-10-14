/**
 * The status bar hides only for the note class, or for the setting while a
 * standalone base is open. It is never hidden for every note.
 */
export function shouldHideStatusBar(noteHasClass: boolean, setting: boolean, standalone: boolean): boolean {
	return noteHasClass || (setting && standalone);
}
