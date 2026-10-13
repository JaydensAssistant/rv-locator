/**
 * Review strip for badge optical sizes. Run via scripts/badge-optical-strip.mjs.
 * Draws the same ink math, stroke, and colors the badges use.
 */
import { writeFileSync } from 'node:fs';
import { BADGE_INK, BADGE_OPTICAL, DIGIT_CAP_INK, LINE_ICON_INK, urgencyOpticalKey } from '../src/badge-glyph';
import { urgencyGlyphMarkup } from '../src/scoring';
import { SNOOZE_SLATE } from '../src/snooze';
import { defaultUrgencyColors, urgencyInk } from '../src/urgency-palette';

const LINE_ICONS: Record<'route' | 'moon' | 'hourglass' | 'ban', string> = {
	moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
	hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
	route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
	ban: '<circle cx="12" cy="12" r="10"/><path d="M4.929 4.929 19.07 19.071"/>',
};

interface Badge {
	label: string;
	accent: string;
	ink: string;
	dashed?: boolean;
	body: string;
}

function mark(glyphs: string, accent: string, label: string, dashed = false): Badge {
	const key = urgencyOpticalKey(glyphs);
	const ink = accent === 'var(--faint)' ? 'var(--faint)' : urgencyInk(accent);
	const svg = urgencyGlyphMarkup(glyphs).replace(
		'<svg ',
		`<svg class="rv-urgency-glyph" data-rv-glyph="${key}" style="--rv-opt-icon:var(--rv-opt-${key})" `,
	);
	return { label, accent, ink, dashed, body: svg };
}

function icon(name: keyof typeof LINE_ICONS, accent: string, label: string, inkColor: string, dashed = false): Badge {
	const svg = `<svg class="line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="--rv-opt-icon:var(--rv-opt-${name})">${LINE_ICONS[name]}</svg>`;
	return { label, accent, ink: inkColor, dashed, body: svg };
}

function digit(text: string, accent: string): Badge {
	return {
		label: text,
		accent,
		ink: urgencyInk(accent),
		body: text,
	};
}

function badgeHtml(badge: Badge): string {
	const accent = badge.accent;
	const ghost = badge.dashed ? ' is-ghost' : '';
	return `<figure class="cell"><span class="badge${ghost}" style="--rv-urgency-accent:${accent};color:${badge.ink}">${badge.body}</span><figcaption>${badge.label}</figcaption></figure>`;
}

function group(title: string, badges: readonly Badge[]): string {
	return `<section class="group"><h2>${title}</h2><div class="badges">${badges.map(badgeHtml).join('')}</div></section>`;
}

