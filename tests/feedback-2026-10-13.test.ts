import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { BADGE_INK, DIGIT_CAP_INK, LINE_ICON_INK, urgencyInkFraction } from '../src/badge-glyph';
import { navigatingToFile, withReadingPreview } from '../src/reading-open';

function source(file: string): string {
	return readFileSync(file, 'utf8');
}

describe('2026-10-13 feedback', () => {
	it('sizes every badge glyph from one ink fraction', () => {
		assert.equal(BADGE_INK, 0.53);
		assert.ok(Math.abs(LINE_ICON_INK - 20 / 24) < 0.0001);
		assert.equal(DIGIT_CAP_INK, 0.72);
		for (const glyphs of ['!', '!!', '!!!', '○', '—']) {
			assert.ok(Math.abs(urgencyInkFraction(glyphs) - 1) < 0.02, glyphs);
		}
		const css = source('styles.css');
		assert.match(css, /--rv-badge-ink:\s*0\.53/);
		assert.match(css, /--rv-badge-stroke:\s*2px/);
		assert.match(css, /font-weight:\s*500 !important/);
		const glance = source('src/glancable-view.ts');
		assert.match(glance, /var\(--rv-badge-ink, 0\.53\)/);
		assert.match(glance, /pinBadgeStroke\(pill\)/);
		assert.match(source('src/note-chrome.ts'), /pinBadgeStroke\(pill\)/);
		assert.match(source('src/map-view.ts'), /pinBadgeStroke\(priority\)/);
	});

	it('keeps the sort row open until the close button', () => {
		const view = source('src/nearby-view.ts');
		const paint = view.slice(view.indexOf('private paintSortPresets'), view.indexOf('protected paintSortExtras'));
		const pick = paint.slice(paint.indexOf('button.addEventListener'), paint.indexOf('if (glancable && this.sortMenuOpen)'));
		assert.doesNotMatch(pick, /sortMenuOpen = false/);
		assert.match(paint, /this\.sortEl\.createEl\('button'/);
		assert.match(paint, /rv-sort-close/);
		assert.match(paint, /this\.sortMenuOpen = false/);
	});

	it('opens an RV note in Reading before the first paint and leaves a later mode change', () => {
		const open = withReadingPreview({ active: true, state: { mode: 'source', file: 'RVs/Ada.md' } });
		assert.equal(open.state?.mode, 'preview');
		assert.equal(open.state?.source, false);
		assert.equal(open.state?.file, 'RVs/Ada.md');
		assert.equal(open.active, true);
		assert.equal(navigatingToFile('RVs/Ada.md', 'RVs/Ada.md'), false);
		assert.equal(navigatingToFile('RVs/Ada.md', 'RVs/Bea.md'), true);
		assert.equal(navigatingToFile('', 'RVs/Ada.md'), true);
		const main = source('src/main.ts');
		assert.match(main, /installReadingModeOpen/);
		assert.match(main, /withReadingPreview/);
		assert.match(main, /mode: 'preview', source: false/);
	});

	it('keeps urgency on glancable cards unless the card is snoozed', () => {
		const glance = source('src/glancable-view.ts');
		const actions = glance.slice(glance.indexOf('private paintActions'), glance.indexOf('private noteFrontmatter'));
		assert.match(actions, /ghostIconForCard\(row\.path\) === 'moon'/);
		assert.match(actions, /setIcon\(urgencyButton, 'moon'\)/);
		assert.doesNotMatch(actions, /setIcon\(urgencyButton, ghost\)/);
		assert.match(source('src/map-view.ts'), /setIcon\(urgency, pin\.stateIcon\)/);
	});

	it('paints hub, address, and campaign icons in the text color and drops the label icons', () => {
		const css = source('styles.css');
		assert.match(css, /\.rv-dashboard \.rv-hub-add,\s*\.rv-dashboard \.rv-hub-add svg,[\s\S]*color:\s*var\(--text-normal\) !important/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-campaign-mark,[\s\S]*color:\s*var\(--text-normal\) !important/);
		assert.match(css, /\.rv-dash-campaign svg \{[\s\S]*color:\s*var\(--text-normal\) !important/);
		assert.match(css, /font-size:\s*14px !important/);
		const chrome = source('src/note-chrome.ts');
		assert.doesNotMatch(chrome, /paintLabelIcon/);
		assert.match(chrome, /font-size', '14px'/);
		const paint = chrome.slice(chrome.indexOf('function paintUrgencyDetails'), chrome.indexOf('function markUrgencyReady'));
		assert.doesNotMatch(paint, /rv-dash-campaign/);
		assert.doesNotMatch(paint, /rv-locator-campaign-mark/);
	});
});
