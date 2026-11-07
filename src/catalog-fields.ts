import { Setting } from 'obsidian';
import {
	catalogBands,
	catalogSuggestions,
	lessonBounds,
	lessonByTitle,
	lessonPartOptions,
	mediaAliasIndex,
	publicationAliasIndex,
	rankSuggestions,
	recentCatalogTitles,
	rememberRecentCatalog,
	shareTitles,
	type LessonSpec,
	type VisitShare,
} from './catalog';
import { companionChoices } from './companions';
import { mountAlwaysChevron } from './suggest-field';
import { displayTitle, paintedSuffix } from './title-fit';
import { mountStudyPanel } from './study-panel';

export interface ShareFieldOptions {
	publications: readonly string[];
	media: readonly string[];
	customLessons: readonly string[];
	lessons: readonly LessonSpec[];
	showLiterature: boolean;
	showLesson: boolean;
	/** Studies wrap literature and media in a collapsed disclosure. */
	literatureCollapsed?: boolean;
	/** Study-status notes put Study above Literature and media. */
	studyFirst?: boolean;
	/** Studies start the lesson disclosure open. */
	lessonExpanded?: boolean;
	/** Collapsed "Studied a lesson?" block. Every visit modal starts here. */
	optionalLesson?: boolean;
	lessonPrefill?: { lesson: string; from: string; to: string };
	/** Study log asks who came along, after literature and before the campaign row. */
	askCompanion?: boolean;
	companions?: readonly string[];
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
	const publicationAliases = publicationAliasIndex();
	const mediaAliases = mediaAliasIndex();
	const publish = (next: Partial<VisitShare>): void => {
		Object.assign(share, next);
		onChange({ ...share });
	};
	const mountStudy = (): void => {
		if (options.showLesson) mountLessonBlock(contentEl, options, share, publish, 'Study');
		else if (options.optionalLesson) mountOptionalLesson(contentEl, options, share, publish, options.lessonExpanded === true);
	};
	if (options.studyFirst) mountStudy();
	if (options.showLiterature) {
		const paintLists = (parent: HTMLElement): void => {
			mountTitleList(
				parent,
				'What literature did you leave?',
				'',
				shareTitles(share.publications, share.publicationList),
				(query) => catalogSuggestions(options.publications, [], query, publicationAliases),
				(values) => publish({ publications: values[0] ?? '', publicationList: values }),
				'Optional (e.g. Will Suffering Ever End?)',
			);
			mountTitleList(
				parent,
				'What media did you show?',
				'',
				shareTitles(share.media, share.mediaList),
				(query) => catalogSuggestions(options.media, [], query, mediaAliases),
				(values) => publish({ media: values[0] ?? '', mediaList: values }),
				'Optional (e.g. Why Study the Bible?)',
			);
		};
		if (options.literatureCollapsed) mountDisclosure(contentEl, 'Literature and media', paintLists);
		else paintLists(contentEl);
	}
	if (!options.studyFirst) mountStudy();
	if (options.askCompanion) {
		mountField(
			contentEl,
			'What publisher came with you?',
			'',
			'Optional (e.g. Sister Johnson)',
			share.companion ?? '',
			(query) => companionChoices(options.companions ?? [], query).map((item) => item.label),
			(value) => publish({ companion: value }),
			false,
		);
	}
	return share;
}

function mountDisclosure(
	contentEl: HTMLElement,
	label: string,
	onOpen: (body: HTMLElement) => void,
): void {
	const host = contentEl.createDiv('rv-study-optional');
	const toggle = host.createEl('button', {
		cls: 'rv-study-toggle',
		text: label,
		attr: { type: 'button', 'aria-expanded': 'false' },
	});
	const body = host.createDiv('rv-study-optional-body');
	body.hidden = true;
	let opened = false;
	toggle.addEventListener('click', (event) => {
		event?.preventDefault();
		const next = body.hidden;
		body.hidden = !next;
		toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
		if (!next || opened) return;
		opened = true;
		onOpen(body);
	});
}

