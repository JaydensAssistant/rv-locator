import { setIcon } from 'obsidian';

/**
 * The one campaign control: the question, then Covered and Not this time.
 * Covered starts selected. The book icon is painted by the shared modal icon table.
 */
export function mountCampaignChoice(
	parent: HTMLElement,
	question: string,
	initial: boolean,
	onChange: (covered: boolean) => void,
): HTMLElement {
	const block = parent.createDiv('rv-campaign-choice');
	block.createEl('p', { cls: 'rv-locator-modal-copy rv-campaign-question', text: question });
	const choice = block.createDiv('rv-locator-suggest-actions rv-campaign-actions');
	const yes = choice.createEl('button', { text: 'Covered', attr: { type: 'button' } });
	const no = choice.createEl('button', { text: 'Not this time', attr: { type: 'button' } });
	const paint = (covered: boolean): void => {
		yes.classList.toggle('mod-cta', covered);
		no.classList.toggle('mod-cta', !covered);
		yes.setAttribute('aria-pressed', covered ? 'true' : 'false');
		no.setAttribute('aria-pressed', covered ? 'false' : 'true');
	};
	paint(initial);
	yes.addEventListener('click', () => {
		onChange(true);
		paint(true);
	});
	no.addEventListener('click', () => {
		onChange(false);
		paint(false);
	});
	setIcon(yes, 'book-check');
	setIcon(no, 'book-x');
	return block;
}
