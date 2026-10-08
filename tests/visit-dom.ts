/**
 * Enough of a document tree to run layoutVisitNotes in Node.
 * Installed as HTMLElement so the layout's instanceof checks accept it.
 */

type Listener = (event: { preventDefault: () => void }) => void;

class ClassList {
	private names = new Set<string>();

	add(...values: string[]): void {
		for (const value of values) {
			for (const part of value.split(/\s+/)) if (part) this.names.add(part);
		}
	}

	remove(...values: string[]): void {
		for (const value of values) this.names.delete(value);
	}

	contains(value: string): boolean {
		return this.names.has(value);
	}

	toggle(value: string, force?: boolean): boolean {
		const on = force ?? !this.names.has(value);
		if (on) this.names.add(value);
		else this.names.delete(value);
		return on;
	}

	clear(): void {
		this.names.clear();
	}
}

class DomDoc {
	createElement(tag: string): DomEl {
		return new DomEl(tag, this);
	}

	createElementNS(_namespace: string, tag: string): DomEl {
		return new DomEl(tag, this);
	}
}

export class DomEl {
	readonly classList = new ClassList();
	readonly dataset: Record<string, string> = {};
	parentElement: DomEl | null = null;
	ownerDocument: DomDoc;
	private tag: string;
	private text = '';
	private kids: DomEl[] = [];
	private listeners = new Map<string, Listener[]>();
	private attrs = new Map<string, string>();

	constructor(tag: string, doc: DomDoc) {
		this.tag = tag.toLowerCase();
		this.ownerDocument = doc;
	}

	get tagName(): string {
		return this.tag.toUpperCase();
	}

	get className(): string {
		return '';
	}

	set className(value: string) {
		this.classList.clear();
		this.classList.add(value);
	}

	get children(): DomEl[] {
		return this.kids;
	}

	get textContent(): string {
		const nested = this.kids.map((kid) => kid.textContent ?? '').join('');
		return `${this.text}${nested}`;
	}

	set textContent(value: string) {
		this.kids = [];
		this.text = value;
	}

	get nextElementSibling(): DomEl | null {
		if (!this.parentElement) return null;
		const index = this.parentElement.kids.indexOf(this);
		return this.parentElement.kids[index + 1] ?? null;
	}

	get previousElementSibling(): DomEl | null {
		if (!this.parentElement) return null;
		const index = this.parentElement.kids.indexOf(this);
		return index > 0 ? this.parentElement.kids[index - 1] ?? null : null;
	}

	private detach(child: DomEl): void {
		const parent = child.parentElement;
		if (!parent) return;
		const index = parent.kids.indexOf(child);
		if (index >= 0) parent.kids.splice(index, 1);
		child.parentElement = null;
	}

	appendChild(child: DomEl): DomEl {
		this.detach(child);
		child.parentElement = this;
		this.kids.push(child);
		return child;
	}

	insertBefore(child: DomEl, before: DomEl | null): DomEl {
		if (!before) return this.appendChild(child);
		this.detach(child);
		const index = this.kids.indexOf(before);
		child.parentElement = this;
		if (index < 0) this.kids.push(child);
		else this.kids.splice(index, 0, child);
		return child;
	}

	remove(): void {
		this.parentElement?.detach(this);
		this.parentElement = null;
	}

	contains(node: DomEl | null): boolean {
		if (!node) return false;
		let cursor: DomEl | null = node;
		while (cursor) {
			if (cursor === this) return true;
			cursor = cursor.parentElement;
		}
		return false;
	}

	closest(selector: string): DomEl | null {
		let cursor: DomEl | null = this;
		while (cursor) {
			if (cursor.matches(selector)) return cursor;
			cursor = cursor.parentElement;
		}
		return null;
	}

	matches(selector: string): boolean {
		return selector.split(',').some((part) => matchesOne(this, part.trim()));
	}

	querySelector(selector: string): DomEl | null {
		return this.querySelectorAll(selector)[0] ?? null;
	}

	querySelectorAll(selector: string): DomEl[] {
		const found: DomEl[] = [];
		const walk = (node: DomEl) => {
			for (const kid of node.kids) {
				if (kid.matches(selector)) found.push(kid);
				walk(kid);
			}
		};
		walk(this);
		return found;
	}

	setAttribute(name: string, value: string): void {
		this.attrs.set(name, value);
	}

	getAttribute(name: string): string | null {
		return this.attrs.get(name) ?? null;
	}

	addEventListener(type: string, listener: Listener): void {
		const list = this.listeners.get(type) ?? [];
		list.push(listener);
		this.listeners.set(type, list);
	}

	click(): void {
		for (const listener of this.listeners.get('click') ?? []) listener({ preventDefault() { /* click */ } });
	}
}

function matchesOne(el: DomEl, selector: string): boolean {
	if (!selector) return false;
	const tokens = selector.match(/[.#]?[A-Za-z0-9_-]+/g) ?? [];
	if (tokens.length === 0) return false;
	for (const token of tokens) {
		if (token.startsWith('.')) {
			if (!el.classList.contains(token.slice(1))) return false;
		} else if (el.tagName !== token.toUpperCase()) return false;
	}
	return true;
}

function installElement(): void {
	const host = globalThis as { HTMLElement?: new () => object };
	if (typeof host.HTMLElement === 'function') return;
	host.HTMLElement = class HTMLElement {};
}

installElement();

const Base = (globalThis as { HTMLElement: new () => object }).HTMLElement;
Object.setPrototypeOf(DomEl.prototype, Base.prototype);

export function createDoc(): DomDoc {
	return new DomDoc();
}
