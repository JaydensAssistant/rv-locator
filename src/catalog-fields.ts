import { Setting } from 'obsidian';
import {
	catalogSuggestions,
	lessonByTitle,
	lessonPartOptions,
	mediaAliasIndex,
	publicationAliasIndex,
	rankSuggestions,
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
		mountField(
			contentEl,
			'What literature did you leave?',
			'Optional. Type a title or pick one. A new title is kept.',
			'Optional',
			share.publications,
			(query) => catalogSuggestions(options.publications, [], query, publicationAliasIndex()),
			(value) => publish({ publications: value }),
			true,
		);
		mountField(
			contentEl,
			'What media did you show?',
			'Optional. Type a title or pick one. A new title is kept.',
			'Optional',
			share.media,
			(query) => catalogSuggestions(options.media, [], query, mediaAliasIndex()),
			(value) => publish({ media: value }),
			true,
		);
	}
	if (options.showLesson) {
		const block = contentEl.createDiv('rv-study-block');
		block.createEl('h3', { cls: 'rv-study-heading', text: 'Study' });
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
				publish({ lesson: value });
				repaintRange(holders, parts, from, to, publish);
			},
			false,
		);
		const range = block.createDiv('rv-lesson-range');
		holders.from = range;
		repaintRange(holders, parts, from, to, publish);
		mountExtraLesson(block, options, share, lessonNames, publish);
	}
	return share;
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
				publish({ extraLesson: value });
				repaintExtra(holders, parts, from, to, publish);
			},
			false,
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
	}, false);
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
	}, false);
	mountField(host, 'Where did that one end? You completed this point.', '', 'End', to.current, (query) => rankSuggestions(query, parts), (value) => {
		to.current = value;
		publish({ extraTo: value });
	}, false);
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
): void {
	let current = initial;
	const setting = new Setting(parent).setName(name);
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
