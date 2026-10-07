import { Setting } from 'obsidian';
import {
	catalogSuggestions,
	lessonBounds,
	lessonByTitle,
	lessonPartOptions,
	mediaAliasIndex,
	publicationAliasIndex,
	rankSuggestions,
	shareTitles,
	splitTitleSuffix,
	type LessonSpec,
	type VisitShare,
} from './catalog';
import { mountAlwaysChevron } from './suggest-field';

export interface ShareFieldOptions {
	publications: readonly string[];
	media: readonly string[];
	customLessons: readonly string[];
	lessons: readonly LessonSpec[];
	showLiterature: boolean;
	showLesson: boolean;
	/** Collapsed lesson block for a return visit that is not a study. */
	optionalLesson?: boolean;
	lessonPrefill?: { lesson: string; from: string; to: string };
	initial: VisitShare;
}

/**
 * Literature, media, and lesson fields. Each one is a chevron suggester.
 * A study keeps the lesson block under its own heading, with start and end together.
 */
export function mountShareFields(
	contentEl: HTMLElement,
	options: ShareFieldOptions,
	onChange: (share: VisitShare) => void,
): VisitShare {
	const share: VisitShare = { ...options.initial };
	const publish = (next: Partial<VisitShare>): void => {
		Object.assign(share, next);
		onChange({ ...share });
	};
	if (options.showLiterature) {
		mountTitleList(
			contentEl,
			'What literature did you leave?',
			'Optional. Pick or type a title. It becomes a chip so you can add another.',
			shareTitles(share.publications, share.publicationList),
			(query) => catalogSuggestions(options.publications, [], query, publicationAliasIndex()),
			(values) => publish({ publications: values[0] ?? '', publicationList: values }),
		);
		mountTitleList(
			contentEl,
			'What media did you show?',
			'Optional. Pick or type a title. It becomes a chip so you can add another.',
			shareTitles(share.media, share.mediaList),
			(query) => catalogSuggestions(options.media, [], query, mediaAliasIndex()),
			(values) => publish({ media: values[0] ?? '', mediaList: values }),
		);
	}
	if (options.showLesson) mountLessonBlock(contentEl, options, share, publish, 'Study');
	else if (options.optionalLesson) mountOptionalLesson(contentEl, options, share, publish);
	return share;
}

function mountOptionalLesson(
	contentEl: HTMLElement,
	options: ShareFieldOptions,
	share: VisitShare,
	publish: (next: Partial<VisitShare>) => void,
): void {
	const host = contentEl.createDiv('rv-study-optional');
	const toggle = host.createEl('button', {
		cls: 'rv-study-toggle',
		text: 'Studied a lesson?',
		attr: { type: 'button', 'aria-expanded': 'false' },
	});
	const body = host.createDiv('rv-study-optional-body');
	body.hidden = true;
	let opened = false;
	toggle.addEventListener('click', (event) => {
		event.preventDefault();
		const next = body.hidden;
		body.hidden = !next;
		toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
		if (!next) {
			publish({ lesson: '', lessonFrom: '', lessonTo: '', extraLesson: '', extraFrom: '', extraTo: '' });
			return;
		}
		if (opened) return;
		opened = true;
		const prefill = options.lessonPrefill;
		if (prefill?.lesson) {
			share.lesson = prefill.lesson;
			share.lessonFrom = prefill.from;
			share.lessonTo = prefill.to;
			publish({ lesson: prefill.lesson, lessonFrom: prefill.from, lessonTo: prefill.to });
		}
		mountLessonBlock(body, options, share, publish, 'Study');
	});
}

function mountLessonBlock(
	parent: HTMLElement,
	options: ShareFieldOptions,
	share: VisitShare,
	publish: (next: Partial<VisitShare>) => void,
	heading: string,
): void {
	const block = parent.createDiv('rv-study-block');
	block.createEl('h3', { cls: 'rv-study-heading', text: heading });
	const lessonNames = [
		...options.customLessons,
		...options.lessons.map((lesson) => lesson.title),
	];
	let parts = partsFor(share.lesson, options);
	const from = { current: share.lessonFrom };
	const to = { current: share.lessonTo };
	const holders: { from?: HTMLElement } = {};
	mountField(
		block,
		'What lesson did you work on?',
		'Optional. You do not have to finish the lesson.',
		'Optional',
		share.lesson,
		(query) => rankSuggestions(query, lessonNames),
		(value) => {
			parts = partsFor(value, options);
			const bounds = lessonBounds(value, options.lessons, options.customLessons);
			from.current = bounds.from;
			to.current = bounds.to;
			publish({ lesson: value, lessonFrom: bounds.from, lessonTo: bounds.to });
			repaintRange(holders, parts, from, to, publish);
		},
		false,
		true,
	);
	const range = block.createDiv('rv-lesson-range');
	holders.from = range;
	repaintRange(holders, parts, from, to, publish);
	mountExtraLesson(block, options, share, lessonNames, publish);
}

