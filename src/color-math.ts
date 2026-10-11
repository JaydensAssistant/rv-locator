/**
 * Contrast-adjusted urgency ink.
 * Same hue as the band, lighter on a dark theme and deeper on a light theme,
 * at least 4.5:1 against the 14% tint over the theme background.
 */

export interface RGB {
	r: number;
	g: number;
	b: number;
}

export interface Ink {
	ink: string;
	ratio: number;
	ok: boolean;
	fill: string;
	adjusted: boolean;
}

export const INK_TARGET = 4.5;
export const TINT = 0.14;
const STEP = 0.005;

export function parseHex(color: string): RGB | null {
	const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
	if (!match) return null;
	const value = Number.parseInt(match[1] ?? '', 16);
	return { r: ((value >> 16) & 255) / 255, g: ((value >> 8) & 255) / 255, b: (value & 255) / 255 };
}

/** `#rgb`, `#rrggbb`, or `rgb()` / `rgba()` from getComputedStyle. */
export function parseCssColor(color: string): RGB | null {
	const text = color.trim();
	const hex = parseHex(text);
	if (hex) return hex;
	const short = /^#([0-9a-f]{3})$/i.exec(text);
	if (short?.[1]) {
		const [r, g, b] = short[1].split('');
		return parseHex(`#${r}${r}${g}${g}${b}${b}`);
	}
	const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(text);
	if (!rgb) return null;
	return {
		r: Number(rgb[1]) / 255,
		g: Number(rgb[2]) / 255,
		b: Number(rgb[3]) / 255,
	};
}

export function toHex(color: RGB): string {
	const byte = (channel: number): string => {
		const clamped = Math.max(0, Math.min(1, channel));
		return Math.round(clamped * 255).toString(16).padStart(2, '0');
	};
	return `#${byte(color.r)}${byte(color.g)}${byte(color.b)}`;
}

export function mixSrgb(a: RGB, b: RGB, amount: number): RGB {
	const p = amount;
	return {
		r: a.r * p + b.r * (1 - p),
		g: a.g * p + b.g * (1 - p),
		b: a.b * p + b.b * (1 - p),
	};
}

