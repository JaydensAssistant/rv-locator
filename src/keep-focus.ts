/**
 * Rebuild `host` while a focused field inside `keep` stays in the document.
 * Detaching that field blurs it and closes the phone keyboard. A lost caret
 * is put back with preventScroll, at the same selection.
 */
export function refillKeepingFocus(host: HTMLElement, keep: HTMLElement | null, fill: () => void): void {
	const doc = host.ownerDocument;
	const active = doc.activeElement;
	const field = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
	const preserve = keep instanceof HTMLElement && keep.isConnected && field != null && keep.contains(field);
	const caret = preserve && field ? { start: field.selectionStart, end: field.selectionEnd } : null;
	if (preserve && keep && keep.parentElement === host) {
		for (const child of Array.from(host.children)) {
			if (child !== keep) child.remove();
		}
	} else {
		if (keep?.parentElement === host) keep.remove();
		const clearer = host as HTMLElement & { empty?: () => void };
		if (typeof clearer.empty === 'function') clearer.empty();
		else host.replaceChildren();
	}
	fill();
	if (keep && keep.parentElement !== host) host.appendChild(keep);
	if (!preserve || !field || doc.activeElement === field) return;
	field.focus({ preventScroll: true });
	if (caret?.start != null && caret.end != null) field.setSelectionRange(caret.start, caret.end);
}