export function badgeStripHtml(): string {
	const [green, yellow, orange, red] = defaultUrgencyColors();
	const facts = [
		mark('!', yellow, '!'),
		digit('3', yellow),
		icon('route', yellow, 'route', urgencyInk(yellow)),
	];
	const card = [
		mark('!!', orange, '!!'),
		digit('2', orange),
		icon('route', orange, 'route', urgencyInk(orange)),
	];
	const snoozed = [icon('moon', SNOOZE_SLATE, 'moon', SNOOZE_SLATE)];
	const priorities = ['1', '2', '3', '4', '5'].map((text) => digit(text, green));
	const urgency = [
		mark('○', green, 'ring'),
		mark('!', yellow, '!'),
		mark('!!', orange, '!!'),
		mark('!!!', red, '!!!'),
		mark('—', 'var(--faint)', 'dash'),
		icon('hourglass', green, 'hourglass', urgencyInk(green), true),
		icon('ban', red, 'ban', urgencyInk(red), true),
	];
	const route = [icon('route', green, 'route', urgencyInk(green))];
	const row = [
		group('Quick Facts', facts),
		group('Card column', card),
		group('Snoozed', snoozed),
		group('Priority 1–5', priorities),
		group('Urgency states', urgency),
		group('Route', route),
	].join('');
	const factors = Object.entries(BADGE_OPTICAL).map(([key, value]) => `${key} ${value}`).join(' · ');
	const band = (scale: string, px: number) => `<div class="band" style="--rv-control-size:${px}px"><h3>${scale}</h3><div class="row">${row}</div></div>`;
	const root = [
		`--rv-badge-ink:${BADGE_INK}`,
		`--rv-line-ink:${LINE_ICON_INK}`,
		`--rv-digit-ink:${DIGIT_CAP_INK}`,
		'--rv-badge-stroke:2px',
		...Object.entries(BADGE_OPTICAL).map(([key, value]) => `--rv-opt-${key}:${value}`),
	].join(';');
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  :root { ${root} }
  html, body { margin: 0; }
  body { font-family: Inter, sans-serif; }
  .sheet { padding: 22px 28px 26px; }
  .sheet.dark { background: #1e1e1e; color: #e4e4e4; --faint: #8b8b8b; }
  .sheet.light { background: #ffffff; color: #1c1c1c; --faint: #8a8a8a; }
  h1 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
  .legend { margin: 0 0 14px; font-size: 12px; line-height: 1.4; opacity: 0.78; }
  h3 { margin: 0 0 8px; font-size: 12px; font-weight: 600; }
  .band + .band { margin-top: 16px; }
  .row { display: flex; gap: 22px; align-items: flex-start; }
  .group h2 { margin: 0 0 6px; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.62; }
  .badges { display: flex; gap: 8px; align-items: flex-start; }
  .cell { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; }
  figcaption { font-size: 10px; line-height: 1; opacity: 0.62; }
  .badge {
    display: inline-flex;
    box-sizing: border-box;
    align-items: center;
    justify-content: center;
    width: var(--rv-control-size);
    height: var(--rv-control-size);
    margin: 0;
    padding: 0;
    border: var(--rv-badge-stroke) solid var(--rv-urgency-accent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--rv-urgency-accent) 22%, transparent);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    overflow: visible;
  }
  .badge.is-ghost { border-style: dashed; }
  .badge:not(:has(svg)) {
    font-size: calc(var(--rv-control-size) * var(--rv-badge-ink) / var(--rv-digit-ink) * var(--rv-opt-digit));
  }
  .badge .rv-urgency-glyph {
    display: block;
    width: calc(var(--rv-control-size) * var(--rv-badge-ink) * var(--rv-opt-icon, 1));
    height: calc(var(--rv-control-size) * var(--rv-badge-ink) * var(--rv-opt-icon, 1));
    overflow: visible;
  }
  .badge .rv-urgency-glyph :is(line, circle) {
    fill: none;
    stroke: currentColor;
    stroke-width: var(--rv-badge-stroke);
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .badge .line-icon {
    display: block;
    width: calc(var(--rv-control-size) * var(--rv-badge-ink) / var(--rv-line-ink) * var(--rv-opt-icon, 1));
    height: calc(var(--rv-control-size) * var(--rv-badge-ink) / var(--rv-line-ink) * var(--rv-opt-icon, 1));
    overflow: visible;
  }
</style>
</head>
<body>
<section class="sheet dark">
  <h1>Badge optical scale</h1>
  <p class="legend">Equal ink ${BADGE_INK}, then one factor per glyph. ${factors}. Strokes stay 2px. 1× is 28px, 2× is 56px.</p>
  ${band('Dark 1×', 28)}
  ${band('Dark 2×', 56)}
</section>
<section class="sheet light">
  <h1>Badge optical scale</h1>
  <p class="legend">Equal ink ${BADGE_INK}, then one factor per glyph. ${factors}. Strokes stay 2px. 1× is 28px, 2× is 56px.</p>
  ${band('Light 1×', 28)}
  ${band('Light 2×', 56)}
</section>
</body>
</html>`;
}

const out = process.argv[2] || '/tmp/badge-optical-strip.html';
writeFileSync(out, badgeStripHtml());
