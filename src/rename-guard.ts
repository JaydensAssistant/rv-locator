/** Drop Templater's rename request. Other ephemeral state is left in place. */
export function stripRenameState(state: unknown): unknown {
	if (!state || typeof state !== 'object' || Array.isArray(state)) return state;
	if (!Object.prototype.hasOwnProperty.call(state, 'rename')) return state;
	const next = { ...(state as Record<string, unknown>) };
	delete next.rename;
	return next;
}

interface EphemeralLeaf {
	setEphemeralState: (state: unknown) => void;
}

let swallowDepth = 0;
let savedSetEphemeralState: ((this: EphemeralLeaf, state: unknown) => void) | null = null;

/**
 * While New RV is finishing, ignore `setEphemeralState({ rename })`.
 * Overlapping creates share one patch and restore it only after the last one.
 */
export function installRenameSwallow(Leaf: { prototype: EphemeralLeaf }): () => void {
	const proto = Leaf.prototype;
	const original = proto.setEphemeralState;
	if (typeof original !== 'function') return () => {};
	swallowDepth += 1;
	if (swallowDepth === 1) {
		savedSetEphemeralState = original;
		proto.setEphemeralState = function patched(this: EphemeralLeaf, state: unknown): void {
			savedSetEphemeralState?.call(this, stripRenameState(state));
		};
	}
	let released = false;
	return () => {
		if (released) return;
		released = true;
		swallowDepth = Math.max(0, swallowDepth - 1);
		if (swallowDepth === 0 && savedSetEphemeralState) {
			proto.setEphemeralState = savedSetEphemeralState;
			savedSetEphemeralState = null;
		}
	};
}

/** Close a core FileRenameModal titled "Note title" if one is already open. */
export function dismissNoteTitleModal(doc: Document): number {
	let closed = 0;
	doc.querySelectorAll('.modal-container').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		const title = node.querySelector('.modal-title')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
		if (title !== 'Note title') return;
		const closer = node.querySelector('.modal-close-button');
		if (closer instanceof HTMLElement) closer.click();
		else node.remove();
		closed += 1;
	});
	return closed;
}
