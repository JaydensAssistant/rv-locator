import { NOTES_MAX_LINES, NOTES_MIN_LINES, fitNotesBox } from './notes-autosize';
import { holdVisitNote, isFocusThief } from './visit-display';

const RAW_NOTE = /^['"`]?INPUT\[textArea:(sVisit\d+Notes)\]['"`]?$/;

const writeTimers = new WeakMap<HTMLTextAreaElement, ReturnType<typeof setTimeout>>();

interface CaretMark {
	start: number;
	end: number;
	until: number;
}

const caretByKey = new Map<string, CaretMark>();
let ownWriteUntil = 0;

/** True while a visit-notes textarea is writing its own frontmatter. */
export function noteWritePending(): boolean {
	return Date.now() < ownWriteUntil;
}

/** Skip the next preview rebuild so that write does not move the caret. */
export function markOwnNoteWrite(): void {
	ownWriteUntil = Date.now() + 2500;
}

function fitNativeNotes(area: HTMLTextAreaElement): void {
	if (!area.isConnected) return;
	if (typeof area.setCssStyles === 'function') {
		fitNotesBox(area);
		return;
	}
	const view = area.ownerDocument.defaultView;
	const style = view?.getComputedStyle(area);
	const fontSize = parseFloat(style?.fontSize || '') || 16;
	const line = parseFloat(style?.lineHeight || '') || fontSize * 1.45;
	const min = line * NOTES_MIN_LINES;
	const max = line * NOTES_MAX_LINES;
	area.style.height = '0px';
	const content = area.scrollHeight;
	const next = Math.min(max, Math.max(min, content || min));
	area.style.height = `${Math.ceil(next)}px`;
	area.style.overflowY = content > max + 1 ? 'auto' : 'hidden';
}

/** The frontmatter key inside a Meta Bind textArea that never rendered. */
export function rawVisitNoteKey(text: string): string | null {
	const match = RAW_NOTE.exec(text.replace(/\s+/g, ' ').trim());
	return match?.[1] ?? null;
}

function isTextArea(node: unknown): node is HTMLTextAreaElement {
	return !!node && typeof node === 'object' && (node as { tagName?: string }).tagName === 'TEXTAREA';
}

function attributeBlob(node: HTMLElement): string {
	const names = typeof node.getAttributeNames === 'function' ? node.getAttributeNames() : [];
	const own = names.map((name) => `${name}=${node.getAttribute(name) ?? ''}`).join(' ');
	const parent = node.parentElement;
	const parentNames = parent && typeof parent.getAttributeNames === 'function' ? parent.getAttributeNames() : [];
	const inherited = parentNames.map((name) => `${name}=${parent?.getAttribute(name) ?? ''}`).join(' ');
	return `${own} ${inherited}`;
}

/**
 * A Meta Bind textarea for this key is already on the note.
 * The hidden Live Preview source line does not count: that is the raw field.
 */
function metaBindOwns(root: ParentNode, key: string, origin: HTMLElement): boolean {
	const card = origin.closest('.rv-visit-note-box, .rv-lp-visit');
	if (card?.querySelector('textarea:not(.rv-native-notes-area)')) return true;
	const areas = root.querySelectorAll('textarea');
	for (const node of Array.from(areas)) {
		if (!isTextArea(node) || node.classList.contains('rv-native-notes-area')) continue;
		if (node.closest('.rv-lp-card-source, .cm-line.rv-mb-hidden, .rv-lp-visit')) continue;
		if (attributeBlob(node).includes(key)) return true;
	}
	return false;
}

function rememberCaret(area: HTMLTextAreaElement, key: string): void {
	caretByKey.set(key, {
		start: area.selectionStart ?? area.value.length,
		end: area.selectionEnd ?? area.value.length,
		until: Date.now() + 2500,
	});
}

function restoreCaret(area: HTMLTextAreaElement, key: string): void {
	const saved = caretByKey.get(key);
	if (!saved || Date.now() >= saved.until) return;
	const active = area.ownerDocument.activeElement;
	const length = area.value.length;
	const start = Math.max(0, Math.min(saved.start, length));
	const end = Math.max(start, Math.min(saved.end, length));
	if (active != null && active !== area && active !== area.ownerDocument.body && !isFocusThief(active)) return;
	try {
		area.focus({ preventScroll: true });
	} catch {
		area.focus();
	}
	area.setSelectionRange(start, end);
	holdVisitNote(area, 2500);
}

/**
 * Replace a still-raw `INPUT[textArea:sVisitNNotes]` with one textarea that
 * reads and writes that same key. A box Meta Bind already built is skipped,
 * including one that lives elsewhere in the note for the same key.
 */
export function mountRawVisitNotes(
	root: HTMLElement,
	readValue: (key: string) => string,
	writeValue: (key: string, value: string) => void,
): void {
	const blocks = root.querySelectorAll('p, .el-p, code, span');
	blocks.forEach((node) => {
		if (!(node instanceof HTMLElement) || !root.contains(node)) return;
		if (node.closest('textarea')) return;
		if (node.classList.contains('rv-native-notes') || node.closest('.rv-native-notes')) {
			const area = node.querySelector('textarea.rv-native-notes-area');
			if (isTextArea(area) && area.isConnected) fitNativeNotes(area);
			return;
		}
		const key = rawVisitNoteKey(node.textContent ?? '');
		if (!key) return;
		if (metaBindOwns(root, key, node)) return;
		const host = node.matches('p, .el-p') ? node : (node.parentElement instanceof HTMLElement ? node.parentElement : node);
		const already = host.querySelector('textarea');
		if (isTextArea(already)) {
			if (already.classList.contains('rv-native-notes-area') && already.isConnected) fitNativeNotes(already);
			return;
		}
		if (host.closest('.rv-native-notes')) return;
		const existing = host.querySelector('textarea.rv-native-notes-area');
		if (isTextArea(existing)) return;
		host.dataset.rvNativeNotes = key;
		host.classList.add('rv-native-notes');
		host.replaceChildren();
		const area = host.ownerDocument.createElement('textarea');
		area.className = 'rv-native-notes-area';
		area.rows = NOTES_MIN_LINES;
		area.value = readValue(key);
		area.setAttribute('aria-label', 'Visit notes');
		area.addEventListener('focus', () => holdVisitNote(area, 2500));
		area.addEventListener('input', () => {
			rememberCaret(area, key);
			markOwnNoteWrite();
			holdVisitNote(area, 2500);
			const pending = writeTimers.get(area);
			if (pending) clearTimeout(pending);
			writeTimers.set(area, setTimeout(() => {
				writeTimers.delete(area);
				markOwnNoteWrite();
				rememberCaret(area, key);
				writeValue(key, area.value);
			}, 400));
			fitNativeNotes(area);
		});
		host.appendChild(area);
		fitNativeNotes(area);
		restoreCaret(area, key);
	});
}
