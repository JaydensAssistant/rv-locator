/**
 * Per-file cache for `sVisitNNotes`.
 *
 * A burst of keystrokes becomes one flush. The field that wrote is not told
 * about its own write. An external value is dropped for a short quiet period
 * after a local write, and a focused box keeps an external value until blur.
 */

export const NOTE_WRITE_MS = 250;
export const NOTE_QUIET_MS = 1000;

export type NoteFlush = (path: string, writes: Readonly<Record<string, string>>) => void;

export type NoteListener = (value: string) => void;

interface Subscription {
	id: number;
	path: string;
	key: string;
	listener: NoteListener;
}

interface FileNotes {
	values: Map<string, string>;
	dirty: Map<string, string>;
	timer: ReturnType<typeof setTimeout> | null;
	quietUntil: number;
	focused: Set<string>;
	pendingExternal: Map<string, string>;
}

const files = new Map<string, FileNotes>();
const subscriptions = new Map<number, Subscription>();
let nextId = 1;
let flushImpl: NoteFlush = () => {};

function ensure(path: string): FileNotes {
	let file = files.get(path);
	if (!file) {
		file = {
			values: new Map(),
			dirty: new Map(),
			timer: null,
			quietUntil: 0,
			focused: new Set(),
			pendingExternal: new Map(),
		};
		files.set(path, file);
	}
	return file;
}

/** The plugin wires this to one `processFrontMatter` call. */
export function bindVisitNoteFlush(fn: NoteFlush): void {
	flushImpl = fn;
}

export function clearVisitNoteStore(): void {
	for (const file of files.values()) {
		if (file.timer != null) clearTimeout(file.timer);
	}
	files.clear();
	subscriptions.clear();
}

/** A closed note drops its cache. Open notes keep theirs. */
export function releaseClosedVisitNotes(openPaths: ReadonlySet<string>): void {
	for (const path of [...files.keys()]) {
		if (!openPaths.has(path)) {
			const file = files.get(path);
			if (file?.timer != null) clearTimeout(file.timer);
			files.delete(path);
		}
	}
	for (const [id, sub] of subscriptions) {
		if (!openPaths.has(sub.path)) subscriptions.delete(id);
	}
}

export function visitNoteValue(path: string, key: string): string {
	return files.get(path)?.values.get(key) ?? '';
}

export function subscribeVisitNote(path: string, key: string, listener: NoteListener): number {
	const id = nextId;
	nextId += 1;
	subscriptions.set(id, { id, path, key, listener });
	return id;
}

export function unsubscribeVisitNote(id: number): void {
	subscriptions.delete(id);
}

function notify(path: string, key: string, value: string, except: number | null): void {
	for (const sub of subscriptions.values()) {
		if (sub.path !== path || sub.key !== key || sub.id === except) continue;
		sub.listener(value);
	}
}

function flushPath(path: string): void {
	const file = files.get(path);
	if (!file) return;
	file.timer = null;
	if (file.dirty.size === 0) return;
	const writes: Record<string, string> = {};
	for (const [key, value] of file.dirty) writes[key] = value;
	file.dirty.clear();
	file.quietUntil = Date.now() + NOTE_QUIET_MS;
	flushImpl(path, writes);
}

/**
 * Local edit. Dirty keys share one flush. `writerId` is not notified.
 * Another open box for the same key is.
 */
export function writeVisitNote(path: string, key: string, value: string, writerId: number | null): void {
	const file = ensure(path);
	file.values.set(key, value);
	file.dirty.set(key, value);
	file.quietUntil = Date.now() + NOTE_QUIET_MS;
	if (file.timer == null) file.timer = setTimeout(() => flushPath(path), NOTE_WRITE_MS);
	notify(path, key, value, writerId);
}

export function setVisitNoteFocus(path: string, key: string, focused: boolean): void {
	const file = ensure(path);
	if (focused) {
		file.focused.add(key);
		return;
	}
	file.focused.delete(key);
	const pending = file.pendingExternal.get(key);
	if (pending == null) return;
	file.pendingExternal.delete(key);
	if (Date.now() < file.quietUntil) return;
	if (file.values.get(key) === pending) return;
	file.values.set(key, pending);
	notify(path, key, pending, null);
}

/**
 * Frontmatter that did not come from this box.
 * Dropped during the quiet window. A focused key waits until blur.
 */
export function applyExternalVisitNotes(path: string, values: Readonly<Record<string, string>>): void {
	const file = ensure(path);
	if (Date.now() < file.quietUntil) return;
	for (const [key, value] of Object.entries(values)) {
		if (file.focused.has(key)) {
			file.pendingExternal.set(key, value);
			continue;
		}
		file.pendingExternal.delete(key);
		if (file.values.get(key) === value) continue;
		file.values.set(key, value);
		notify(path, key, value, null);
	}
}

/** Flush one file now. Tests use this; the timer does the same in the plugin. */
export function flushVisitNotes(path?: string): void {
	const paths = path != null ? [path] : [...files.keys()];
	for (const id of paths) {
		const file = files.get(id);
		if (!file) continue;
		if (file.timer != null) clearTimeout(file.timer);
		flushPath(id);
	}
}
