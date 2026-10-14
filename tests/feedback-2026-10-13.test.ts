import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { BADGE_INK, BADGE_OPTICAL, DIGIT_CAP_INK, LINE_ICON_INK, LINE_ICON_INK_BY_ICON, badgeLineOpticalKey, urgencyInkFraction, urgencyOpticalKey } from '../src/badge-glyph';
import { appendBadge, wholeCardHeight, type BadgeFace } from '../src/glancable-view';
import { splitTitleSuffix } from '../src/catalog';
import { factsRowMargin } from '../src/note-chrome';
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
		assert.match(glance, /function appendBadge/);
		assert.match(glance, /pinBadgeStroke\(button\)/);
		assert.match(glance, /tagBadgeIcon\(button, face\.icon\)/);
		assert.match(glance, /mountUrgencyGlyph\(button, face\.glyphs\)/);
		const facts = source('src/note-chrome.ts');
		const title = facts.slice(facts.indexOf('function paintFactsTitle'), facts.indexOf('function paintFactsBody'));
		assert.match(title, /appendBadge\(badges,/);
		assert.doesNotMatch(title, /setIcon\(|hourglass|is-ghost/);
		assert.match(source('src/map-view.ts'), /appendBadge\(actions,/);
		assert.match(source('src/map-view.ts'), /setIcon\(head, pin\.stateIcon\)/);
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
		assert.match(actions, /icon: 'moon'/);
		assert.doesNotMatch(actions, /setIcon\(urgencyButton, ghost\)|icon: 'hourglass'|icon: 'ban'/);
		assert.match(source('src/map-view.ts'), /setIcon\(head, pin\.stateIcon\)/);
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
		assert.match(css, /body\.is-mobile \.workspace-leaf-content \.rv-locator-glancable\.is-stacked \.rv-locator-sortbar \{[^}]*padding-bottom:\s*calc\(var\(--navbar-height, 52px\) \+ var\(--navbar-bottom-offset, 34px\) \+ 8px\)/);
		assert.match(css, /body\.is-mobile \.workspace-leaf-content :is\(\.markdown-preview-view, \.markdown-source-view, \.markdown-embed, \.internal-embed\) \.rv-locator-glancable\.is-stacked \.rv-locator-sortbar \{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom, 0px\)/);
	});

	it('paints the review strip with the live accent ink and each icon box', () => {
		const strip = source('scripts/badge-optical-strip.ts');
		assert.match(strip, /urgencyInkFor/);
		assert.match(strip, /LINE_ICON_INK_BY_ICON/);
		assert.doesNotMatch(strip, /urgencyInk\(/);
	});

	it('gives Quick Facts and cards the same badge markup on a whole pixel', () => {
		const css = source('styles.css');
		assert.match(css, /\.rv-qf-badges \{[^}]*gap:\s*6px/);
		assert.match(css, /\.rv-qf-badges \{[^}]*width:\s*max-content/);
		const chrome = source('src/note-chrome.ts');
		const glance = source('src/glancable-view.ts');
		const map = source('src/map-view.ts');
		assert.match(glance, /Math\.round\(rect\.left\)/);
		assert.doesNotMatch(glance, /style\.transform = `translate/);
		assert.doesNotMatch(glance, /function snapLayoutAbove|function nudgeToWholePixel/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-card-actions \{[^}]*justify-content:\s*center/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-card-actions \{[^}]*gap:\s*4px/);
		assert.match(css, /line-height:\s*round\(nearest, calc\(20px \* var\(--rv-font-scale, 1\) \* 1\.15\), 1px\)/);
		assert.match(css, /\.rv-dashboard \.callout\[data-callout="rv"\] > \.callout-title \{[^}]*gap:\s*0\.4em/);
		assert.match(css, /font-size:\s*20\.4px;\s*\n\s*line-height:\s*1\.2/);
		assert.match(css, /height:\s*2rem/);
		assert.doesNotMatch(css, /\.rv-dashboard \.callout\[data-callout="rv"\] > \.callout-title \{[^}]*height:\s*28px/);
		assert.doesNotMatch(css, /justify-content:\s*space-evenly/);
		const facts = chrome.slice(chrome.indexOf('function paintFactsTitle'), chrome.indexOf('function paintFactsBody'));
		assert.match(facts, /kind: 'urgency'/);
		assert.match(facts, /icon: 'moon'/);
		assert.match(facts, /armFactsRow\(badges\)/);
		assert.doesNotMatch(facts, /snapLayoutAbove|nudgeToWholePixel|setTimeout|requestAnimationFrame|transform/);
		assert.doesNotMatch(facts, /icon: 'hourglass'|icon: 'ban'/);
		const snap = chrome.slice(chrome.indexOf('function snapFactsRow'), chrome.indexOf('function armFactsRow'));
		assert.match(snap, /getBoundingClientRect\(\)\.top/);
		assert.match(snap, /factsRowMargin\(base, top\)/);
		assert.match(snap, /style\.marginTop/);
		assert.match(chrome, /new ResizeObserver\(\(\) => \{\s*snapFactsRow\(badges\);\s*\}\)/);
		assert.equal(factsRowMargin(0, 338.72), 0.28);
		assert.equal(factsRowMargin(0, 338), 0);
		assert.equal(factsRowMargin(4, 100.2), 4.8);
		const details = chrome.slice(chrome.indexOf('.rv-locator-urgency, .rv-locator-map-pin'), chrome.indexOf('function setPaint'));
		assert.match(details, /pinBadgeStroke\(node\)/);
		assert.doesNotMatch(details, /setPaint|border-color|color'/);
		assert.match(map, /Math\.round\(origin\.left\)/);
		assert.match(map, /Math\.round\(origin\.top\)/);
		assert.match(map, /snapAbsoluteOrigin\(shell\)/);
		assert.match(map, /snapFlowBox\(card, true\)/);
		assert.doesNotMatch(map, /snapBadgeRow/);
		assert.equal(wholeCardHeight(100.39, 2, 92), 100);
		assert.equal(wholeCardHeight(98.39, 2, 92), 98);
		assert.equal((wholeCardHeight(100.39, 2, 92) - 2 - 92) % 2, 0);

		const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
		const { window } = dom;
		const host = globalThis as typeof globalThis & Record<string, unknown>;
		const previous = {
			window: host.window,
			document: host.document,
			HTMLElement: host.HTMLElement,
			SVGElement: host.SVGElement,
			Element: host.Element,
		};
		host.window = window;
		host.document = window.document;
		host.HTMLElement = window.HTMLElement;
		host.SVGElement = window.SVGElement;
		host.Element = window.Element;
		host.__rvSetIcon = (parent: unknown, id: string) => {
			const node = parent as HTMLElement;
			const svg = node.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svg.setAttribute('data-icon', id);
			svg.setAttribute('viewBox', '0 0 24 24');
			node.appendChild(svg);
		};
		const visual = (node: HTMLElement): string => {
			const copy = node.cloneNode(true) as HTMLElement;
			copy.removeAttribute('aria-label');
			return copy.outerHTML;
		};
		const faces: BadgeFace[] = [
			{ kind: 'urgency', glyphs: '○', band: 0, label: 'Urgency' },
			{ kind: 'urgency', glyphs: '!', band: 1, label: 'Urgency' },
			{ kind: 'urgency', glyphs: '!!', band: 2, label: 'Urgency' },
			{ kind: 'urgency', glyphs: '!!!', band: 3, label: 'Urgency' },
			{ kind: 'urgency', glyphs: '—', band: 0, label: 'Urgency' },
			{ kind: 'priority', rank: '5', label: 'Priority 5' },
			{ kind: 'priority', rank: '0', label: 'Priority 0' },
			{ kind: 'icon', icon: 'route', label: 'Directions' },
			{ kind: 'icon', icon: 'moon', band: 1, label: 'Snoozed' },
		];
		try {
			for (const face of faces) {
				const quick = window.document.createElement('div');
				const card = window.document.createElement('div');
				window.document.body.append(quick, card);
				const quickBadge = appendBadge(quick, face);
				const cardBadge = appendBadge(card, { ...face, label: `${face.label} on card` });
				assert.equal(visual(quickBadge), visual(cardBadge), `${face.kind} ${'glyphs' in face ? face.glyphs : ''} ${'icon' in face ? face.icon : ''} ${'rank' in face ? face.rank : ''}`);
				quick.remove();
				card.remove();
			}
			const ringParent = window.document.createElement('div');
			const ring = appendBadge(ringParent, { kind: 'urgency', glyphs: '○', band: 0, label: 'Urgency' });
			const svg = ring.querySelector('svg');
			assert.equal(svg?.getAttribute('viewBox'), '0 0 28 28');
			assert.equal(svg?.getAttribute('class'), 'rv-urgency-glyph');
			assert.equal(ring.querySelector('[data-icon]'), null);
			const route = appendBadge(window.document.createElement('div'), { kind: 'icon', icon: 'route', label: 'Directions' });
			assert.equal(route.style.getPropertyValue('color'), '');
			assert.equal(route.style.getPropertyValue('border-color'), '');
			assert.equal(route.querySelector('svg')?.getAttribute('data-icon'), 'route');
		} finally {
			host.window = previous.window;
			host.document = previous.document;
			host.HTMLElement = previous.HTMLElement;
			host.SVGElement = previous.SVGElement;
			host.Element = previous.Element;
			delete host.__rvSetIcon;
		}
	});

	it('jumps the card return line into the note and keeps the filled modal action on the right', () => {
		const glance = source('src/glancable-view.ts');
		const foot = glance.slice(glance.indexOf('rv-locator-override-label'), glance.indexOf('private paintCampaignMark'));
		assert.match(foot, /openAttemptLog/);
		assert.doesNotMatch(foot, /suggestReturnFor/);
		const css = source('styles.css');
		assert.match(css, /button\.mod-cta \{\s*order:\s*2;/);
		assert.match(css, /\.rv-locator-map-pin \{[\s\S]*cursor:\s*pointer;/);
		assert.match(css, /p\.rv-hub-owned a\.rv-address-link,\s*\.markdown-preview-view p\.rv-hub-owned a\.rv-address-link,\s*\.markdown-rendered p\.rv-hub-owned a\.rv-address-link \{\s*color:\s*var\(--rv-urgency-accent/);
		const chrome = source('src/modal-chrome.ts');
		assert.match(chrome, /daypart\$\/i, 'sun'/);
		assert.match(chrome, /day\$\/i, 'calendar'/);
		const override = source('src/override-modal.ts');
		assert.ok(override.indexOf("setButtonText('Avoid')") < override.indexOf("setButtonText('Try')"));
		const fold = source('src/callout-fold.ts');
		assert.match(fold, /data-callout-fold', '\+'/);
		assert.match(fold, /setIcon\(fold, 'chevron-down'\)/);
		assert.match(fold, /classList\.remove\('is-collapsed'\)/);
		const left = splitTitleSuffix('Hello Tract');
		assert.equal(splitTitleSuffix('Hello Tract'), left);
		const fields = source('src/catalog-fields.ts');
		const share = fields.slice(fields.indexOf('export function mountShareFields'), fields.indexOf('function mountDisclosure'));
		assert.equal(share.match(/publicationAliasIndex\(\)/g)?.length, 1);
		assert.equal(share.match(/mediaAliasIndex\(\)/g)?.length, 1);
	});
});
