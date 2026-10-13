import { MarkdownRenderChild, type App, type MarkdownPostProcessorContext } from 'obsidian';
import { NOTES_MAX_LINES, NOTES_MIN_LINES, fitNotesBox } from './notes-autosize';
import {
	applyExternalVisitNotes,
	clearVisitNoteStore,
	releaseClosedVisitNotes as releaseStorePaths,
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
	const content = area.scrollHeight;
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
	const onFocus = (): void => setVisitNoteFocus(path, key, true);
	const onBlur = (): void => setVisitNoteFocus(path, key, false);
	area.addEventListener('input', onInput);
	area.addEventListener('focus', onFocus);
	area.addEventListener('blur', onBlur);
	fitArea(area);
	return () => {
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
	}

	onunload(): void {
		this.unloadArea?.();
		this.unloadArea = null;
		const area = this.containerEl.querySelector('textarea.rv-native-notes-area');
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
	try {
		area.focus({ preventScroll: true });
	} catch {
		area.focus();
	}
	const end = area.value.length;
	try {
		area.setSelectionRange(end, end);
	} catch {
		/* The box is not editable yet. */
	}
	return area;
}
