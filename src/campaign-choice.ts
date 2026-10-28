import { setIcon } from 'obsidian';

/**
 * The one campaign control: the question, then Covered and Not this time.
 * setIcon replaces an element's children, so the icon is a child and the label stays.
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
	const no = labeledChoice(choice, 'Not this time', 'book-x');
	const yes = labeledChoice(choice, 'Covered', 'book-check');
	const paint = (covered: boolean): void => {
		yes.classList.toggle('is-selected', covered);
		no.classList.toggle('is-selected', !covered);
		yes.classList.remove('mod-cta');
		no.classList.remove('mod-cta');
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
	return block;
}

function labeledChoice(parent: HTMLElement, label: string, icon: string): HTMLButtonElement {
	const button = parent.createEl('button', { attr: { type: 'button' } });
	const mark = button.createSpan('rv-campaign-icon');
	setIcon(mark, icon);
	button.createSpan({ cls: 'rv-campaign-label', text: label });
	return button;
}
