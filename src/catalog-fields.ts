import { Setting } from 'obsidian';
import { catalogSuggestions, lessonByTitle, lessonPartOptions, rankSuggestions, type LessonSpec, type VisitShare } from './catalog';
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
 * Lesson start and end appear after a lesson is chosen.
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
		mountField(contentEl, 'What literature did you leave?', 'book-open', share.publications, (query) => (
			catalogSuggestions(options.publications, [], query)
		), (value) => publish({ publications: value }));
		mountField(contentEl, 'What media did you show?', 'clapperboard', share.media, (query) => (
			catalogSuggestions(options.media, [], query)
		), (value) => publish({ media: value }));
	}
	if (options.showLesson) {
		const lessonNames = [
			...options.customLessons,
			...options.lessons.map((lesson) => lesson.title),
		];
		let parts = partsFor(share.lesson, options);
		const from = { current: share.lessonFrom };
		const to = { current: share.lessonTo };
		const holders: { from?: HTMLElement; to?: HTMLElement } = {};
		mountField(contentEl, 'What lesson did you complete?', 'book-marked', share.lesson, (query) => (
			rankSuggestions(query, lessonNames)
		), (value) => {
			parts = partsFor(value, options);
			publish({ lesson: value });
			repaintRange(holders, parts, from, to, publish);
		});
		const range = contentEl.createDiv('rv-lesson-range');
		holders.from = range;
		repaintRange(holders, parts, from, to, publish);
	}
	return share;
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
	mountField(host, 'Where did you start?', 'flag', from.current, (query) => rankSuggestions(query, parts), (value) => {
		from.current = value;
		publish({ lessonFrom: value });
	});
	mountField(host, 'Where did you end?', 'flag-off', to.current, (query) => rankSuggestions(query, parts), (value) => {
		to.current = value;
		publish({ lessonTo: value });
	});
}

function mountField(
	parent: HTMLElement,
	name: string,
	_icon: string,
	initial: string,
	suggestions: (query: string) => readonly string[],
	onValue: (value: string) => void,
): void {
	let current = initial;
	new Setting(parent)
		.setName(name)
		.addText((text) => {
			text.setValue(initial);
			text.onChange((value) => {
				current = value;
				onValue(value);
			});
			mountAlwaysChevron(text.inputEl, () => suggestions(current), (picked) => {
				current = picked;
				text.setValue(picked);
				onValue(picked);
			});
		});
}
