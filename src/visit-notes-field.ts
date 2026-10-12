import { NOTES_MAX_LINES, NOTES_MIN_LINES, fitNotesBox } from './notes-autosize';
import { holdVisitNote, isFocusThief } from './visit-display';

const RAW_NOTE = /^['"`]?INPUT\[textArea:(sVisit\d+Notes)\]['"`]?$/;
const NOTE_KEY = /sVisit\d+Notes/;

const writeTimers = new WeakMap<HTMLTextAreaElement, ReturnType<typeof setTimeout>>();

interface NoteDraft {
	value: string;
	start: number;
	end: number;
	until: number;
}

const draftByKey = new Map<string, NoteDraft>();
let ownWriteUntil = 0;

/** True while a visit-notes textarea is writing its own frontmatter. */
export function noteWritePending(): boolean {
	return Date.now() < ownWriteUntil;
}

/** Skip the next preview rebuild so that write does not move the caret. */
export function markOwnNoteWrite(): void {
	ownWriteUntil = Date.now() + 2500;
}

/** `sVisitNNotes` keys in the order the note writes them. */
export function visitNoteKeys(markdown: string): string[] {
	const keys: string[] = [];
	const pattern = /INPUT\[textArea:(sVisit\d+Notes)\]/g;
	let match = pattern.exec(markdown);
	while (match) {
		if (match[1]) keys.push(match[1]);
		match = pattern.exec(markdown);
	}
	return keys;
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

function isElement(node: unknown): node is HTMLElement {
	return !!node && typeof node === 'object' && typeof (node as { closest?: unknown }).closest === 'function';
}

function attributeBlob(node: HTMLElement): string {
	const names = typeof node.getAttributeNames === 'function' ? node.getAttributeNames() : [];
	const own = names.map((name) => `${name}=${node.getAttribute(name) ?? ''}`).join(' ');
	const parent = node.parentElement;
	const parentNames = parent && typeof parent.getAttributeNames === 'function' ? parent.getAttributeNames() : [];
	const inherited = parentNames.map((name) => `${name}=${parent?.getAttribute(name) ?? ''}`).join(' ');
	return `${own} ${inherited}`;
}

function boundKey(node: HTMLElement): string {
	return NOTE_KEY.exec(attributeBlob(node))?.[0] ?? '';
}

function hiddenSource(node: HTMLElement): boolean {
	return node.closest('.rv-lp-card-source, .cm-line.rv-mb-hidden') != null;
}

function isMetaBindArea(area: HTMLTextAreaElement): boolean {
	if (area.classList.contains('rv-native-notes-area') || area.classList.contains('rv-mb-notes-silenced')) return false;
	if (area.classList.contains('mb-input-textarea')) return true;
	if (area.closest('.mb-input-wrapper, .mb-input') != null) return true;
	return boundKey(area) !== '';
}

function liveDraft(key: string): NoteDraft | null {
	const saved = draftByKey.get(key);
	if (!saved || Date.now() >= saved.until) return null;
	return saved;
}

function rememberDraft(area: HTMLTextAreaElement, key: string): void {
	draftByKey.set(key, {
		value: area.value,
		start: area.selectionStart ?? area.value.length,
		end: area.selectionEnd ?? area.value.length,
		until: Date.now() + 2500,
	});
}

function desiredValue(key: string, readValue: (key: string) => string): string {
	return liveDraft(key)?.value ?? readValue(key);
}

function restoreCaret(area: HTMLTextAreaElement, key: string): void {
	const saved = liveDraft(key);
	if (!saved) return;
	const active = area.ownerDocument.activeElement;
	if (active === area) return;
	const length = area.value.length;
	const start = Math.max(0, Math.min(saved.start, length));
	const end = Math.max(start, Math.min(saved.end, length));
	if (active != null && active !== area.ownerDocument.body && !isFocusThief(active)) return;
	try {
		area.focus({ preventScroll: true });
	} catch {
		area.focus();
	}
	area.setSelectionRange(start, end);
	holdVisitNote(area, 2500);
}

function findNative(root: ParentNode, key: string): HTMLTextAreaElement | null {
	const areas = root.querySelectorAll('textarea.rv-native-notes-area');
	for (const node of Array.from(areas)) {
		if (!isTextArea(node) || !node.isConnected || hiddenSource(node)) continue;
		const marked = node.closest('[data-rv-native-notes]');
		if (isElement(marked) && marked.dataset.rvNativeNotes === key) return node;
	}
	return null;
}

function broadHost(root: HTMLElement, parent: HTMLElement): boolean {
	return parent === root
		|| parent.classList.contains('markdown-preview-view')
		|| parent.classList.contains('markdown-reading-view')
		|| parent.classList.contains('markdown-preview-sizer')
		|| parent.classList.contains('cm-editor')
		|| parent.classList.contains('cm-content')
		|| parent.classList.contains('rv-visit-note-box')
		|| parent.classList.contains('rv-lp-visit');
}

/**
 * Meta Bind's textarea writes on every keystroke. Hide it so the native box
 * is the only writer. A hidden Live Preview source line is silenced too, and
 * does not get a second box. The native box is a paragraph, never the whole note.
 */
function silenceMetaBind(root: HTMLElement, area: HTMLTextAreaElement): HTMLElement | null {
	area.disabled = true;
	area.readOnly = true;
	area.tabIndex = -1;
	area.setAttribute('aria-hidden', 'true');
	area.classList.add('rv-mb-notes-silenced');
	area.style.display = 'none';
	const wrap = area.closest('.mb-input-wrapper, .mb-input');
	if (isElement(wrap) && wrap !== area) {
		wrap.classList.add('rv-mb-notes-silenced');
		wrap.setAttribute('hidden', 'true');
		wrap.style.display = 'none';
	}
	const parent = isElement(wrap) && wrap.parentElement ? wrap.parentElement : area.parentElement;
	if (!isElement(parent) || hiddenSource(area) || hiddenSource(parent)) return null;
	if (!broadHost(root, parent)) return parent;
	const hold = parent.ownerDocument.createElement('p');
	hold.className = 'el-p rv-native-notes';
	hold.dataset.rvNotesHold = '1';
	const anchor = isElement(wrap) ? wrap : area;
	anchor.insertAdjacentElement('afterend', hold);
	return hold;
}

function syncNative(area: HTMLTextAreaElement, key: string, readValue: (key: string) => string): void {
	const focused = area.ownerDocument.activeElement === area;
	if (focused) {
		fitNativeNotes(area);
		return;
	}
	const next = desiredValue(key, readValue);
	if (area.value !== next) area.value = next;
	fitNativeNotes(area);
	restoreCaret(area, key);
}

function wireNative(
	root: ParentNode,
	host: HTMLElement,
	key: string,
	readValue: (key: string) => string,
	writeValue: (key: string, value: string) => void,
): void {
	if (hiddenSource(host)) return;
	const existing = findNative(host, key);
	if (isTextArea(existing) && existing.isConnected) {
		host.dataset.rvNativeNotes = key;
		host.classList.add('rv-native-notes');
		syncNative(existing, key, readValue);
		return;
	}
	if (findNative(root, key) || foreignWriter(host)) return;
	host.dataset.rvNativeNotes = key;
	host.classList.add('rv-native-notes');
	if (!host.classList.contains('rv-visit-note-box')) host.replaceChildren();
	const area = host.ownerDocument.createElement('textarea');
	area.className = 'rv-native-notes-area';
	area.rows = NOTES_MIN_LINES;
	area.value = desiredValue(key, readValue);
	area.setAttribute('aria-label', 'Visit notes');
	area.addEventListener('focus', () => holdVisitNote(area, 2500));
	area.addEventListener('input', () => {
		rememberDraft(area, key);
		markOwnNoteWrite();
		holdVisitNote(area, 2500);
		const pending = writeTimers.get(area);
		if (pending) clearTimeout(pending);
		writeTimers.set(area, setTimeout(() => {
			writeTimers.delete(area);
			markOwnNoteWrite();
			rememberDraft(area, key);
			writeValue(key, area.value);
		}, 400));
		fitNativeNotes(area);
	});
	host.appendChild(area);
	fitNativeNotes(area);
	restoreCaret(area, key);
}

function foreignWriter(host: HTMLElement): HTMLTextAreaElement | null {
	for (const node of Array.from(host.querySelectorAll('textarea'))) {
		if (!isTextArea(node) || node.classList.contains('rv-native-notes-area') || node.classList.contains('rv-mb-notes-silenced')) continue;
		if (isMetaBindArea(node)) continue;
		return node;
	}
	return null;
}

function assignKeys(found: Array<{ key: string; host: HTMLElement }>, ordered: readonly string[]): void {
	const used = new Set(found.map((item) => item.key).filter(Boolean));
	const pool = ordered.filter((key) => NOTE_KEY.test(key) && !used.has(key));
	let index = 0;
	for (const item of found) {
		if (item.key) continue;
		const next = pool[index];
		index += 1;
		if (next) item.key = next;
	}
}

/**
 * One debounced textarea per `sVisitNNotes` key. A Meta Bind box for that key
 * is hidden. The in-memory draft is what a rebuild restores, so a keystroke
 * that has not been saved yet is not dropped.
 */
export function mountRawVisitNotes(
	root: HTMLElement,
	readValue: (key: string) => string,
	writeValue: (key: string, value: string) => void,
	orderedKeys: readonly string[] = [],
): void {
	const claimed: Array<{ key: string; host: HTMLElement }> = [];
	root.querySelectorAll('textarea').forEach((node) => {
		if (!isTextArea(node) || !isMetaBindArea(node)) return;
		const key = boundKey(node);
		const host = silenceMetaBind(root, node);
		if (host) claimed.push({ key, host });
	});
	assignKeys(claimed, orderedKeys);
	const blocks = root.querySelectorAll('p, .el-p, code, span');
	blocks.forEach((node) => {
		if (!isElement(node) || !root.contains(node)) return;
		if (node.closest('textarea')) return;
		if (hiddenSource(node)) return;
		if (node.classList.contains('rv-native-notes') || node.closest('.rv-native-notes')) {
			const area = node.querySelector('textarea.rv-native-notes-area');
			const key = (node.closest('[data-rv-native-notes]') as HTMLElement | null)?.dataset?.rvNativeNotes
				?? node.dataset.rvNativeNotes
				?? '';
			if (isTextArea(area) && area.isConnected && key) syncNative(area, key, readValue);
			else if (isTextArea(area) && area.isConnected) fitNativeNotes(area);
			return;
		}
		const key = rawVisitNoteKey(node.textContent ?? '');
		if (!key) return;
		const host = node.matches('p, .el-p') ? node : (node.parentElement && isElement(node.parentElement) ? node.parentElement : node);
		if (hiddenSource(host) || findNative(root, key)) return;
		if (foreignWriter(host)) return;
		wireNative(root, host, key, readValue, writeValue);
	});
	for (const item of claimed) {
		const unused = !item.key || !item.host.isConnected || findNative(root, item.key) != null;
		if (unused) {
			if (item.host.dataset.rvNotesHold === '1' && !item.host.querySelector('textarea')) item.host.remove();
			continue;
		}
		wireNative(root, item.host, item.key, readValue, writeValue);
	}
}
