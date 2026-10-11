import { Modal, Setting, type App } from 'obsidian';
import { campaignIsActive, localDay, type CampaignRecord } from './campaign';
import { mountCampaignChoice } from './campaign-choice';
import { iconizeModal } from './modal-chrome';
import { coverageQuestion } from './modals';

/** Name a campaign, or cancel the one that is already active. Only one is active. */
export class CampaignModal extends Modal {
	private name = '';
	private start = localDay();
	private end = '';
	private saved = false;
	private confirming = false;

	constructor(
		app: App,
		private current: CampaignRecord | null,
		private onSave: (next: CampaignRecord | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Campaign');
		this.modalEl.addClass('rv-locator-modal');
		const { contentEl } = this;
		const active = campaignIsActive(this.current);
		if (active && this.current) {
			this.name = this.current.name;
			this.start = this.current.start;
			this.end = this.current.end;
		}
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: active
				? 'End this campaign before starting another.'
				: 'One campaign at a time. The start date is today.',
		});
		new Setting(contentEl)
			.setName('Name')
			.addText((text) => {
				text.setPlaceholder('Campaign name');
				text.setValue(this.name);
				text.onChange((value) => { this.name = value; });
			});
		new Setting(contentEl)
			.setName('Start date')
			.addText((text) => {
				text.inputEl.type = 'date';
				text.setValue(this.start);
				text.onChange((value) => { this.start = value; });
			});
		new Setting(contentEl)
			.setName('End date')
			.setDesc('Optional.')
			.addText((text) => {
				text.inputEl.type = 'date';
				text.setPlaceholder('');
				text.setValue(this.end);
				text.onChange((value) => { this.end = value; });
			});
		new Setting(contentEl).addButton((button) => {
			if (active) {
				button.setButtonText('End campaign');
				button.setWarning();
				button.onClick(() => this.askRemove());
			} else {
				button.setButtonText('Start campaign');
				button.setCta();
				button.onClick(() => this.startCampaign());
			}
		});
		iconizeModal(contentEl);
	}

	/** The first click asks. The campaign stays until they confirm. */
	private askRemove(): void {
		if (this.confirming) return;
		this.confirming = true;
		const { contentEl } = this;
		const ask = contentEl.createDiv({ cls: 'rv-locator-modal-copy' });
		ask.setText('Remove this campaign?');
		const actions = contentEl.createDiv('rv-locator-suggest-actions');
		const remove = actions.createEl('button', { text: 'Remove', attr: { type: 'button' } });
		remove.addEventListener('click', () => {
			this.saved = true;
			this.onSave(null);
			this.close();
		});
		const keep = actions.createEl('button', { text: 'Keep', attr: { type: 'button' } });
		keep.addEventListener('click', () => {
			this.confirming = false;
			ask.empty();
			actions.empty();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private startCampaign(): void {
		const name = this.name.trim();
		if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(this.start)) return;
		const end = /^\d{4}-\d{2}-\d{2}$/.test(this.end) ? this.end : '';
		this.saved = true;
		this.onSave({ name, start: this.start, end, covered: [] });
		this.close();
	}
}

/** Yes or no, used when a home visit is logged outside the companion suggester. */
export function askCampaignCovered(
	app: App,
	campaignName: string,
	pronoun: 'him' | 'her' | 'them' = 'them',
): Promise<boolean> {
	return new Promise((resolve) => {
		const modal = new Modal(app);
		let answered = false;
		const finish = (covered: boolean) => {
			if (answered) return;
			answered = true;
			resolve(covered);
			modal.close();
		};
		modal.onOpen = () => {
			modal.setTitle(campaignName);
			modal.modalEl.addClass('rv-locator-modal');
			mountCampaignChoice(
				modal.contentEl,
				coverageQuestion(pronoun, campaignName),
				true,
				(covered) => finish(covered),
			);
			iconizeModal(modal.contentEl);
		};
		modal.onClose = () => {
			modal.contentEl.empty();
			if (!answered) resolve(false);
		};
		modal.open();
	});
}