function linearize(channel: number): number {
	return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function delinearize(channel: number): number {
	return channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
}

export function relLum(color: RGB): number {
	const r = linearize(color.r);
	const g = linearize(color.g);
	const b = linearize(color.b);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: RGB, b: RGB): number {
	const lums = [relLum(a), relLum(b)].sort((x, y) => y - x);
	const hi = lums[0] ?? 0;
	const lo = lums[1] ?? 0;
	return (hi + 0.05) / (lo + 0.05);
}

interface Lab {
	L: number;
	a: number;
	b: number;
}

function rgbToOklab(color: RGB): Lab {
	const r = linearize(color.r);
	const g = linearize(color.g);
	const b = linearize(color.b);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return {
		L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
		a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
		b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
	};
}

function oklabToRgb(lab: Lab): RGB {
	const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
	const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
	const s_ = lab.L - 0.0894841775 * lab.a - 1.2914855480 * lab.b;
	const l = l_ * l_ * l_;
	const m = m_ * m_ * m_;
	const s = s_ * s_ * s_;
	return {
		r: delinearize(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
		g: delinearize(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
		b: delinearize(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
	};
}

export function toOklch(color: RGB): { L: number; C: number; h: number } {
	const lab = rgbToOklab(color);
	const C = Math.hypot(lab.a, lab.b);
	let h = Math.atan2(lab.b, lab.a) * (180 / Math.PI);
	if (h < 0) h += 360;
	return { L: lab.L, C, h };
}

function fromOklch(L: number, C: number, h: number): RGB {
	const rad = (h * Math.PI) / 180;
	return oklabToRgb({ L, a: C * Math.cos(rad), b: C * Math.sin(rad) });
}

function inGamut(color: RGB): boolean {
	return [color.r, color.g, color.b].every((channel) => channel >= -0.0001 && channel <= 1.0001);
}

/** Largest chroma at most `cMax` that stays inside sRGB at this lightness and hue. */
export function clampChroma(L: number, cMax: number, h: number): { c: number; rgb: RGB } {
	let lo = 0;
	let hi = Math.max(0, cMax);
	let best = { c: 0, rgb: fromOklch(L, 0, h) };
	for (let step = 0; step < 24; step += 1) {
		const mid = (lo + hi) / 2;
		const rgb = fromOklch(L, mid, h);
		if (inGamut(rgb)) {
			best = { c: mid, rgb };
			lo = mid;
		} else {
			hi = mid;
		}
	}
	return best;
}

/**
 * Ink for one resolved band against one resolved background.
 * A colour that already clears 4.5:1 on the 14% fill is kept.
 */
/** Contrast of the hex ink on the hex fill, which is what gets painted. */
function paintedContrast(rgb: RGB, fill: RGB): number {
	const ink = parseHex(toHex(rgb));
	const ground = parseHex(toHex(fill));
	return ink && ground ? contrast(ink, ground) : 0;
}

export function urgencyInkFor(color: RGB, background: RGB): Ink {
	const fill = mixSrgb(color, background, TINT);
	const start = paintedContrast(color, fill);
	if (start >= INK_TARGET) {
		return { ink: toHex(color), ratio: start, ok: true, fill: toHex(fill), adjusted: false };
	}
	const { L: L0, C: C0, h } = toOklch(color);
	const lighten = relLum(background) < 0.18;
	let best = { rgb: color, ratio: start };
	const limit = lighten ? 1 : 0;
	for (let L = L0; lighten ? L <= limit : L >= limit; L += lighten ? STEP : -STEP) {
		const { rgb } = clampChroma(L, C0, h);
		const ratio = paintedContrast(rgb, fill);
		if (ratio > best.ratio) best = { rgb, ratio };
		if (ratio >= INK_TARGET) {
			return { ink: toHex(rgb), ratio, ok: true, fill: toHex(fill), adjusted: true };
		}
	}
	return { ink: toHex(best.rgb), ratio: best.ratio, ok: best.ratio >= INK_TARGET, fill: toHex(fill), adjusted: true };
}

/** Black or white, whichever contrasts more against a solid band. */
export function autoInk(color: RGB): '#111111' | '#ffffff' {
	const black = contrast(color, { r: 0, g: 0, b: 0 });
	const white = contrast(color, { r: 1, g: 1, b: 1 });
	return black >= white ? '#111111' : '#ffffff';
}

const DARK_MAP: RGB = { r: 30 / 255, g: 30 / 255, b: 30 / 255 };
const LIGHT_MAP: RGB = { r: 0xde / 255, g: 0xdc / 255, b: 0xdb / 255 };

export function ringContrast(color: RGB): { dark: number; light: number } {
	return { dark: contrast(color, DARK_MAP), light: contrast(color, LIGHT_MAP) };
}

/**
 * CIEDE2000. Compact form of Sharma / Wu / Dalal.
 * Used to keep adjacent palette bands at least 10 apart.
 */
export function deltaE00(a: RGB, b: RGB): number {
	const labA = rgbToLab(a);
	const labB = rgbToLab(b);
	const kL = 1;
	const kC = 1;
	const kH = 1;
	const deg = (rad: number): number => (rad * 180) / Math.PI;
	const rad = (value: number): number => (value * Math.PI) / 180;
	const L1 = labA.L;
	const a1 = labA.a;
	const b1 = labA.b;
	const L2 = labB.L;
	const a2 = labB.a;
	const b2 = labB.b;
	const C1 = Math.hypot(a1, b1);
	const C2 = Math.hypot(a2, b2);
	const Cbar = (C1 + C2) / 2;
	const C7 = Cbar ** 7;
	const G = 0.5 * (1 - Math.sqrt(C7 / (C7 + 25 ** 7)));
	const a1p = (1 + G) * a1;
	const a2p = (1 + G) * a2;
	const C1p = Math.hypot(a1p, b1);
	const C2p = Math.hypot(a2p, b2);
	const h1p = Math.atan2(b1, a1p);
	const h2p = Math.atan2(b2, a2p);
	const dLp = L2 - L1;
	const dCp = C2p - C1p;
	let dhp = h2p - h1p;
	if (C1p * C2p === 0) dhp = 0;
	else if (dhp > Math.PI) dhp -= 2 * Math.PI;
	else if (dhp < -Math.PI) dhp += 2 * Math.PI;
	const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2);
	const Lbarp = (L1 + L2) / 2;
	const Cbarp = (C1p + C2p) / 2;
	let hbarp = (h1p + h2p) / 2;
	if (C1p * C2p !== 0) {
		if (Math.abs(h1p - h2p) > Math.PI) hbarp += h1p + h2p < 2 * Math.PI ? Math.PI : -Math.PI;
	}
	const T = 1
		- 0.17 * Math.cos(hbarp - rad(30))
		+ 0.24 * Math.cos(2 * hbarp)
		+ 0.32 * Math.cos(3 * hbarp + rad(6))
		- 0.20 * Math.cos(4 * hbarp - rad(63));
	const dTheta = rad(30) * Math.exp(-(((deg(hbarp) - 275) / 25) ** 2));
	const Rc = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
	const Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
	const Sc = 1 + 0.045 * Cbarp;
	const Sh = 1 + 0.015 * Cbarp * T;
	const Rt = -Math.sin(2 * dTheta) * Rc;
	return Math.sqrt((dLp / (kL * Sl)) ** 2 + (dCp / (kC * Sc)) ** 2 + (dHp / (kH * Sh)) ** 2 + Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh)));
}

function rgbToLab(color: RGB): { L: number; a: number; b: number } {
	let r = linearize(color.r);
	let g = linearize(color.g);
	let b = linearize(color.b);
	let x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
	let y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
	let z = r * 0.0193339 + g * 0.119192 + b * 0.9503041;
	x /= 0.95047;
	z /= 1.08883;
	const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
	const fx = f(x);
	const fy = f(y);
	const fz = f(z);
	return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function passesRings(color: RGB): boolean {
	const rings = ringContrast(color);
	return rings.dark >= 3 && rings.light >= 2;
}

/** Closest in-gamut shade of this hue that clears both map rings. */
function shadeAt(L: number, C: number, h: number): RGB | null {
	const { rgb } = clampChroma(L, C, h);
	return passesRings(rgb) ? rgb : null;
}

/**
 * Pull a pale band until its ring is at least 3:1 on the dark map and 2:1
 * on the light map. Hue stays. Lightness moves only as far as the rings need.
 */
export function deepenBand(hex: string): string {
	const color = parseHex(hex);
	if (!color) return hex;
	if (passesRings(color)) return toHex(color);
	const { L, C, h } = toOklch(color);
	let best: RGB | null = null;
	let bestDistance = Infinity;
	for (let light = 0.22; light <= 0.78; light += 0.004) {
		const rgb = shadeAt(light, Math.max(C, 0.08), h);
		if (!rgb) continue;
		const distance = Math.abs(light - L);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = rgb;
		}
	}
	return toHex(best ?? color);
}

/**
 * After each band is deep enough, nudge neighbours that sit under ΔE00 10.
 * Lightness moves first, inside the ring window. Hue moves only if that fails.
 */
export function separatePalette(hexes: readonly string[]): string[] {
	const next = hexes.map(deepenBand);
	for (let index = 1; index < next.length; index += 1) {
		const left = parseHex(next[index - 1] ?? '');
		const right = parseHex(next[index] ?? '');
		if (!left || !right || deltaE00(left, right) >= 10) continue;
		const { L, C, h } = toOklch(right);
		let placed = false;
		for (let delta = 0.02; delta <= 0.28 && !placed; delta += 0.01) {
			for (const light of [L + delta, L - delta]) {
				const rgb = shadeAt(light, Math.max(C, 0.08), h);
				if (!rgb || deltaE00(left, rgb) < 10) continue;
				next[index] = toHex(rgb);
				placed = true;
				break;
			}
		}
		if (placed) continue;
		for (let turn = 6; turn <= 48 && !placed; turn += 3) {
			for (const hue of [h + turn, h - turn]) {
				const rgb = shadeAt(L, Math.max(C, 0.1), hue);
				if (!rgb || deltaE00(left, rgb) < 10) continue;
				next[index] = toHex(rgb);
				placed = true;
				break;
			}
		}
	}
	return next;
}

const inkCache = new Map<string, string>();

/** Drop cached ink after a theme or palette change. */
export function clearInkCache(): void {
	inkCache.clear();
}

/**
 * One ink per band colour and theme background. The background is the
 * computed colour of the leaf, so custom hexes and the accent palette follow.
 */
export function cachedUrgencyInk(color: string, background: string): string {
	const key = `${color}|${background}`;
	const hit = inkCache.get(key);
	if (hit) return hit;
	const band = parseCssColor(color);
	const bg = parseCssColor(background);
	const ink = band && bg ? urgencyInkFor(band, bg).ink : color;
	inkCache.set(key, ink);
	return ink;
}

/** Theme page color. A missing variable follows the theme class, not a dark fallback. */
export function themePageBackground(el: HTMLElement): string {
	const doc = el.ownerDocument;
	const body = doc?.body ?? el;
	const view = doc?.defaultView;
	const probe = view?.getComputedStyle(body);
	const variable = probe?.getPropertyValue('--background-primary').trim() ?? '';
	if (variable && parseCssColor(variable)) return variable;
	const painted = probe?.backgroundColor ?? '';
	if (painted && painted !== 'rgba(0, 0, 0, 0)' && painted !== 'transparent' && parseCssColor(painted)) return painted;
	const dark = body.classList.contains('theme-dark') || el.closest('.theme-dark') != null;
	return dark ? '#1e1e1e' : '#ffffff';
}

/** Read the theme background and set `--rv-urgency-ink` on `el` for this band color. */
export function paintUrgencyInk(el: HTMLElement, color: string): void {
	el.style.setProperty('--rv-urgency-ink', cachedUrgencyInk(color, themePageBackground(el)));
}
