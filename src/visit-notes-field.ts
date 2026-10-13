import { NOTES_MAX_LINES, NOTES_MIN_LINES, fitNotesBox } from './notes-autosize';
import { dropHeldVisitNote, holdVisitNote, isFocusThief } from './visit-display';

const RAW_NOTE = /^['"`]?INPUT\[textArea:(sVisit\d+Notes)\]['"`]?$/;
const NOTE_KEY = /sVisit\d+Notes/;

const writeTimers = new WeakMap<HTMLTextAreaElement, ReturnType<typeof setTimeout>>();

interface NoteDraft {
	path: string;
	value: string;
	start: number;
	end: number;
	until: number;
	/** Set only by typing or a caret move. A mount must not invent this. */
	typed: boolean;
}

const draftByKey = new Map<string, NoteDraft>();
const pendingByPath = new Map<string, number>();
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
let session = 0;
let activeNotePath = '';
/** The visit key that was focused while the user was actually editing. */
let caretFocus: { path: string; key: string } | null = null;

function cacheKey(path: string, key: string): string {
	return `${path}\0${key}`;
}

/** The file whose visit notes may be read or written. Set on file-open and leaf change. */
export function setActiveVisitNote(path: string): void {
	activeNotePath = path;
}

/**
 * Drop drafts, caret positions, and in-flight saves.
 * A value mounted for one file must not appear in, or be written from, another.
 */
export function clearVisitNoteCaches(): void {
	session += 1;
	draftByKey.clear();
	pendingByPath.clear();
	caretFocus = null;
	for (const timer of pendingTimers) clearTimeout(timer);
	pendingTimers.clear();
	dropHeldVisitNote();
}

/** A view that closed keeps its text out of every note that is still open. */
export function releaseClosedVisitNotes(openPaths: ReadonlySet<string>): void {
	for (const id of [...draftByKey.keys()]) {
		const path = id.split('\0')[0] ?? '';
		if (path && !openPaths.has(path)) draftByKey.delete(id);
	}
	for (const path of [...pendingByPath.keys()]) {
		if (path && !openPaths.has(path)) pendingByPath.delete(path);
	}
}

/** True while this file (or any file, when path is omitted) is writing its own frontmatter. */
export function noteWritePending(path?: string): boolean {
	const now = Date.now();
	if (path != null) return now < (pendingByPath.get(path) ?? 0);
	for (const until of pendingByPath.values()) {
		if (now < until) return true;
	}
	return false;
}

/** Skip the next preview rebuild so that write does not move the caret. */
export function markOwnNoteWrite(path = ''): void {
	pendingByPath.set(path, Date.now() + 2500);
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

function liveDraft(path: string, key: string): NoteDraft | null {
	const saved = draftByKey.get(cacheKey(path, key));
	if (!saved || saved.path !== path || Date.now() >= saved.until) return null;
	return saved;
}

let suppressCaret = false;

/**
 * The live caret. Only the focused box, or a box with a save in flight, is recorded.
 * `typed` is true only for a real input or caret move, never for a mount.
 */
function rememberCaret(area: HTMLTextAreaElement, path: string, key: string, typed = false): void {
	if ((area.dataset.rvNoteFile || '') !== path) return;
	const active = area.ownerDocument.activeElement === area;
	if (!typed && !active && !writeTimers.has(area)) return;
	const id = cacheKey(path, key);
	const previous = draftByKey.get(id);
	const start = typeof area.selectionStart === 'number' ? area.selectionStart : previous?.start ?? 0;
	const end = typeof area.selectionEnd === 'number' ? area.selectionEnd : previous?.end ?? start;
	const nowTyped = typed || previous?.typed === true;
	draftByKey.set(id, {
		path,
		value: area.value,
		start,
		end,
		until: Date.now() + 2500,
		typed: nowTyped,
	});
	if (nowTyped && (typed || active)) caretFocus = { path, key };
}

function rememberDraft(area: HTMLTextAreaElement, path: string, key: string): void {
	rememberCaret(area, path, key, true);
}

/** Clicks and arrow keys move the caret without an input event. Keep that position. */
function watchCaretMoves(area: HTMLTextAreaElement): void {
	const doc = area.ownerDocument;
	const root = doc.body ?? doc.documentElement;
	if (!isElement(root) || root.dataset.rvCaretWatch === '1') return;
	root.dataset.rvCaretWatch = '1';
	const pull = (): void => {
		if (suppressCaret) return;
		const active = doc.activeElement;
		if (!isTextArea(active) || !active.classList.contains('rv-native-notes-area')) return;
		const key = active.dataset.rvNoteKey || active.dataset.rvNativeNotes || '';
		const path = active.dataset.rvNoteFile || '';
		if (!NOTE_KEY.test(key)) return;
		if (activeNotePath && path !== activeNotePath) return;
		rememberCaret(active, path, key, true);
	};
	doc.addEventListener('selectionchange', pull);
	doc.addEventListener('keyup', pull, true);
	doc.addEventListener('pointerup', pull, true);
	doc.addEventListener('mouseup', pull, true);
}

function desiredValue(path: string, key: string, readValue: (key: string) => string): string {
	return liveDraft(path, key)?.value ?? readValue(key);
}

function selectionOf(area: HTMLTextAreaElement, saved: NoteDraft): { start: number; end: number } {
	const length = area.value.length;
	const start = Math.max(0, Math.min(saved.start, length));
	const end = Math.max(start, Math.min(saved.end, length));
	return { start, end };
}

/** A preview rebuild leaves focus on a div. That is not the user editing another field. */
function editingElsewhere(node: EventTarget | null): boolean {
	if (!isElement(node) || !node.isConnected || isFocusThief(node)) return false;
	const tag = node.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
	return node.isContentEditable === true;
}

/**
 * A new textarea after the preview DOM was actually replaced.
 * The same element surviving our own save is left untouched.
 */
function placeRebuiltCaret(area: HTMLTextAreaElement, path: string, key: string): void {
	const saved = liveDraft(path, key);
	// A fresh note open has no typed draft, and a mount must not focus a box.
	if (!saved || saved.path !== path || !saved.typed) return;
	if (!caretFocus || caretFocus.path !== path || caretFocus.key !== key) return;
	const { start, end } = selectionOf(area, saved);
	const active = area.ownerDocument.activeElement;
	suppressCaret = true;
	try {
		if (!editingElsewhere(active)) {
			try {
				area.focus({ preventScroll: true });
			} catch {
				area.focus();
			}
			holdVisitNote(area, 2500, true);
		}
		area.setSelectionRange(start, end);
	} finally {
		suppressCaret = false;
	}
}

function findNative(root: ParentNode, key: string, path: string): HTMLTextAreaElement | null {
	const areas = root.querySelectorAll('textarea.rv-native-notes-area');
	for (const node of Array.from(areas)) {
		if (!isTextArea(node) || !node.isConnected || hiddenSource(node)) continue;
		if ((node.dataset.rvNoteFile || '') !== path) continue;
		if (node.dataset.rvNoteKey === key || node.dataset.rvNativeNotes === key) return node;
		const marked = node.closest('[data-rv-native-notes]');
		if (isElement(marked) && marked !== node && !node.dataset.rvNoteKey && marked.dataset.rvNativeNotes === key) return node;
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

function syncNative(area: HTMLTextAreaElement, path: string, key: string, readValue: (key: string) => string): void {
	if ((area.dataset.rvNoteFile || '') !== path) return;
	const focused = area.ownerDocument.activeElement === area;
	// Our save skips the rebuild. The textarea is the same node, so the caret stays.
	if (focused || noteWritePending(path)) {
		fitNativeNotes(area);
		return;
	}
	const next = desiredValue(path, key, readValue);
	if (area.value !== next) {
		suppressCaret = true;
		area.value = next;
		suppressCaret = false;
	}
	fitNativeNotes(area);
}

function broadContainer(host: HTMLElement): boolean {
	if (
		host.classList.contains('markdown-preview-view')
		|| host.classList.contains('markdown-reading-view')
		|| host.classList.contains('markdown-preview-sizer')
		|| host.classList.contains('markdown-source-view')
		|| host.classList.contains('cm-editor')
	) return true;
	return host.classList.contains('markdown-preview-section') && host.querySelector('h1, h2, h3, h4, h5, h6, .rv-visit-stamp') != null;
}

/** Direct text of this node. A child field's declaration is not included. */
function ownText(node: HTMLElement): string {
	let own = '';
	for (const child of Array.from(node.childNodes)) {
		if (child.nodeType === 3) own += child.textContent ?? '';
	}
	return own;
}

function declaredKeys(text: string): string[] {
	const found: string[] = [];
	const pattern = /INPUT\[textArea:(sVisit\d+Notes)\]/g;
	let match = pattern.exec(text);
	while (match) {
		if (match[1] && !found.includes(match[1])) found.push(match[1]);
		match = pattern.exec(text);
	}
	return found;
}

/**
 * The one `sVisitNNotes` declaration that belongs to this box.
 * Several declarations means this node holds more than one visit, so the
 * caller uses the visit index instead of the first INPUT in that text.
 */
function fieldKey(box: HTMLElement): string {
	const keys: string[] = [];
	box.querySelectorAll('code').forEach((node) => {
		if (!isElement(node) || node.closest('.rv-visit-note-box') !== box) return;
		const own = declaredKeys(ownText(node));
		const fromCode = own.length > 0 ? own : declaredKeys(node.textContent ?? '');
		if (fromCode.length !== 1) return;
		const key = fromCode[0] ?? '';
		if (key && !keys.includes(key)) keys.push(key);
	});
	return keys.length === 1 ? (keys[0] ?? '') : '';
}

function pinnedArea(box: HTMLElement): HTMLTextAreaElement | null {
	const found = box.querySelector('textarea.rv-native-notes-area');
	if (!isTextArea(found) || found.closest('.rv-visit-note-box') !== box) return null;
	return found;
}

/**
 * Boxes in stamp order. The box is that heading's next sibling, or the next
 * sibling of its section, not the first box a parent query would return.
 */
function boxesAfterStamps(root: HTMLElement): HTMLElement[] {
	const boxes: HTMLElement[] = [];
	if (typeof root.querySelectorAll !== 'function') return boxes;
	const push = (next: Element | null): boolean => {
		if (!isElement(next) || !next.classList.contains('rv-visit-note-box') || boxes.includes(next)) return false;
		boxes.push(next);
		return true;
	};
	root.querySelectorAll('h3.rv-visit-stamp, h5.rv-visit-stamp').forEach((node) => {
		if (!isElement(node)) return;
		const wrapped = node.closest('.el-h1, .el-h2, .el-h3, .el-h4, .el-h5, .el-h6, .cm-line');
		const section = node.closest('.markdown-preview-section');
		const hosts = [node, wrapped, section].filter((host): host is HTMLElement => isElement(host));
		for (const host of hosts) {
			if (push(host.nextElementSibling)) return;
		}
	});
	return boxes;
}

function visitSurface(root: HTMLElement): HTMLElement {
	const wide = root.closest?.('.markdown-preview-view, .markdown-reading-view, .markdown-source-view, .cm-editor');
	return isElement(wide) ? wide : root;
}

/**
 * Key for this visit: its own rendered field, otherwise this visit's index
 * in the note. A key already stored on the box is not reused: a per-section
 * mount used to pin every box to the first INPUT in the parent.
 */
function keyForBox(box: HTMLElement, index: number, ordered: readonly string[], used: Set<string>): string {
	const declared = fieldKey(box);
	if (declared && !used.has(declared)) return declared;
	const indexed = ordered[index] ?? '';
	if (NOTE_KEY.test(indexed) && !used.has(indexed)) return indexed;
	const free = ordered.find((key) => NOTE_KEY.test(key) && !used.has(key));
	return free ?? '';
}

function fieldHost(box: HTMLElement): HTMLElement {
	const existing = pinnedArea(box);
	const current = existing?.parentElement;
	if (isElement(current) && box.contains(current) && !broadContainer(current) && !current.classList.contains('rv-visit-note-box')) return current;
	const paragraphs = Array.from(box.querySelectorAll('p, .el-p')).filter((node): node is HTMLElement => (
		isElement(node) && node.closest('.rv-visit-note-box') === box && !node.classList.contains('rv-item-strip')
	));
	const withField = paragraphs.find((node) => node.querySelector('code, textarea, .mb-input, .mb-input-wrapper') != null);
	const paragraph = withField ?? paragraphs[0];
	if (isElement(paragraph) && !broadContainer(paragraph)) {
		if (paragraph.classList.contains('el-p')) {
			const inner = paragraph.querySelector(':scope > p');
			if (isElement(inner)) return inner;
		}
		return paragraph;
	}
	const hold = box.ownerDocument.createElement('p');
	hold.className = 'el-p rv-native-notes';
	hold.dataset.rvNotesHold = '1';
	box.appendChild(hold);
	return hold;
}

function pinKey(area: HTMLTextAreaElement, host: HTMLElement, key: string, path: string): void {
	area.dataset.rvNoteKey = key;
	area.dataset.rvNativeNotes = key;
	area.dataset.rvNoteFile = path;
	host.dataset.rvNativeNotes = key;
	host.dataset.rvNoteFile = path;
	host.classList.add('rv-native-notes');
	const box = host.closest('.rv-visit-note-box');
	if (isElement(box)) box.dataset.rvVisitKey = key;
}

function dropForeignArea(area: HTMLTextAreaElement | null, path: string): HTMLTextAreaElement | null {
	if (!isTextArea(area) || !area.isConnected) return null;
	if ((area.dataset.rvNoteFile || '') === path) return area;
	area.remove();
	return null;
}

function scheduleNoteWrite(
	area: HTMLTextAreaElement,
	path: string,
	key: string,
	typed: string,
	writeValue: (key: string, value: string) => void,
): void {
	const stamp = session;
	const pending = writeTimers.get(area);
	if (pending) {
		clearTimeout(pending);
		pendingTimers.delete(pending);
	}
	const timer = setTimeout(() => {
		pendingTimers.delete(timer);
		writeTimers.delete(area);
		if (stamp !== session) return;
		if ((area.dataset.rvNoteFile || '') !== path) return;
		if (activeNotePath && path !== activeNotePath) return;
		const writeKey = area.dataset.rvNoteKey || area.dataset.rvNativeNotes || '';
		if (writeKey !== key) return;
		if (area.isConnected) rememberCaret(area, path, writeKey, true);
		markOwnNoteWrite(path);
		const saved = liveDraft(path, writeKey);
		if (saved && saved.path !== path) return;
		writeValue(writeKey, saved?.value ?? typed);
	}, 400);
	writeTimers.set(area, timer);
	pendingTimers.add(timer);
}

function wireNative(
	root: ParentNode,
	host: HTMLElement,
	key: string,
	path: string,
	readValue: (key: string) => string,
	writeValue: (key: string, value: string) => void,
): void {
	if (!key || hiddenSource(host)) return;
	if (broadContainer(host) || host.classList.contains('rv-visit-note-box')) {
		const hold = host.ownerDocument.createElement('p');
		hold.className = 'el-p rv-native-notes';
		hold.dataset.rvNotesHold = '1';
		host.appendChild(hold);
		host = hold;
	}
	const box = host.closest('.rv-visit-note-box');
	const already = dropForeignArea(isElement(box) ? pinnedArea(box) : null, path);
	if (isTextArea(already)) {
		const holder = already.parentElement;
		pinKey(already, isElement(holder) ? holder : host, key, path);
		syncNative(already, path, key, readValue);
		restoreReusedCaret(already, path, key);
		return;
	}
	const existing = dropForeignArea(findNative(host, key, path), path);
	if (isTextArea(existing)) {
		pinKey(existing, host, key, path);
		syncNative(existing, path, key, readValue);
		restoreReusedCaret(existing, path, key);
		return;
	}
	if (findNative(root, key, path) || foreignWriter(host)) return;
	if (!host.classList.contains('rv-visit-note-box') && !broadContainer(host)) host.replaceChildren();
	const area = host.ownerDocument.createElement('textarea');
	area.className = 'rv-native-notes-area';
	area.rows = NOTES_MIN_LINES;
	pinKey(area, host, key, path);
	area.value = desiredValue(path, key, readValue);
	area.setAttribute('aria-label', 'Visit notes');
	watchCaretMoves(area);
	const keepInBox = (evt: Event): void => {
		evt.stopPropagation();
	};
	area.addEventListener('mousedown', keepInBox);
	area.addEventListener('pointerdown', keepInBox);
	area.addEventListener('keydown', keepInBox);
	area.addEventListener('focus', (evt) => {
		if (!evt.isTrusted && liveDraft(path, key)?.typed !== true) return;
		holdVisitNote(area, 2500, true);
	});
	area.addEventListener('input', (evt) => {
		evt.stopPropagation();
		const writePath = area.dataset.rvNoteFile || '';
		const writeKey = area.dataset.rvNoteKey || key;
		if (writePath !== path) return;
		if (activeNotePath && writePath !== activeNotePath) return;
		const typed = area.value;
		rememberDraft(area, writePath, writeKey);
		markOwnNoteWrite(writePath);
		holdVisitNote(area, 2500, true);
		scheduleNoteWrite(area, writePath, writeKey, typed, writeValue);
		fitNativeNotes(area);
	});
	host.appendChild(area);
	fitNativeNotes(area);
	const saved = liveDraft(path, key);
	suppressCaret = true;
	area.value = saved?.value ?? readValue(key);
	suppressCaret = false;
	placeRebuiltCaret(area, path, key);
}

/**
 * Obsidian's reading rebuild detaches the same textarea and leaves focus on the body.
 * Put the caret back only for the key the user was typing. A fresh open has no typed draft.
 */
function restoreReusedCaret(area: HTMLTextAreaElement, path: string, key: string): void {
	if (area.ownerDocument.activeElement === area) return;
	if (editingElsewhere(area.ownerDocument.activeElement)) return;
	placeRebuiltCaret(area, path, key);
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
	path = '',
): void {
	const surface = visitSurface(root);
	surface.dataset.rvNoteFile = path;
	const activeArea = surface.ownerDocument.activeElement;
	surface.querySelectorAll('textarea.rv-native-notes-area').forEach((node) => {
		if (!isTextArea(node) || !node.isConnected) return;
		if ((node.dataset.rvNoteFile || '') !== path) return;
		const key = node.dataset.rvNoteKey || node.dataset.rvNativeNotes || '';
		if (!NOTE_KEY.test(key)) return;
		if (node !== activeArea && !writeTimers.has(node)) return;
		rememberCaret(node, path, key, false);
	});
	const boxes = boxesAfterStamps(surface);
	const used = new Set<string>();
	boxes.forEach((box, index) => {
		const key = keyForBox(box, index, orderedKeys, used);
		if (!key) return;
		used.add(key);
		box.dataset.rvVisitKey = key;
		if (!root.contains(box) && root !== surface) return;
		box.querySelectorAll('textarea').forEach((node) => {
			if (isTextArea(node) && isMetaBindArea(node)) silenceMetaBind(root.contains(node) ? root : surface, node);
		});
		wireNative(surface, fieldHost(box), key, path, readValue, writeValue);
	});
	const claimed: Array<{ key: string; host: HTMLElement }> = [];
	root.querySelectorAll('textarea').forEach((node) => {
		if (!isTextArea(node) || !isMetaBindArea(node)) return;
		const owner = node.closest('.rv-visit-note-box');
		if (isElement(owner) && pinnedArea(owner)) return;
		const key = boundKey(node);
		const host = silenceMetaBind(root, node);
		if (host && !used.has(key)) claimed.push({ key, host });
	});
	assignKeys(claimed, orderedKeys.filter((key) => !used.has(key)));
	const blocks = root.querySelectorAll('p, .el-p, code, span');
	blocks.forEach((node) => {
		if (!isElement(node) || !root.contains(node)) return;
		if (node.closest('textarea')) return;
		if (hiddenSource(node)) return;
		if (broadContainer(node) || node.classList.contains('rv-visit-note-box')) return;
		if (node.classList.contains('rv-native-notes') || node.closest('.rv-native-notes')) {
			const area = node.querySelector('textarea.rv-native-notes-area');
			const key = (isTextArea(area) ? (area.dataset.rvNoteKey || area.dataset.rvNativeNotes || '') : '')
				|| node.dataset.rvNoteKey
				|| '';
			if (isTextArea(area) && area.isConnected && (area.dataset.rvNoteFile || '') !== path) {
				area.remove();
			} else if (isTextArea(area) && area.isConnected && NOTE_KEY.test(key)) {
				syncNative(area, path, key, readValue);
				return;
			} else if (isTextArea(area) && area.isConnected) {
				fitNativeNotes(area);
				return;
			}
			if (!NOTE_KEY.test(key) || used.has(key)) return;
			used.add(key);
			wireNative(surface, node, key, path, readValue, writeValue);
			return;
		}
		const key = rawVisitNoteKey(ownText(node)) || rawVisitNoteKey(node.textContent ?? '');
		if (!key || used.has(key)) return;
		const parent = node.parentElement;
		const host = node.matches('p, .el-p')
			? node
			: (isElement(parent) && !broadContainer(parent) && !parent.classList.contains('rv-visit-note-box') ? parent : node);
		if (hiddenSource(host) || broadContainer(host) || findNative(surface, key, path)) return;
		if (foreignWriter(host)) return;
		used.add(key);
		wireNative(surface, host, key, path, readValue, writeValue);
	});
	for (const item of claimed) {
		const unused = !item.key || used.has(item.key) || !item.host.isConnected || findNative(surface, item.key, path) != null;
		if (unused) {
			if (item.host.dataset.rvNotesHold === '1' && !item.host.querySelector('textarea')) item.host.remove();
			continue;
		}
		used.add(item.key);
		wireNative(surface, item.host, item.key, path, readValue, writeValue);
	}
}
