import { idealityScore, likelihoodMultiplier, urgencyScore, URGENCY_RAMP_DAYS } from './scoring';
import type { PriorityBand, PriorityDays, RVLocatorSettings } from './types';

const PRIORITIES: readonly PriorityBand[] = [5, 4, 3, 2, 1];

/** CSS variable suffix. Colors live in styles.css so light and dark themes can differ. */
const PRIORITY_TOKEN: Record<PriorityBand, string> = {
	1: '1',
	2: '2',
	3: '3',
	4: '4',
	5: '5',
};

export interface SettingsGraphs {
	ladder: string;
	ramp: string;
	ideality: string;
	floors: string;
	likelihood: string;
}

export function settingsGraphs(settings: RVLocatorSettings): SettingsGraphs {
	return {
		ladder: urgencyLadderSvg(settings.urgencyThresholdDays),
		ramp: urgencyRampSvg(settings.urgencyThresholdDays),
		ideality: idealityMilesSvg(settings.territorySpanMiles),
		floors: idealityFloorSvg(settings),
		likelihood: settings.homeLikelihoodEnabled ? likelihoodSvg() : '',
	};
}

export function urgencyLadderSvg(thresholds: PriorityDays): string {
	const domain = Math.max(24, ...PRIORITIES.map((band) => thresholds[band])) * 1.35;
	const samples = PRIORITIES.map((band) => ({
		band,
		points: sampleDays(domain, 48, (day) => urgencyScore(day, band, thresholds) ?? 0),
	}));
	const yMax = Math.max(2, ...samples.flatMap((series) => series.points.map((point) => point[1])));
	return lineChart({
		title: 'Urgency by days since Last Spoke',
		xLabel: 'days',
		yLabel: 'urgency',
		xMax: domain,
		yMax,
		series: samples.map((series) => ({
			label: `P${series.band}`,
			token: PRIORITY_TOKEN[series.band],
			points: series.points,
		})),
		guides: [{ x: null, y: 1, label: '1' }],
	});
}

export function urgencyRampSvg(thresholds: PriorityDays): string {
	const domain = 6;
	const series = PRIORITIES.map((band) => ({
		label: `P${band}`,
		token: PRIORITY_TOKEN[band],
		points: sampleDays(domain, 36, (day) => urgencyScore(day, band, thresholds) ?? 0),
	}));
	const yMax = Math.max(0.5, ...series.flatMap((item) => item.points.map((point) => point[1]))) * 1.15;
	return lineChart({
		title: 'Urgency ramp under 3 days',
		xLabel: 'days',
		yLabel: 'urgency',
		xMax: domain,
		yMax,
		series,
		guides: [{ x: URGENCY_RAMP_DAYS, y: null, label: '3d' }],
	});
}

export function idealityMilesSvg(territorySpan: number): string {
	const xMax = Math.max(territorySpan * 4, 4);
	const points = sampleRange(0.5, xMax, 48, (miles) => {
		const score = idealityScore({
			days: 4,
			priority: 5,
			miles,
			thresholds: { 1: 189, 2: 63, 3: 21, 4: 7, 5: 4 },
			floors: { 1: 42, 2: 14, 3: 7, 4: 4, 5: 3 },
			territorySpan,
		});
		return score ?? 0;
	});
	const yMax = Math.max(2, ...points.map((point) => point[1]));
	return lineChart({
		title: 'Ideality vs miles at urgency 1',
		xLabel: 'miles',
		yLabel: 'ideality',
		xMax,
		yMax,
		series: [{ label: 'urgency 1', token: 'urgency', points }],
		guides: [
			{ x: territorySpan, y: null, label: 'span' },
			{ x: null, y: 1, label: '1' },
		],
	});
}

export function idealityFloorSvg(settings: RVLocatorSettings): string {
	const domain = Math.max(21, ...PRIORITIES.map((band) => settings.idealityFloorDays[band])) * 1.15;
	const series = PRIORITIES.map((band) => ({
		label: `P${band}`,
		token: PRIORITY_TOKEN[band],
		points: sampleDays(domain, 48, (day) => idealityScore({
			days: day,
			priority: band,
			miles: settings.territorySpanMiles,
			thresholds: settings.urgencyThresholdDays,
			floors: settings.idealityFloorDays,
			territorySpan: settings.territorySpanMiles,
			holdDistance: true,
		}) ?? 0),
	}));
	const yMax = Math.max(1, ...series.flatMap((item) => item.points.map((point) => point[1]))) * 1.1;
	return lineChart({
		title: 'Ideality floors at territory span',
		xLabel: 'days',
		yLabel: 'ideality',
		xMax: domain,
		yMax,
		series,
		guides: [],
	});
}

export function likelihoodSvg(): string {
	const domain = 30;
	const curves: Array<{ label: string; token: string; homes: (n: number) => number }> = [
		{ label: 'all home', token: 'home', homes: (n) => n },
		{ label: 'half home', token: 'half', homes: (n) => n / 2 },
		{ label: 'none home', token: 'none', homes: () => 0 },
	];
	const series = curves.map((curve) => ({
		label: curve.label,
		token: curve.token,
		points: sampleDays(domain, 31, (n) => likelihoodMultiplier(curve.homes(n), n)),
	}));
	return lineChart({
		title: 'Home-likelihood multiplier',
		xLabel: 'visits',
		yLabel: 'multiplier',
		xMax: domain,
		yMax: 1.45,
		yMin: 0.3,
		series,
		guides: [{ x: null, y: 1, label: '1' }],
	});
}

