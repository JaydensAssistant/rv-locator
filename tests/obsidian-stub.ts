/** Minimal Obsidian surface so companion modal tests can run in Node. */

class FakeEl {
	children: FakeEl[] = [];
	text = '';
	tag = 'div';
	private listeners = new Map<string, Array<(value?: string) => void>>();

	addClass(_cls?: string): void {}

	setAttribute(_name: string, _value: string): void {}

	createDiv(spec?: string | { cls?: string; text?: string }): FakeEl {
		const el = new FakeEl();
		if (spec && typeof spec === 'object' && spec.text) el.text = spec.text;
		this.children.push(el);
		return el;
	}

	createEl(tag: string, spec?: { text?: string; cls?: string }): FakeEl {
		const el = new FakeEl();
		el.tag = tag;
		el.text = spec?.text ?? '';
		this.children.push(el);
		return el;
	}

	setText(text: string): void {
		this.text = text;
	}

	empty(): void {
		this.children = [];
		this.text = '';
	}

	addEventListener(type: string, fn: (value?: string) => void): void {
		const list = this.listeners.get(type) ?? [];
		list.push(fn);
		this.listeners.set(type, list);
	}

	click(): void {
		for (const fn of this.listeners.get('click') ?? []) fn();
	}

	emit(type: string, value?: string): void {
		if (value !== undefined) this.text = value;
		for (const fn of this.listeners.get(type) ?? []) fn(value);
	}
}

class FakeButton {
	text = '';
	private clickFn: (() => void) | null = null;

	setButtonText(text: string): this {
		this.text = text;
		return this;
	}

	setCta(): this { return this; }

	onClick(fn: () => void): this {
		this.clickFn = fn;
		return this;
	}

	click(): void {
		this.clickFn?.();
	}
}

class FakeTextArea {
	value = '';
	inputEl = { rows: 0 };
	private changeFn: ((value: string) => void) | null = null;

	setValue(value: string): this {
		this.value = value;
		return this;
	}

	setPlaceholder(_placeholder: string): this { return this; }

	onChange(fn: (value: string) => void): this {
		this.changeFn = fn;
		return this;
	}

	apply(value: string): void {
		this.value = value;
		this.changeFn?.(value);
	}
}

export class Modal {
	app: unknown;
	modalEl = new FakeEl();
	contentEl = new FakeEl();
	titleEl = new FakeEl();
	containerEl = new FakeEl();

	constructor(app: unknown) {
		this.app = app;
	}

	open(): void {
		this.onOpen();
	}

	close(): void {
		this.onClose();
	}

	onOpen(): void {}

	onClose(): void {}

	setTitle(_title: string): void {}
}

export class SuggestModal<T> extends Modal {
	limit = 0;
	emptyStateText = '';
	inputEl = { value: '', dispatchEvent(_event: Event): void {} };

	setPlaceholder(_text: string): void {}

	setInstructions(_items: unknown): void {}

	getSuggestions(_query: string): T[] {
		return [];
	}

	renderSuggestion(_value: T, _el: FakeEl): void {}

	onChooseSuggestion(_item: T, _evt: unknown): void {}
}

export class FuzzySuggestModal<T> extends SuggestModal<T> {}

export class Notice {
	constructor(public message?: string) {}
	hide(): void {}
}

export class Setting {
	constructor(private el?: FakeEl) {}
	setName(_name: string): this { return this; }
	setDesc(_desc: string): this { return this; }
	setHeading(): this { return this; }
	addButton(cb: (button: FakeButton) => void): this {
		const button = new FakeButton();
		cb(button);
		const node = this.el?.createEl('button', { text: button.text });
		node?.addEventListener('click', () => { button.click(); });
		return this;
	}
	addTextArea(cb: (text: FakeTextArea) => void): this {
		const text = new FakeTextArea();
		cb(text);
		const node = this.el?.createEl('textarea', { text: text.value });
		node?.addEventListener('change', (value) => { text.apply(value ?? ''); });
		return this;
	}
	addDropdown(_cb: (dropdown: unknown) => void): this { return this; }
	addToggle(_cb: (toggle: unknown) => void): this { return this; }
	addText(_cb: (text: unknown) => void): this { return this; }
}

export class TFile {}
export class TFolder {}

export class Vault {
	static recurseChildren(_folder: unknown, _cb: (child: unknown) => void): void {}
}

export type App = object;

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/');
}
