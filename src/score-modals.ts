import { Modal, Setting, type App } from 'obsidian';
import { paintReturnDigest } from './attempt-digest';
import type { PlannerSlotView } from './planner';

export class ReturnSuggestModal extends Modal {
	constructor(app: App, private displayName: string, private sentences: readonly string[]) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Suggest return times');
		this.modalEl.addClass('rv-locator-modal');
		const { contentEl } = this;
		contentEl.createDiv({ cls: 'rv-locator-modal-copy', text: this.displayName });
		paintReturnDigest(contentEl.createDiv('rv-locator-return-digest'), this.sentences);
		new Setting(contentEl).addButton((button) => {
			button.setButtonText('Close');
			button.onClick(() => this.close());
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class IdealityPlannerModal extends Modal {
	constructor(
		app: App,
		private territorySpan: number,
		private slots: readonly PlannerSlotView[],
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Ideality planner');
		this.modalEl.addClass('rv-locator-modal');
		const { contentEl } = this;
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: `Distance is held at ${this.territorySpan} miles, so this is who fits the time. Each slot uses that weekday and daypart only.`,
		});
		if (this.slots.length === 0) {
			contentEl.createEl('p', {
				cls: 'rv-locator-modal-copy',
				text: 'Every upcoming weekday and daypart is Off, or its multiplier is 0. Mark Willing or Go out to plan.',
			});
		}
		for (const slot of this.slots) {
			const block = contentEl.createDiv('rv-locator-plan-slot');
			block.createDiv({ cls: 'rv-locator-check-title', text: slot.label });
			if (slot.rows.length === 0) {
				block.createEl('p', { cls: 'rv-locator-modal-copy', text: 'No RV here has a priority and Last Spoke to score.' });
				continue;
			}
			for (const row of slot.rows) {
				block.createEl('p', {
					cls: 'rv-locator-modal-copy',
					text: `${row.name} — ideality ${row.ideality.toFixed(2)}`,
				});
			}
		}
		new Setting(contentEl).addButton((button) => {
			button.setButtonText('Close');
			button.onClick(() => this.close());
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
