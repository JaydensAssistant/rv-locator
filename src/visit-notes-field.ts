import { MarkdownRenderChild, type App, type MarkdownPostProcessorContext } from 'obsidian';
import { NOTES_MAX_LINES, NOTES_MIN_LINES, fitNotesBox } from './notes-autosize';
import {
	applyExternalVisitNotes,
	clearVisitNoteStore,
	releaseClosedVisitNotes as releaseStorePaths,
	flushVisitNotes,
	setVisitNoteFocus,
	subscribeVisitNote,
	unsubscribeVisitNote,
	visitNoteValue,
	writeVisitNote,
} from './visit-notes-store';

const RAW_NOTE = /^['"`]?INPUT\[textArea:(sVisit\d+Notes)\]['"`]?$/;
const INPUT_KEY = /INPUT\[textArea:(sVisit\d+Notes)\]/;

/** The file the open editor is showing. Writes are still stored per path. */
let activeNotePath = '';

/**
 * Set when the user is still in a notes box at the moment that box leaves
 * the document. A remount may put the caret back only for that same key.
 */
let caretHold: { path: string; key: string } | null = null;

const releasedDocs = new WeakSet<Document>();

export function isVisitNotesArea(node: EventTarget | null | undefined): node is HTMLTextAreaElement {
	return node instanceof HTMLTextAreaElement && (
		node.classList.contains('rv-native-notes-area') || node.classList.contains('rv-visit-note')
	);
}

/**
 * Mobile reading view does not blur a textarea when the tap lands on a div,
 * a callout title, or the map button. Release the caret on any pointerdown
 * outside the box that currently has it. The listener does not stop the event.
 */
export function installVisitNoteRelease(doc: Document): void {
	if (releasedDocs.has(doc)) return;
	releasedDocs.add(doc);
	doc.addEventListener('pointerdown', (event) => {
		releaseVisitNoteCaret(doc, event.target);
	}, true);
}

/** Blur the notes box that has the caret, unless the event is inside that box. */
export function releaseVisitNoteCaret(doc: Document, target?: EventTarget | null): void {
	const active = doc.activeElement;
	if (!isVisitNotesArea(active)) return;
	if (target instanceof Node && (target === active || active.contains(target))) return;
	active.blur();
}

export function rememberVisitNoteCaret(path: string, key: string): void {
	caretHold = { path, key };
}

export function forgetVisitNoteCaret(path: string, key: string): void {
	if (caretHold?.path === path && caretHold.key === key) caretHold = null;
}

/**
 * Put the caret back after a remount only when this box still owned it.
 * Another field that already took focus is left alone. `preventScroll` so a
 * flush cannot jump the note to an off-screen box.
 */
export function restoreVisitNoteCaret(area: HTMLTextAreaElement, path: string, key: string): boolean {
	if (!caretHold || caretHold.path !== path || caretHold.key !== key) return false;
	const active = area.ownerDocument.activeElement;
	caretHold = null;
	if (active instanceof HTMLElement && active.isConnected && active !== area) {
		const tag = active.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable) return false;
	}
	const end = area.value.length;
	try {
		area.focus({ preventScroll: true });
	} catch {
		try {
			area.focus();
		} catch {
			return false;
		}
	}
	try {
		area.setSelectionRange(end, end);
	} catch {
		/* The box is not editable yet. */
	}
	return area.ownerDocument.activeElement === area;
}

export function setActiveVisitNote(path: string): void {
	activeNotePath = path;
}

export function activeVisitNotePath(): string {
	return activeNotePath;
}

/** Drop every cached note. Used when the plugin unloads. */
export function clearVisitNoteCaches(): void {
	clearVisitNoteStore();
}