function mountOptionalLesson(
	contentEl: HTMLElement,
	options: ShareFieldOptions,
	share: VisitShare,
	publish: (next: Partial<VisitShare>) => void,
	startOpen: boolean,
): void {
	const host = contentEl.createDiv('rv-study-optional');
	const toggle = host.createEl('button', {
		cls: 'rv-study-toggle',
		text: 'Study',
		attr: { type: 'button', 'aria-expanded': startOpen ? 'true' : 'false' },
	});
	const body = host.createDiv('rv-study-optional-body');
	body.hidden = !startOpen;
	let opened = false;
	const reveal = (): void => {
		if (opened) return;
		opened = true;
		const prefill = options.lessonPrefill;
		// Study status opens this section on its own and logs that next lesson.
		// A manual expand still waits for Did study, Change, or a mode.
		if (startOpen && !share.lesson.trim() && prefill?.lesson) {
			share.lesson = prefill.lesson;
			share.lessonFrom = prefill.from;
			share.lessonTo = prefill.to;
			publish({ lesson: prefill.lesson, lessonFrom: prefill.from, lessonTo: prefill.to });
		}
		mountStudyPanel(body, options, share, publish);
	};
	if (startOpen) reveal();
	toggle.addEventListener('click', (event) => {
		event?.preventDefault();
		const next = body.hidden;
		body.hidden = !next;
		toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
		if (!next) {
			publish({ lesson: '', lessonFrom: '', lessonTo: '', extraLesson: '', extraFrom: '', extraTo: '' });
			return;
		}
		reveal();
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
	if (heading !== 'Study') block.createEl('h3', { cls: 'rv-study-heading', text: heading });
	mountStudyPanel(block, options, share, publish);
}
/** One pick is the title and its type. Several picks are the first title plus the rest of the count. */
export function pickFieldSummary(values: readonly string[], kind: 'literature' | 'media'): string {
	const items = values.map((item) => item.trim()).filter(Boolean);
	if (items.length === 0) return '';
	const first = displayTitle(items[0] ?? '', kind);
	if (items.length === 1) return `${first.text}${paintedSuffix(first.suffix)}`.trim();
	return `${first.text} +${items.length - 1}`;
}

/** Closed field: the title truncates, the type stays, and a later count is its own pill. */
export function closedPickParts(
	items: readonly string[],
	kind: 'literature' | 'media',
): { text: string; suffix: string; count: string } {
	const chosen = items.map((item) => item.trim()).filter(Boolean);
	if (chosen.length === 0) return { text: '', suffix: '', count: '' };
	const first = displayTitle(chosen[0] ?? '', kind);
	return {
		text: first.text,
		suffix: first.suffix,
		count: chosen.length > 1 ? `+${chosen.length - 1}` : '',
	};
}

function mountTitleList(
	parent: HTMLElement,
	name: string,
	desc: string,
	values: readonly string[],
	suggestions: (query: string) => readonly string[],
	onChange: (values: string[]) => void,
	placeholder: string,
): void {
	const items = values.map((item) => item.trim()).filter(Boolean);
	const host = parent.createDiv('rv-share-list');
	const kind = /media/i.test(name) ? 'media' as const : 'literature' as const;
	let draft = '';
	const setting = new Setting(host).setName(name);
	if (desc) setting.setDesc(desc);
	const summary = (): string => pickFieldSummary(items, kind);
	const sync = (): void => {
		onChange(items.map((item) => item.trim()).filter(Boolean));
	};
	setting.addText((text) => {
		text.setPlaceholder(placeholder);
		const paintField = (): void => {
			draft = '';
			text.setValue(summary());
			const view = text.inputEl?.ownerDocument?.defaultView;
			if (view && typeof text.inputEl.dispatchEvent === 'function') {
				text.inputEl.dispatchEvent(new view.Event('rv-closed-refresh'));
			}
		};
		const toggle = (picked: string): void => {
			const title = picked.trim();
			if (!title) return;
			const index = items.findIndex((item) => item.toLowerCase() === title.toLowerCase());
			if (index >= 0) items.splice(index, 1);
			else {
				items.push(title);
				rememberRecentCatalog(title);
			}
			paintField();
			sync();
		};
		text.onChange((value) => {
			draft = value === summary() ? '' : value;
		});
		text.inputEl.addEventListener('blur', () => {
			const dataset = text.inputEl?.dataset;
			if (dataset?.rvPicking === '1') {
				delete dataset.rvPicking;
				return;
			}
			const title = draft.trim();
			if (title && title !== summary() && !items.some((item) => item.toLowerCase() === title.toLowerCase())) {
				items.push(title);
				rememberRecentCatalog(title);
				sync();
			}
			paintField();
		});
		mountAlwaysChevron(
			text.inputEl,
			() => suggestions(draft),
			toggle,
			() => closedPickParts(items, kind),
			(rows) => catalogBands(rows, [...items, ...recentCatalogTitles()], kind === 'media' ? 'Video' : ''),
			{ picked: () => items, keepOpen: true },
		);
		paintField();
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
		}, titled ? (value) => {
			const parts = displayTitle(value, 'lesson');
			return { text: parts.text, suffix: parts.suffix };
		} : undefined);
	});
}
