import { fitNotesBox } from './notes-autosize';

const RAW_NOTE = /^['"`]?INPUT\[textArea:(sVisit\d+Notes)\]['"`]?$/;

function fitNativeNotes(area: HTMLTextAreaElement): void {
	if (!area.isConnected || typeof area.setCssStyles !== 'function') return;
	fitNotesBox(area);
}
const writeTimers = new WeakMap<HTMLTextAreaElement, ReturnType<typeof setTimeout>>();

/** The frontmatter key inside a Meta Bind textArea that never rendered. */
export function rawVisitNoteKey(text: string): string | null {
	const match = RAW_NOTE.exec(text.replace(/\s+/g, ' ').trim());
	return match?.[1] ?? null;
}

/**
 * Replace a still-raw `INPUT[textArea:sVisitNNotes]` with a textarea that
 * reads and writes that same key. A box Meta Bind already built is skipped.
 */
export function mountRawVisitNotes(
	root: HTMLElement,
	readValue: (key: string) => string,
	writeValue: (key: string, value: string) => void,
): void {
	const blocks = root.querySelectorAll('p, .el-p, code, span');
	blocks.forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		if (node.closest('textarea, .rv-native-notes')) return;
		if (node.querySelector('textarea')) return;
		const key = rawVisitNoteKey(node.textContent ?? '');
		if (!key) return;
		const host = node.matches('p, .el-p') ? node : (node.parentElement instanceof HTMLElement ? node.parentElement : node);
		if (host.querySelector('textarea') || host.closest('.rv-native-notes')) return;
		if (host.dataset.rvNativeNotes === key && host.querySelector('textarea')) return;
		host.dataset.rvNativeNotes = key;
		host.classList.add('rv-native-notes');
		host.replaceChildren();
		const area = host.ownerDocument.createElement('textarea');
		area.className = 'rv-native-notes-area';
		area.value = readValue(key);
		area.setAttribute('aria-label', 'Visit notes');
		area.addEventListener('input', () => {
			const pending = writeTimers.get(area);
			if (pending) clearTimeout(pending);
			writeTimers.set(area, setTimeout(() => {
				writeTimers.delete(area);
				writeValue(key, area.value);
			}, 400));
			fitNativeNotes(area);
		});
		host.appendChild(area);
		fitNativeNotes(area);
	});
}