export function releaseClosedVisitNotes(openPaths: ReadonlySet<string>): void {
	releaseStorePaths(openPaths);
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

/** The frontmatter key inside an `INPUT[textArea:…]` declaration. */
export function rawVisitNoteKey(text: string): string | null {
	const match = RAW_NOTE.exec(text.replace(/\s+/g, ' ').trim());
	return match?.[1] ?? null;
}

export function noteValuesFromFrontmatter(frontmatter: Record<string, unknown> | null | undefined): Record<string, string> {
	const values: Record<string, string> = {};
	if (!frontmatter) return values;
	for (const [key, value] of Object.entries(frontmatter)) {
		if (!/^sVisit\d+Notes$/.test(key)) continue;
		values[key] = typeof value === 'string' ? value : value == null ? '' : String(value);
	}
	return values;
}

function directText(node: HTMLElement): string {
	let text = '';
	for (const child of Array.from(node.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? '';
	}
	return text;
}

function fitArea(area: HTMLTextAreaElement): void {
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
	const content = area.value.length === 0 ? min : area.scrollHeight;
	const next = Math.min(max, Math.max(min, content || min));
	area.style.height = `${Math.ceil(next)}px`;
	area.style.overflowY = content > max + 1 ? 'auto' : 'hidden';
}

/**
 * Wire one textarea to the store. Returns an unload function.
 * The writer is not notified of its own write.
 */
export function attachVisitNoteArea(area: HTMLTextAreaElement, path: string, key: string): () => void {
	area.classList.add('rv-native-notes-area');
	area.dataset.rvNotesKey = key;
	area.dataset.rvNoteKey = key;
	area.dataset.rvNoteFile = path;
	const stored = visitNoteValue(path, key);
	if (area.value === '' && stored) area.value = stored;
	const id = subscribeVisitNote(path, key, (value) => {
		if (area.value === value) return;
		area.value = value;
		fitArea(area);
	});
	const onInput = (): void => {
		writeVisitNote(path, key, area.value, id);
		fitArea(area);
	};
	const onFocus = (): void => {
		setVisitNoteFocus(path, key, true);
		rememberVisitNoteCaret(path, key);
	};
	const onBlur = (): void => {
		// A tap away saves immediately. A remount blur (the node is already
		// gone) keeps the caret token so the replacement can take it back.
		if (area.value !== visitNoteValue(path, key)) writeVisitNote(path, key, area.value, id);
		flushVisitNotes(path);
		setVisitNoteFocus(path, key, false);
		if (area.isConnected) forgetVisitNoteCaret(path, key);
	};
	installVisitNoteRelease(area.ownerDocument);
	area.addEventListener('input', onInput);
	area.addEventListener('focus', onFocus);
	area.addEventListener('blur', onBlur);
	let lastWidth = -1;
	const onResize = (): void => {
		const width = area.clientWidth;
		if (width === lastWidth) return;
		lastWidth = width;
		fitArea(area);
	};
	let resize: ResizeObserver | null = null;
	if (typeof ResizeObserver === 'function') {
		resize = new ResizeObserver(() => onResize());
		resize.observe(area);
	}
	fitArea(area);
	lastWidth = area.clientWidth;
	return () => {
		if (area.value !== visitNoteValue(path, key)) writeVisitNote(path, key, area.value, id);
		flushVisitNotes(path);
		resize?.disconnect();
		unsubscribeVisitNote(id);
		area.removeEventListener('input', onInput);
		area.removeEventListener('focus', onFocus);
		area.removeEventListener('blur', onBlur);
	};
}

/**
 * Reading-view field. Mounted on the declaration element Obsidian already
 * rendered. A reused section is left alone, so the caret and undo stay.
 */
export class VisitNotesField extends MarkdownRenderChild {
	private unloadArea: (() => void) | null = null;

	constructor(
		host: HTMLElement,
		private readonly path: string,
		private readonly key: string,
	) {
		super(host);
	}

	onload(): void {
		const host = this.containerEl;
		host.classList.add('mb-none', 'rv-visit-notes-host');
		host.dataset.rvNotesKey = this.key;
		stripInputText(host, this.key);
		const found = host.querySelector('textarea');
		if (found instanceof HTMLElement && host.dataset.rvNotesLive === this.key) return;
		const area = found instanceof HTMLElement && found.tagName === 'TEXTAREA'
			? found as HTMLTextAreaElement
			: host.ownerDocument.createElement('textarea');
		if (!area.parentElement) host.appendChild(area);
		area.rows = 1;
		area.value = visitNoteValue(this.path, this.key);
		this.unloadArea = attachVisitNoteArea(area, this.path, this.key);
		host.dataset.rvNotesLive = this.key;
		restoreVisitNoteCaret(area, this.path, this.key);
	}

	onunload(): void {
		const area = this.containerEl.querySelector('textarea.rv-native-notes-area');
		if (area instanceof HTMLTextAreaElement && area.value !== visitNoteValue(this.path, this.key)) {
			writeVisitNote(this.path, this.key, area.value, null);
		}
		const focused = area instanceof HTMLTextAreaElement && area.ownerDocument.activeElement === area;
		if (focused) rememberVisitNoteCaret(this.path, this.key);
		else forgetVisitNoteCaret(this.path, this.key);
		this.unloadArea?.();
		this.unloadArea = null;
		area?.remove();
		delete this.containerEl.dataset.rvNotesLive;
	}
}

function declarationHosts(root: HTMLElement): { host: HTMLElement; key: string }[] {
	const found: { host: HTMLElement; key: string }[] = [];
	const nodes: HTMLElement[] = [];
	const walk = (node: HTMLElement): void => {
		nodes.push(node);
		for (const kid of Array.from(node.children)) {
			if (kid instanceof HTMLElement) walk(kid);
		}
	};
	walk(root);
	for (const node of nodes) {
		const match = INPUT_KEY.exec(directText(node)) ?? INPUT_KEY.exec((node.textContent ?? '').replace(/\s+/g, ' '));
		if (!match?.[1]) continue;
		const deeper = found.some((item) => node.contains(item.host));
		if (deeper) continue;
		for (let index = found.length - 1; index >= 0; index -= 1) {
			const item = found[index];
			if (item && item.host.contains(node)) found.splice(index, 1);
		}
		found.push({ host: node, key: match[1] });
	}
	return found;
}

/** Drop the raw `INPUT[textArea:…]` text Obsidian put in the code element. */
function stripInputText(host: HTMLElement, key: string): void {
	const needle = `INPUT[textArea:${key}]`;
	const roots: HTMLElement[] = [host];
	if (host.tagName !== 'CODE') {
		host.querySelectorAll('code').forEach((node) => {
			if (node instanceof HTMLElement) roots.push(node);
		});
	}
	for (const root of roots) {
		for (const node of Array.from(root.childNodes)) {
			if (node.nodeType !== Node.TEXT_NODE) continue;
			if (!(node.textContent ?? '').includes(needle)) continue;
			node.remove();
		}
	}
}

/**
 * Mount a field on each INPUT declaration in this section.
 * Frontmatter comes from the file at `ctx.sourcePath`, never from `ctx.frontmatter`.
 * A section Obsidian reused already has the field, and is left alone.
 */
export function mountVisitNotesInSection(
	element: HTMLElement,
	ctx: Pick<MarkdownPostProcessorContext, 'sourcePath' | 'addChild'>,
	app: App,
): void {
	const path = ctx.sourcePath;
	const file = app.vault.getFileByPath(path);
	if (file) {
		const front = app.metadataCache.getFileCache(file)?.frontmatter;
		applyExternalVisitNotes(path, noteValuesFromFrontmatter(front ?? null));
	}
	for (const { host, key } of declarationHosts(element)) {
		if (host.dataset.rvNotesLive === key && host.querySelector('textarea.rv-native-notes-area')) continue;
		ctx.addChild(new VisitNotesField(host, path, key));
	}
}

/** Put the caret in the box for this key. One focus, no hold and no restore. */
export function focusVisitNoteField(root: HTMLElement, key: string): HTMLTextAreaElement | null {
	const area = root.querySelector(`textarea.rv-native-notes-area[data-rv-notes-key="${key}"]`);
	if (!(area instanceof HTMLTextAreaElement)) return null;
	area.tabIndex = 0;
	const end = area.value.length;
	try {
		area.focus();
	} catch {
		try {
			area.focus({ preventScroll: true });
		} catch {
			/* The box cannot take focus yet. */
		}
	}
	try {
		area.setSelectionRange(end, end);
	} catch {
		/* The box is not editable yet. */
	}
	return area;
}
