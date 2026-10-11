/** Minimal Obsidian surface so companion modal tests can run in Node. */

class FakeEl {
	children: FakeEl[] = [];
	text = '';
	tag = 'div';
	parentElement: FakeEl | null = null;
	classList = {
		add: (_token?: string) => {},
		remove: (_token?: string) => {},
		toggle: (_token?: string, _force?: boolean) => false,
		contains: (_token?: string) => false,
	};
	private listeners = new Map<string, Array<(value?: unknown) => void>>();

	addClass(_cls?: string): this { return this; }

	setAttribute(_name: string, _value: string): void {}

	createDiv(spec?: string | { cls?: string; text?: string }): FakeEl {
		const el = new FakeEl();
		el.parentElement = this;
		if (spec && typeof spec === 'object' && spec.text) el.text = spec.text;
		this.children.push(el);
		return el;
	}

	createSpan(spec?: string | { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
		return this.createEl('span', typeof spec === 'object' ? spec : undefined);
	}

	setCssProps(_props: Record<string, string>): void {}

	createEl(tag: string, spec?: { text?: string; cls?: string }): FakeEl {
		const el = new FakeEl();
		el.tag = tag;
		el.parentElement = this;
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

	contains(node: FakeEl | null): boolean {
		if (!node) return false;
		if (node === this) return true;
		return this.children.some((child) => child === node || child.contains(node));
	}

	addEventListener(type: string, fn: (value?: unknown) => void): void {
		const list = this.listeners.get(type) ?? [];
		list.push(fn);
		this.listeners.set(type, list);
	}

	click(): void {
		for (const fn of this.listeners.get('click') ?? []) fn();
	}

	emit(type: string, value?: unknown): void {
		if (value !== undefined) this.text = value;
		for (const fn of this.listeners.get(type) ?? []) fn(value);
	}
}

class FakeButton {
	text = '';
	cta = false;
	warning = false;
	buttonEl: HTMLElement | null = null;
	private clickFn: (() => void) | null = null;

	setTooltip(_text: string): this { return this; }

	setButtonText(text: string): this {
		this.text = text;
		return this;
	}

	setCta(): this {
		this.cta = true;
		return this;
	}

	setWarning(): this {
		this.warning = true;
		return this;
	}

	setDisabled(_disabled?: boolean): this { return this; }

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

class FakeColor {
	value = '';
	setValue(value: string): this {
		this.value = value;
		return this;
	}
	onChange(_fn: (value: string) => void): this { return this; }
}

class FakeText {
	value = '';
	inputEl: FakeEl;

	constructor(parent?: FakeEl) {
		this.inputEl = new FakeEl();
		this.inputEl.tag = 'input';
		this.inputEl.parentElement = parent ?? null;
		parent?.children.push(this.inputEl);
	}

	setValue(value: string): this {
		this.value = value;
		return this;
	}

	setPlaceholder(_placeholder: string): this { return this; }

	setDisabled(_disabled?: boolean): this { return this; }

	onChange(fn: (value: string) => void): this {
		this.inputEl.addEventListener('input', (value) => {
			if (typeof value === 'string') this.value = value;
			fn(this.value);
		});
		return this;
	}
}

function isRealElement(el: unknown): el is HTMLElement {
	return !!el && typeof (el as HTMLElement).appendChild === 'function' && typeof (el as HTMLElement).ownerDocument?.createElement === 'function';
}

export class Setting {
	controlEl: HTMLElement | FakeEl = new FakeEl();
	settingEl: HTMLElement | FakeEl | null = null;
	nameEl: HTMLElement | null = null;
	descEl: HTMLElement | null = null;
	infoEl: HTMLElement | null = null;
	constructor(private el?: HTMLElement | FakeEl) {
		if (!isRealElement(el)) return;
		const doc = el.ownerDocument;
		const item = doc.createElement('div');
		item.className = 'setting-item';
		const info = doc.createElement('div');
		info.className = 'setting-item-info';
		const name = doc.createElement('div');
		name.className = 'setting-item-name';
		const desc = doc.createElement('div');
		desc.className = 'setting-item-description';
		const control = doc.createElement('div');
		control.className = 'setting-item-control';
		info.append(name, desc);
		item.append(info, control);
		el.appendChild(item);
		this.settingEl = item;
		this.infoEl = info;
		this.nameEl = name;
		this.descEl = desc;
		this.controlEl = control;
	}
	setClass(cls: string): this {
		if (isRealElement(this.settingEl)) this.settingEl.classList.add(...cls.split(/\s+/).filter(Boolean));
		return this;
	}
	addColorPicker(cb: (picker: FakeColor) => void): this {
		cb(new FakeColor());
		if (isRealElement(this.controlEl)) {
			const input = this.controlEl.ownerDocument.createElement('input');
			input.type = 'color';
			this.controlEl.appendChild(input);
		}
		return this;
	}
	setName(name: string): this {
		if (this.nameEl) this.nameEl.textContent = name;
		return this;
	}
	setDesc(desc: string): this {
		if (this.descEl) this.descEl.textContent = desc;
		return this;
	}
	setHeading(): this { return this; }
	addButton(cb: (button: FakeButton) => void): this {
		const button = new FakeButton();
		const node = isRealElement(this.controlEl) ? this.controlEl.ownerDocument.createElement('button') : null;
		if (node) {
			node.type = 'button';
			button.buttonEl = node;
		}
		cb(button);
		if (node && isRealElement(this.controlEl)) {
			node.textContent = button.text;
			if (button.cta) node.classList.add('mod-cta');
			if (button.warning) node.classList.add('mod-warning');
			node.addEventListener('click', () => { button.click(); });
			this.controlEl.appendChild(node);
			return this;
		}
		const fake = (this.el as FakeEl | undefined)?.createEl('button', { text: button.text });
		fake?.addEventListener('click', () => { button.click(); });
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
	addSlider(cb: (slider: {
		setLimits: () => unknown;
		setValue: () => unknown;
		setDynamicTooltip: () => unknown;
		onChange: () => unknown;
	}) => void): this {
		if (isRealElement(this.controlEl)) {
			const input = this.controlEl.ownerDocument.createElement('input');
			input.type = 'range';
			this.controlEl.appendChild(input);
		}
		const slider = {
			setLimits() { return slider; },
			setValue() { return slider; },
			setDynamicTooltip() { return slider; },
			onChange() { return slider; },
		};
		cb(slider);
		return this;
	}
	addToggle(_cb: (toggle: unknown) => void): this { return this; }
	addText(cb: (text: FakeText) => void): this {
		if (isRealElement(this.controlEl)) {
			const input = this.controlEl.ownerDocument.createElement('input');
			input.type = 'text';
			this.controlEl.appendChild(input);
			const text = {
				inputEl: input,
				setPlaceholder(value: string) {
					input.placeholder = value;
					return text;
				},
				setValue(value: string) {
					input.value = value;
					return text;
				},
				onChange(fn: (value: string) => void) {
					input.addEventListener('input', () => { fn(input.value); });
					return text;
				},
			};
			cb(text as unknown as FakeText);
			return this;
		}
		cb(new FakeText(this.el as FakeEl | undefined));
		return this;
	}
}

export class TFile {}
export class TFolder {}

export class Vault {
	static recurseChildren(_folder: unknown, _cb: (child: unknown) => void): void {}
}

export type App = object;

export const Platform = {
	isMobile: false,
	isMobileApp: false,
	isDesktop: true,
	isMacOS: false,
};

export class Menu {
	addItem(cb: (item: MenuItem) => void): this {
		cb(new MenuItem());
		return this;
	}

	showAtMouseEvent(_event: MouseEvent): void {}
}

class MenuItem {
	setTitle(_title: string): this { return this; }
	setIcon(_icon: string): this { return this; }
	onClick(_cb: () => void): this { return this; }
}

export function setIcon(parent: unknown, iconId: string): void {
	const hook = (globalThis as { __rvSetIcon?: (parent: unknown, id: string) => void }).__rvSetIcon;
	if (hook) hook(parent, iconId);
	void parent;
	void iconId;
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/');
}

export class ItemView {}
export class BasesView {}
export class HoverPopover {}
export const Keymap = { isModEvent: () => false };
export function addIcon(_id?: string, _svg?: string): void {}
export function getIcon(_id?: string): null { return null; }
export function displayTooltip(_el?: unknown, _text?: string): void {}
export class BooleanValue {}
export class DateValue {}
export class ListValue {}
export class NullValue {}
export class NumberValue {}
export class StringValue {}
export function parsePropertyId(id: string): string { return id; }