interface Guide {
	x: number | null;
	y: number | null;
	label: string;
}

interface Series {
	label: string;
	token: string;
	points: Array<[number, number]>;
}

function sampleDays(domain: number, steps: number, valueAt: (x: number) => number): Array<[number, number]> {
	return sampleRange(0, domain, steps, valueAt);
}

function sampleRange(min: number, max: number, steps: number, valueAt: (x: number) => number): Array<[number, number]> {
	const points: Array<[number, number]> = [];
	for (let index = 0; index <= steps; index += 1) {
		const x = min + ((max - min) * index) / steps;
		points.push([x, valueAt(x)]);
	}
	return points;
}

function lineChart(args: {
	title: string;
	xLabel: string;
	yLabel: string;
	xMax: number;
	yMax: number;
	yMin?: number;
	series: Series[];
	guides: Guide[];
}): string {
	const width = 360;
	const height = 168;
	const left = 36;
	const right = 8;
	const top = 22;
	const bottom = 28;
	const yMin = args.yMin ?? 0;
	const xScale = (x: number) => left + ((x / args.xMax) * (width - left - right));
	const yScale = (y: number) => {
		const span = args.yMax - yMin;
		const t = span <= 0 ? 0 : (y - yMin) / span;
		return top + (1 - t) * (height - top - bottom);
	};
	const parts: string[] = [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" class="rv-locator-chart" role="img">`,
		`<title>${escapeXml(args.title)}</title>`,
		`<text class="rv-graph-title" x="${left}" y="15" fill="var(--text-normal)" font-size="12" font-weight="600" font-family="var(--font-interface), sans-serif">${escapeXml(args.title)}</text>`,
		`<line class="rv-graph-axis" x1="${left}" y1="${yScale(yMin)}" x2="${width - right}" y2="${yScale(yMin)}" stroke="var(--rv-graph-axis)" stroke-width="1.25"/>`,
		`<line class="rv-graph-axis" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}" stroke="var(--rv-graph-axis)" stroke-width="1.25"/>`,
		`<text class="rv-graph-label" x="${width / 2}" y="${height - 4}" text-anchor="middle" fill="var(--text-muted)" font-size="11" font-family="var(--font-interface), sans-serif">${escapeXml(args.xLabel)}</text>`,
		`<text class="rv-graph-label" x="13" y="${(top + height - bottom) / 2}" text-anchor="middle" fill="var(--text-muted)" font-size="11" font-family="var(--font-interface), sans-serif" transform="rotate(-90 13 ${(top + height - bottom) / 2})">${escapeXml(args.yLabel)}</text>`,
	];
	for (const guide of args.guides) {
		if (guide.y != null) {
			const y = yScale(guide.y);
			const yText = y.toFixed(1);
			const labelY = (y < top + 16 ? y + 12 : y - 4).toFixed(1);
			parts.push(`<line class="rv-graph-guide" x1="${left}" y1="${yText}" x2="${width - right}" y2="${yText}" stroke="var(--rv-graph-guide)" stroke-width="1.35" stroke-dasharray="4 3"/>`);
			parts.push(`<text class="rv-graph-guide-label" x="${width - right}" y="${labelY}" text-anchor="end" fill="var(--text-accent)" font-size="11" font-weight="600" font-family="var(--font-interface), sans-serif">${escapeXml(guide.label)}</text>`);
		}
		if (guide.x != null) {
			const x = xScale(guide.x).toFixed(1);
			parts.push(`<line class="rv-graph-guide" x1="${x}" y1="${top}" x2="${x}" y2="${height - bottom}" stroke="var(--rv-graph-guide)" stroke-width="1.35" stroke-dasharray="4 3"/>`);
			parts.push(`<text class="rv-graph-guide-label" x="${x}" y="${top + 12}" text-anchor="middle" fill="var(--text-accent)" font-size="11" font-weight="600" font-family="var(--font-interface), sans-serif">${escapeXml(guide.label)}</text>`);
		}
	}
	args.series.forEach((series, index) => {
		const color = `var(--rv-series-${series.token})`;
		const points = series.points
			.map(([x, y]) => `${xScale(x).toFixed(1)},${yScale(y).toFixed(1)}`)
			.join(' ');
		parts.push(`<polyline class="rv-graph-series rv-series-${series.token}" fill="none" stroke="${color}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" points="${points}"/>`);
		const legendX = left + index * 64;
		parts.push(`<text class="rv-graph-legend rv-series-${series.token}" x="${legendX}" y="${height - 16}" fill="${color}" font-size="11" font-weight="600" font-family="var(--font-interface), sans-serif">${escapeXml(series.label)}</text>`);
	});
	parts.push('</svg>');
	return parts.join('');
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}