function mountExtraLesson(
	block: HTMLElement,
	options: ShareFieldOptions,
	share: VisitShare,
	lessonNames: readonly string[],
	publish: (next: Partial<VisitShare>) => void,
): void {
	const host = block.createDiv('rv-study-extra');
	const open = Boolean(share.extraLesson?.trim());
	const select = host.createEl('select', { cls: 'rv-study-extra-select' });
	select.createEl('option', { text: 'One lesson this visit', value: 'one' });
	select.createEl('option', { text: 'Also covered another lesson', value: 'more' });
	select.value = open ? 'more' : 'one';
	const fields = host.createDiv('rv-study-extra-fields');
	const paint = (): void => {
		fields.empty();
		fields.hidden = select.value !== 'more';
		if (fields.hidden) return;
		let parts = partsFor(share.extraLesson ?? '', options);
		const from = { current: share.extraFrom ?? '' };
		const to = { current: share.extraTo ?? '' };
		const holders: { from?: HTMLElement } = {};
		mountField(
			fields,
			'Other lesson',
			'Optional. Only for a visit that covered two lessons.',
			'Optional',
			share.extraLesson ?? '',
			(query) => rankSuggestions(query, lessonNames),
			(value) => {
				parts = partsFor(value, options);
				const bounds = lessonBounds(value, options.lessons, options.customLessons);
				from.current = bounds.from;
				to.current = bounds.to;
				publish({ extraLesson: value, extraFrom: bounds.from, extraTo: bounds.to });
				repaintExtra(holders, parts, from, to, publish);
			},
			false,
			true,
		);
		const range = fields.createDiv('rv-lesson-range');
		holders.from = range;
		repaintExtra(holders, parts, from, to, publish);
	};
	select.addEventListener('change', () => {
		if (select.value !== 'more') publish({ extraLesson: '', extraFrom: '', extraTo: '' });
		paint();
	});
	paint();
}

function partsFor(title: string, options: ShareFieldOptions): readonly string[] {
	return lessonPartOptions(lessonByTitle(title, [...options.customLessons, ...options.lessons.map((lesson) => lesson.title)]));
}

function repaintRange(
	holders: { from?: HTMLElement },
	parts: readonly string[],
	from: { current: string },
	to: { current: string },
	publish: (next: Partial<VisitShare>) => void,
): void {
	const host = holders.from;
	if (!host) return;
	host.empty();
	mountField(host, 'Where did you start?', 'The part you began with.', 'Start', from.current, (query) => rankSuggestions(query, parts), (value) => {
		from.current = value;
		publish({ lessonFrom: value });
	}, false, true);
	mountField(
		host,
		'Where did you end? You completed this point.',
		'Inclusive. The part you finished, even if the lesson continues next time.',
		'End',
		to.current,
		(query) => rankSuggestions(query, parts),
		(value) => {
			to.current = value;
			publish({ lessonTo: value });
		},
		false,
		true,
	);
}

function repaintExtra(
	holders: { from?: HTMLElement },
	parts: readonly string[],
	from: { current: string },
	to: { current: string },
	publish: (next: Partial<VisitShare>) => void,
): void {
	const host = holders.from;
	if (!host) return;
	host.empty();
	mountField(host, 'Where did that one start?', '', 'Start', from.current, (query) => rankSuggestions(query, parts), (value) => {
		from.current = value;
		publish({ extraFrom: value });
	}, false, true);
	mountField(host, 'Where did that one end? You completed this point.', '', 'End', to.current, (query) => rankSuggestions(query, parts), (value) => {
		to.current = value;
		publish({ extraTo: value });
	}, false, true);
}

function mountTitleList(
	parent: HTMLElement,
	name: string,
	desc: string,
	values: readonly string[],
	suggestions: (query: string) => readonly string[],
	onChange: (values: string[]) => void,
): void {
	const items = values.map((item) => item.trim()).filter(Boolean);
	const host = parent.createDiv('rv-share-list');
	const chips = host.createDiv('rv-share-chips');
	const sync = (): void => {
		onChange(items.map((item) => item.trim()).filter(Boolean));
	};
	const paintChips = (): void => {
		chips.empty();
		items.forEach((title, index) => {
			const chip = chips.createSpan('rv-share-chip');
			chip.createSpan({ text: title });
			const remove = chip.createEl('button', {
				cls: 'rv-share-chip-x',
				text: '×',
				attr: { type: 'button', 'aria-label': `Remove ${title}` },
			});
			remove.addEventListener('click', (event) => {
				event.preventDefault();
				items.splice(index, 1);
				paintChips();
				sync();
			});
		});
	};
	paintChips();
	let draft = '';
	const setting = new Setting(host).setName(name);
	if (desc) setting.setDesc(desc);
	setting.addText((text) => {
		text.setPlaceholder('Optional');
		const commit = (value: string): void => {
			const title = value.trim();
			if (!title) return;
			if (!items.some((item) => item.toLowerCase() === title.toLowerCase())) items.push(title);
			draft = '';
			text.setValue('');
			paintChips();
			sync();
		};
		text.onChange((value) => { draft = value; });
		text.inputEl.addEventListener('keydown', (event) => {
			if (!(event instanceof KeyboardEvent) || event.key !== 'Enter') return;
			event.preventDefault();
			commit(draft);
		});
		text.inputEl.addEventListener('blur', () => { commit(draft); });
		mountAlwaysChevron(text.inputEl, () => suggestions(draft), (picked) => {
			commit(picked);
		}, (value) => splitTitleSuffix(value));
	});
}

function mountField(
	parent: HTMLElement,
	name: string,
	desc: string,
	placeholder: string,
	initial: string,
	suggestions: (query: string) => readonly string[],
	onValue: (value: string) => void,
	titled: boolean,
	joined = false,
): void {
	let current = initial;
	const setting = new Setting(parent).setName(name);
	if (joined) setting.settingEl?.style.setProperty('border-top', 'none', 'important');
	if (desc) setting.setDesc(desc);
	setting.addText((text) => {
		text.setPlaceholder(placeholder);
		text.setValue(initial);
		text.onChange((value) => {
			current = value;
			onValue(value);
		});
		mountAlwaysChevron(text.inputEl, () => suggestions(current), (picked) => {
			current = picked;
			text.setValue(picked);
			onValue(picked);
		}, titled ? (value) => splitTitleSuffix(value) : undefined);
	});
}
