/**
 * Reading-view refresh watch. The observer sees the DOM writes a refresh
 * just made, and those records arrive after the lock drops. takeRecords()
 * in the finally block drops them before the next schedule.
 */

const SELF_PAINT = [
	'.rv-visit-note-box',
	'.rv-item-strip',
	'.rv-stamp-row',
	'.rv-visit-more',
	'.rv-qf-badges',
	'.rv-fit',
	'.rv-stamp-source',
	'.heading-collapse-indicator',
	'.collapse-indicator',
	'[aria-hidden="true"]',
].join(', ');

function isMeasureNode(node: Node): boolean {
	return node instanceof Element && node.getAttribute('aria-hidden') === 'true';
}

/** Added and removed nodes are all aria-hidden measure spans (or the chevron svg). */
export function recordIsMeasureSpans(record: MutationRecord): boolean {
	const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
	if (nodes.length === 0) return false;
	return nodes.every(isMeasureNode);
}

/** True when a record is a visit the screen should paint again for. */
export function visitSurfaceRecordsMatter(records: readonly MutationRecord[]): boolean {
	return records.some((record) => {
		if (recordIsMeasureSpans(record)) return false;
		const target = record.target;
		const el = target instanceof HTMLElement ? target : target.parentElement;
		if (!(el instanceof HTMLElement)) return false;
		return el.closest(SELF_PAINT) == null;
	});
}

/**
 * One refresh per real DOM change. Scroll and block mount call `schedule`.
 * Our own card edits are ignored so an open note does not refresh forever.
 */
export function watchVisitSurface(surface: HTMLElement, refresh: () => void): { schedule: () => void; stop: () => void } {
	let lock = 0;
	let dirty = false;
	let frame = 0;
	let observer: MutationObserver | null = null;
	const schedule = (): void => {
		if (lock > 0) {
			dirty = true;
			return;
		}
		if (frame) return;
		frame = window.requestAnimationFrame(() => {
			frame = 0;
			lock += 1;
			try {
				refresh();
			} finally {
				observer?.takeRecords();
				lock -= 1;
				if (dirty) {
					dirty = false;
					schedule();
				}
			}
		});
	};
	if (typeof MutationObserver !== 'undefined') {
		observer = new MutationObserver((records) => {
			if (visitSurfaceRecordsMatter(records)) schedule();
		});
		observer.observe(surface, { childList: true, subtree: true });
	}
	return {
		schedule,
		stop: () => {
			if (frame) window.cancelAnimationFrame(frame);
			frame = 0;
			observer?.disconnect();
			observer = null;
		},
	};
}
