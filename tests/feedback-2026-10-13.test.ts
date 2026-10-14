import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { BADGE_INK, BADGE_OPTICAL, DIGIT_CAP_INK, LINE_ICON_INK, LINE_ICON_INK_BY_ICON, badgeLineOpticalKey, urgencyInkFraction, urgencyOpticalKey } from '../src/badge-glyph';
import { navigatingToFile, withReadingPreview } from '../src/reading-open';

function source(file: string): string {
	return readFileSync(file, 'utf8');
}

describe('2026-10-13 feedback', () => {
	it('sizes every badge glyph from one ink fraction', () => {
		assert.equal(BADGE_INK, 0.53);
		assert.ok(Math.abs(LINE_ICON_INK - 20 / 24) < 0.0001);
		assert.equal(LINE_ICON_INK_BY_ICON.moon, 20 / 24);
		assert.equal(LINE_ICON_INK_BY_ICON.route, 22 / 24);
		assert.equal(LINE_ICON_INK_BY_ICON.hourglass, 22 / 24);
		assert.equal(LINE_ICON_INK_BY_ICON.ban, 22 / 24);
		assert.equal(DIGIT_CAP_INK, 0.72);
		for (const glyphs of ['!', '!!', '!!!', '○', '—']) {
			assert.ok(urgencyInkFraction(glyphs) > 0.8, glyphs);
		}
		const css = source('styles.css');
		assert.match(css, /--rv-badge-ink:\s*0\.53/);
		assert.match(css, /--rv-badge-stroke:\s*2px/);
		assert.match(css, /font-weight:\s*500 !important/);
		for (const [key, value] of Object.entries(BADGE_OPTICAL)) {
			assert.match(css, new RegExp(`--rv-opt-${key}:\\s*${value}(;|\\s)`));
		}
		for (const [key, value] of Object.entries(LINE_ICON_INK_BY_ICON)) {
			const fraction = value.toFixed(4);
			assert.match(css, new RegExp(`data-rv-glyph="${key}"\\] \\{[\\s\\S]*?--rv-line-ink:\\s*${fraction}`));
		}
		assert.ok(BADGE_OPTICAL.digit < 1 && BADGE_OPTICAL.bang < 1 && BADGE_OPTICAL.dash < 1);
		assert.ok(BADGE_OPTICAL.ring > 1 && BADGE_OPTICAL.route > 1 && BADGE_OPTICAL.moon > 1);
		assert.ok(BADGE_OPTICAL.hourglass > 1 && BADGE_OPTICAL.ban > 1);
		assert.equal(urgencyOpticalKey('!'), 'bang');
		assert.equal(urgencyOpticalKey('○'), 'ring');
		assert.equal(urgencyOpticalKey('—'), 'dash');
		assert.equal(badgeLineOpticalKey('route'), 'route');
		assert.equal(badgeLineOpticalKey('book'), null);
		const glance = source('src/glancable-view.ts');
		assert.match(glance, /var\(--rv-badge-ink, 0\.53\)/);
		assert.match(glance, /pinBadgeStroke\(pill\)/);
		assert.match(glance, /tagBadgeIcon\(urgencyButton, 'moon'\)/);
		assert.match(glance, /tagBadgeIcon\(button, 'route'\)/);
		assert.match(source('src/note-chrome.ts'), /pinBadgeStroke\(pill\)/);
		assert.match(source('src/note-chrome.ts'), /tagBadgeIcon\(button, ghost\)/);
		assert.match(source('src/note-chrome.ts'), /tagBadgeIcon\(route, 'route'\)/);
		assert.match(source('src/map-view.ts'), /pinBadgeStroke\(priority\)/);
		assert.match(source('src/map-view.ts'), /tagBadgeIcon\(urgency, pin\.stateIcon\)/);
		assert.match(source('src/map-view.ts'), /tagBadgeIcon\(route, 'route'\)/);
		assert.match(css, /stroke-width:\s*var\(--rv-badge-stroke\) !important/);
		assert.match(css, /font-size:\s*calc\(var\(--rv-control-size, 28px\) \* var\(--rv-badge-ink\) \/ var\(--rv-digit-ink\) \* var\(--rv-opt-digit\)\) !important/);
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
		const onload = main.slice(main.indexOf('async onload()'), main.indexOf('onunload()'));
		assert.doesNotMatch(onload, /getLeaf/);
		const install = main.slice(main.indexOf('private installReadingModeOpen'), main.indexOf('private previewStateFor'));
		assert.match(install, /WorkspaceLeaf\.prototype/);
		assert.doesNotMatch(install, /getLeaf/);
		const imported = main.slice(0, main.indexOf('from \'obsidian\''));
		assert.match(imported, /\bWorkspaceLeaf\b/);
		assert.doesNotMatch(imported, /type WorkspaceLeaf/);
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

	it('lifts the mobile sort bar above the floating navbar and leaves embeds alone', () => {
		const css = source('styles.css');
		assert.match(css, /body\.is-mobile \.workspace-leaf-content \.rv-locator-glancable\.is-stacked \.rv-locator-sortbar \{[^}]*padding-bottom:\s*calc\(env\(safe-area-inset-bottom, 0px\) \+ 48px\)/);
		assert.match(css, /body\.is-mobile \.workspace-leaf-content :is\(\.markdown-preview-view, \.markdown-source-view, \.markdown-embed, \.internal-embed\) \.rv-locator-glancable\.is-stacked \.rv-locator-sortbar \{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom, 0px\)/);
	});

	it('paints the review strip with the live accent ink and each icon box', () => {
		const strip = source('scripts/badge-optical-strip.ts');
		assert.match(strip, /urgencyInkFor/);
		assert.match(strip, /LINE_ICON_INK_BY_ICON/);
		assert.doesNotMatch(strip, /urgencyInk\(/);
	});
});
