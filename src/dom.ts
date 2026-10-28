/**
 * `instanceof` is reliable for nodes created in this window, including an SVG
 * from DOMParser (its document has no defaultView, so Obsidian's
 * `element.instanceOf()` returns false and the glyph never mounts).
 * The method is still the cross-window check for live DOM from a popout.
 */
export function domInstanceOf<T extends abstract new (...args: never[]) => object>(
	node: object | null,
	ctor: T,
): node is InstanceType<T> {
	if (node == null || typeof node !== 'object') return false;
	try {
		if (node instanceof ctor) return true;
	} catch {
		// A cross-realm constructor can throw. Fall through to the method.
	}
	const probe = node as { instanceOf?: (type: T) => boolean };
	if (typeof probe.instanceOf !== 'function') return false;
	try {
		return probe.instanceOf(ctor) === true;
	} catch {
		return false;
	}
}
