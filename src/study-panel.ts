import { setIcon } from 'obsidian';
import {
	lessonBounds,
	lessonByTitle,
	lessonPartOptions,
	rankSuggestions,
	type LessonSpec,
	type VisitShare,
} from './catalog';
import { formatLessonLine, partwayCopy } from './lesson-stops';

export interface StudyPanelOptions {
	customLessons: readonly string[];
	lessons: readonly LessonSpec[];
	lessonPrefill?: { lesson: string; from: string; to: string };
}

type StudyMode = 'partway' | 'finished' | 'next';

/**
 * Study row: lesson line, Change at the row midpoint, Didn't study pinned right,
 * then Partway | Finished | Next lesson. The stop slider shows only for Partway
 * and under a lesson header for Next lesson.
 */
export function mountStudyPanel(
	parent: HTMLElement,
	options: StudyPanelOptions,
	share: VisitShare,
	publish: (next: Partial<VisitShare>) => void,
): void {
	const names = [...options.customLessons, ...options.lessons.map((lesson) => lesson.title)];
	let skipped = !share.lesson.trim();
	let mode: StudyMode = initialMode(share, options);
	let stopIndex = stopIndexFor(share, options, mode);
	const host = parent.createDiv('rv-study-panel');

	const paint = (): void => {
		host.empty();
		const line = host.createDiv('rv-study-line');
		const label = line.createSpan({ cls: 'rv-study-label', text: skipped ? 'No study' : studyLine(share, options, mode, stopIndex) });
		label.setAttribute('aria-label', label.textContent ?? '');
		const change = line.createEl('button', { cls: 'rv-study-change', text: 'Change', attr: { type: 'button' } });
		const skip = line.createEl('button', { cls: 'rv-study-skip', text: "Didn't study", attr: { type: 'button' } });
		skip.classList.toggle('is-on', skipped);
		change.addEventListener('click', (event) => {
			event?.preventDefault?.();
			openChange(host, names, options, share, () => {
				skipped = false;
				mode = 'finished';
				stopIndex = stopIndexFor(share, options, mode);
				commit();
				paint();
			});
		});
		skip.addEventListener('click', (event) => {
			event?.preventDefault?.();
			skipped = !skipped;
			if (skipped) {
				share.lesson = '';
				share.lessonFrom = '';
				share.lessonTo = '';
				share.extraLesson = '';
				share.extraFrom = '';
				share.extraTo = '';
			} else if (options.lessonPrefill?.lesson) {
				share.lesson = options.lessonPrefill.lesson;
				share.lessonFrom = options.lessonPrefill.from;
				share.lessonTo = options.lessonPrefill.to;
				mode = 'finished';
			}
			commit();
			paint();
		});
		if (skipped) return;
		const modes = host.createDiv('rv-study-modes');
		for (const item of [
			['partway', 'Partway', 'gauge'],
			['finished', 'Finished', 'check'],
			['next', 'Next lesson', 'skip-forward'],
		] as const) {
			const button = modes.createEl('button', { attr: { type: 'button', 'aria-label': item[1] } });
			const icon = button.createSpan('rv-study-mode-icon');
			setIcon(icon, item[2]);
			button.createSpan({ cls: 'rv-study-mode-text', text: item[1] });
			button.classList.toggle('is-selected', mode === item[0]);
			button.addEventListener('click', (event) => {
				event?.preventDefault?.();
				mode = item[0];
				stopIndex = stopIndexFor(share, options, mode);
				commit();
				paint();
			});
		}
		if (mode === 'finished') return;
		const parts = partsForMode(share, options, mode);
		const stop = host.createDiv('rv-study-stop');
		if (mode === 'next') {
			const nextTitle = nextLessonTitle(share.lesson, options.lessons);
			stop.createEl('p', { cls: 'rv-study-next-head', text: formatLessonLine(nextTitle, '') || 'Next lesson' });
		}
		const copy = partwayCopy(parts, stopIndex);
		if (mode === 'partway') {
			const began = share.lessonFrom || parts[0] || '';
			stop.createEl('p', {
				cls: 'rv-study-began',
				text: began ? `Started at ${formatLessonLine(share.lesson, began)}` : 'Started at',
			});
		}
		stop.createEl('p', { cls: 'rv-study-done', text: copy.done });
		const slider = stop.createEl('input', { attr: { type: 'range', min: '0', max: String(Math.max(0, parts.length - 1)), value: String(stopIndex) } });
		slider.classList.add('rv-study-slider');
		if ('value' in slider) (slider as HTMLInputElement).value = String(stopIndex);
		const ticks = stop.createDiv('rv-study-ticks');
		const paintTicks = (): void => {
			const clearer = ticks as HTMLElement & { empty?: () => void };
			if (typeof clearer.empty === 'function') clearer.empty();
			else ticks.replaceChildren();
			parts.forEach((part, index) => {
				const tick = ticks.createSpan({ cls: 'rv-study-tick', text: part });
				if (index === stopIndex) tick.classList.add('is-current');
			});
		};
		paintTicks();
		slider.addEventListener('input', (event) => {
			const raw = (event as { target?: { value?: string } } | undefined)?.target?.value ?? (slider as HTMLInputElement).value;
			stopIndex = Number(raw) || 0;
			commit();
			const live = partwayCopy(parts, stopIndex);
			const done = stop.querySelector('.rv-study-done');
			const next = stop.querySelector('.rv-study-next');
			if (done) done.textContent = live.done;
			if (next) next.textContent = live.next;
			paintTicks();
			if (mode === 'partway') return;
			const heading = host.querySelector('.rv-study-label');
			if (heading) heading.textContent = studyLine(share, options, mode, stopIndex);
		});
		stop.createEl('p', { cls: 'rv-study-next', text: copy.next });
	};

	const commit = (): void => {
		if (skipped || !share.lesson.trim()) {
			publish({ lesson: '', lessonFrom: '', lessonTo: '', extraLesson: '', extraFrom: '', extraTo: '' });
			return;
		}
		const startParts = lessonPartOptions(lessonByTitle(share.lesson, names));
		const start = share.lessonFrom || startParts[0] || '';
		if (mode === 'next') {
			const catalog = [...options.customLessons, ...options.lessons.map((lesson) => lesson.title)];
			const last = startParts[startParts.length - 1] ?? '';
			const reached = share.lessonTo.trim();
			const atEnd = !reached || reached.toLowerCase() === last.toLowerCase();
			const fromPart = atEnd ? (share.lessonFrom || startParts[0] || '') : reached;
			const nextTitle = nextLessonTitle(share.lesson, options.lessons);
			const nextParts = lessonPartOptions(lessonByTitle(nextTitle, catalog));
			const end = nextParts[stopIndex] ?? nextParts[nextParts.length - 1] ?? '';
			const crossed = nextTitle.trim().toLowerCase() !== share.lesson.trim().toLowerCase();
			share.lessonFrom = fromPart;
			share.lessonTo = last || fromPart;
			share.extraLesson = crossed ? nextTitle : '';
			share.extraFrom = crossed ? (nextParts[0] ?? '') : '';
			share.extraTo = crossed ? end : '';
			publish({
				lesson: share.lesson,
				lessonFrom: share.lessonFrom,
				lessonTo: share.lessonTo,
				extraLesson: share.extraLesson,
				extraFrom: share.extraFrom,
				extraTo: share.extraTo,
			});
			return;
		}
		const end = mode === 'finished'
			? (startParts[startParts.length - 1] ?? '')
			: (startParts[stopIndex] ?? start);
		share.lessonFrom = start;
		share.lessonTo = end;
		share.extraLesson = '';
		share.extraFrom = '';
		share.extraTo = '';
		publish({ lesson: share.lesson, lessonFrom: start, lessonTo: end, extraLesson: '', extraFrom: '', extraTo: '' });
	};

	paint();
}

