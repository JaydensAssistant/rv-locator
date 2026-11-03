/**
 * The status bar hides only for the note class, or for the setting while a
 * standalone base is open. It is never hidden for every note.
 */
export function shouldHideStatusBar(noteHasClass: boolean, setting: boolean, standalone: boolean): boolean {
	return noteHasClass || (setting && standalone);
}

/** Phone navbar hides on an RV note, a hub note, and a base opened on its own. */
export function shouldHideMobileNav(locatorSurface: boolean, standaloneBase: boolean): boolean {
	return locatorSurface || standaloneBase;
}