function initialMode(share: VisitShare, options: StudyPanelOptions): StudyMode {
	if (share.extraLesson?.trim()) return 'next';
	const parts = lessonPartOptions(lessonByTitle(share.lesson, [...options.customLessons, ...options.lessons.map((lesson) => lesson.title)]));
	const end = share.lessonTo.trim().toLowerCase();
	const last = (parts[parts.length - 1] ?? '').toLowerCase();
	if (end && last && end !== last) return 'partway';
	return 'finished';
}

function stopIndexFor(share: VisitShare, options: StudyPanelOptions, mode: StudyMode): number {
	const parts = partsForMode(share, options, mode);
	const wanted = (mode === 'next' ? share.extraTo : share.lessonTo)?.trim().toLowerCase() ?? '';
	const index = parts.findIndex((part) => part.toLowerCase() === wanted);
	return index >= 0 ? index : 0;
}

function partsForMode(share: VisitShare, options: StudyPanelOptions, mode: StudyMode): readonly string[] {
	const names = [...options.customLessons, ...options.lessons.map((lesson) => lesson.title)];
	const title = mode === 'next' ? nextLessonTitle(share.lesson, options.lessons) : share.lesson;
	return lessonPartOptions(lessonByTitle(title, names));
}

function displayPart(share: VisitShare, options: StudyPanelOptions, mode: StudyMode, _stopIndex: number): string {
	if (mode === 'finished' || mode === 'partway') return share.lessonFrom || 'Intro';
	const parts = partsForMode(share, options, 'partway');
	return share.lessonFrom || parts[0] || '';
}

/** The line under the modes. Partway follows the slider. Next lesson shows both ends. */
function studyLine(share: VisitShare, options: StudyPanelOptions, mode: StudyMode, stopIndex: number): string {
	if (!share.lesson.trim()) return 'No study';
	if (mode !== 'next') return formatLessonLine(share.lesson, displayPart(share, options, mode, stopIndex));
	const names = [...options.customLessons, ...options.lessons.map((lesson) => lesson.title)];
	const nextTitle = nextLessonTitle(share.lesson, options.lessons);
	const nextParts = lessonPartOptions(lessonByTitle(nextTitle, names));
	const end = nextParts[stopIndex] ?? share.extraTo ?? '';
	const from = share.lessonFrom || '';
	if (!nextTitle.trim() || nextTitle.trim().toLowerCase() === share.lesson.trim().toLowerCase()) {
		return formatLessonLine(share.lesson, from);
	}
	return `${formatLessonLine(share.lesson, from)} → ${formatLessonLine(nextTitle, end)}`;
}

function nextLessonTitle(current: string, lessons: readonly LessonSpec[]): string {
	const wanted = current.trim().toLowerCase();
	let at = lessons.findIndex((lesson) => lesson.title.trim().toLowerCase() === wanted);
	if (at < 0) {
		const bare = wanted.replace(/^\d+\s+/, '');
		at = lessons.findIndex((lesson) => lesson.title.trim().toLowerCase().replace(/^\d+\s+/, '') === bare);
	}
	if (at < 0) {
		const number = /^(\d+)/.exec(current.trim());
		if (number) {
			const n = String(Number(number[1]));
			at = lessons.findIndex((lesson) => {
				const lead = /^0*(\d+)/.exec(lesson.title.trim());
				return lead != null && String(Number(lead[1])) === n;
			});
		}
	}
	if (at < 0) return current;
	return lessons[at + 1]?.title ?? current;
}

function openChange(
	host: HTMLElement,
	names: readonly string[],
	options: StudyPanelOptions,
	share: VisitShare,
	onDone: () => void,
): void {
	host.ownerDocument.querySelectorAll('.rv-study-change-modal').forEach((node) => node.remove());
	const panel = host.ownerDocument.createElement('div');
	panel.className = 'rv-study-change-modal';
	host.ownerDocument.body.appendChild(panel);
	panel.createEl('p', { cls: 'rv-study-change-title', text: 'Change study' });
	const input = panel.createEl('input', { attr: { type: 'search', placeholder: 'Search lessons' } });
	const list = panel.createDiv('rv-study-change-list');
	let picked = share.lesson;
	let startIndex = 0;
	const startLabel = panel.createEl('p', { cls: 'rv-study-start-label', text: 'Start at' });
	const slider = panel.createEl('input', { attr: { type: 'range', min: '0', max: '0', value: '0' } });
	slider.classList.add('rv-study-slider');
	const ticks = panel.createDiv('rv-study-ticks');
	const partsNow = (): readonly string[] => lessonPartOptions(lessonByTitle(picked, names));
	const paintSlider = (): void => {
		const live = partsNow();
		const max = Math.max(0, live.length - 1);
		if (startIndex > max) startIndex = 0;
		slider.setAttribute('max', String(max));
		slider.setAttribute('value', String(startIndex));
		if ('value' in slider) (slider as HTMLInputElement).value = String(startIndex);
		ticks.replaceChildren();
		live.forEach((part, index) => {
			const tick = ticks.createSpan({ cls: 'rv-study-tick', text: part });
			if (index === startIndex) tick.classList.add('is-current');
		});
		const current = live[startIndex] ?? '';
		startLabel.textContent = current ? `Start at ${current}` : 'Start at';
	};
	const paintList = (query: string): void => {
		list.replaceChildren();
		for (const title of rankSuggestions(query, names)) {
			const row = list.createEl('button', { text: title, attr: { type: 'button' } });
			if (title === picked) row.classList.add('is-selected');
			row.addEventListener('click', (event) => {
				event?.preventDefault?.();
				picked = title;
				startIndex = 0;
				const bounds = lessonBounds(picked, options.lessons, options.customLessons);
				share.lesson = picked;
				share.lessonFrom = bounds.from;
				paintList(query);
				paintSlider();
			});
		}
	};
	input.addEventListener('input', () => {
		const value = (input as HTMLInputElement).value ?? '';
		paintList(value);
	});
	slider.addEventListener('input', () => {
		startIndex = Number((slider as HTMLInputElement).value) || 0;
		const live = partsNow();
		share.lessonFrom = live[startIndex] ?? live[0] ?? '';
		startLabel.textContent = live[startIndex] ? `Start at ${live[startIndex]}` : 'Start at';
		ticks.querySelectorAll('.rv-study-tick').forEach((node, index) => {
			node.classList.toggle('is-current', index === startIndex);
		});
	});
	paintList('');
	paintSlider();
	const actions = panel.createDiv('rv-modal-actions is-footer');
	const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
	const done = actions.createEl('button', { text: 'Done', attr: { type: 'button' } });
	done.classList.add('mod-cta');
	done.textContent = 'Done';
	cancel.addEventListener('click', (event) => {
		event?.preventDefault?.();
		panel.remove();
	});
	done.addEventListener('click', (event) => {
		event?.preventDefault?.();
		const live = partsNow();
		share.lesson = picked;
		share.lessonFrom = live[startIndex] ?? live[0] ?? '';
		share.lessonTo = live[live.length - 1] ?? '';
		panel.remove();
		onDone();
	});
}
