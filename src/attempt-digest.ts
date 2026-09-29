/**
 * The daypart table and the suggester quote sit above the Attempt Log
 * callout. The callout itself keeps only the dated bullets. Fold (`+` / `-`)
 * is left as the note already has it.
 */

import { domInstanceOf } from './dom';

export const DIGEST_START = '<!-- rv-locator-digest -->';
export const DIGEST_END = '<!-- /rv-locator-digest -->';

/**
 * Bump when a one-time vault rewrite should run again.
 * 1 moved the dated visit list out of the digest and opened collapsed logs.
 * 2 moves the table and the suggester quote above Attempt Log and leaves
 * the callout fold alone. New logs start collapsed.
 */
export const DIGEST_POLISH_VERSION = 2;

const ATTEMPT_LOG_CALLOUT = /^>\s*\[!note\]\s*([+-])?\s*Attempt Log\s*$/i;

export interface DigestNoteParts {
	table: string;
	sentences: readonly string[];
	text: string;
}

/**
 * Table, then a blockquote of the voice lines. An empty schedule is one
 * quoted line. HTML comment markers are added by {@link upsertAttemptDigest}.
 */
export function formatDigestNote(parts: DigestNoteParts): string {
	const lines = parts.sentences.length > 0
		? parts.sentences
		: (!parts.table && parts.text ? [parts.text] : []);
	const quote = lines.map((line) => `> ${line}`).join('\n');
	return [parts.table, quote].filter((part) => part.length > 0).join('\n\n');
}

/**
 * Insert or replace the digest above Attempt Log.
 * A digest that an older build stored inside the callout is removed.
 * Null when the note has no Attempt Log. The callout header is not rewritten.
 */
export function upsertAttemptDigest(markdown: string, inner: string): string | null {
	const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
	const lines = markdown.split(/\r?\n/);
	if (!lines.some((line) => ATTEMPT_LOG_CALLOUT.test(line))) return null;
	const cleaned = removeDigestRegions(lines);
	const start = cleaned.findIndex((line) => ATTEMPT_LOG_CALLOUT.test(line));
	if (start < 0) return null;
	const end = calloutEnd(cleaned, start);
	const before = cleaned.slice(0, start);
	while (before.length > 0 && (before[before.length - 1] ?? '').trim() === '') before.pop();
	const header = cleaned[start] ?? '';
	const section = cleaned.slice(start + 1, end);
	const rest = cleaned.slice(end);
	const lead = before.length > 0 ? [''] : [];
	const block = digestBlockLines(inner);
	return [...before, ...lead, ...block, '', header, ...section, ...rest].join(newline);
}

/** Index of the digest block that sits on Attempt Log, or the callout itself. */
export function attemptLogAnchor(lines: readonly string[], calloutIndex: number): number {
	let index = calloutIndex;
	while (index > 0 && (lines[index - 1] ?? '') === '') index -= 1;
	const previous = lines[index - 1] ?? '';
	if (index > 0 && previous.includes(DIGEST_END)) {
		let start = index - 1;
		while (start > 0 && !(lines[start] ?? '').includes(DIGEST_START)) start -= 1;
		if ((lines[start] ?? '').includes(DIGEST_START)) return start;
	}
	return calloutIndex;
}

export function attemptLogCallouts(root: HTMLElement): HTMLElement[] {
	const nodes: HTMLElement[] = [];
	const consider = (node: Element): void => {
		if (!domInstanceOf(node, HTMLElement)) return;
		if (node.classList.contains('callout') && isAttemptLogCallout(node)) nodes.push(node);
	};
	consider(root);
	root.querySelectorAll('.callout').forEach(consider);
	return nodes;
}

/**
 * Grey the Attempt Log callout and mark the table and quote that sit above it.
 * Voice lines inside an older in-callout digest are tagged until the rewrite
 * moves them out.
 */
export function decorateAttemptLog(root: HTMLElement): void {
	for (const callout of attemptLogCallouts(root)) {
		callout.classList.add('rv-locator-attempt-log');
		tagInsideLegacy(callout);
		const origin = blockHost(callout);
		const quote = nearestPrevious(origin, 'blockquote');
		if (quote) {
			quote.classList.add('rv-locator-digest-voice');
			tagQuote(quote);
		}
		const table = nearestPrevious(quote ? blockHost(quote) : origin, 'table');
		if (table) table.classList.add('rv-locator-digest-table');
	}
}

/** Class for one suggester line. Untried is checked before Try. */
export function digestVoiceClass(text: string): string | null {
	if (/^Avoid\b/.test(text)) return 'is-avoid';
	if (/^Untried\b/.test(text)) return 'is-untried';
	if (/^Unsure\b/.test(text)) return 'is-unsure';
	if (/^Try\b/.test(text)) return 'is-try';
	if (/— (?:Home|Not home)$/.test(text)) return 'is-history';
	return null;
}

function digestBlockLines(inner: string): string[] {
	const body = inner.replace(/\s+$/g, '');
	const lines = body.length > 0 ? body.split('\n') : [];
	return [DIGEST_START, ...lines, DIGEST_END];
}

function removeDigestRegions(lines: readonly string[]): string[] {
	const next: string[] = [];
	let skipping = false;
	for (const line of lines) {
		if (!skipping && line.includes(DIGEST_START)) {
			skipping = !line.includes(DIGEST_END);
			continue;
		}
		if (skipping) {
			if (line.includes(DIGEST_END)) skipping = false;
			continue;
		}
		next.push(line);
	}
	return next;
}

function calloutEnd(lines: readonly string[], start: number): number {
	let end = start + 1;
	while (end < lines.length && /^>/.test(lines[end] ?? '')) end += 1;
	return end;
}

function isAttemptLogCallout(callout: HTMLElement): boolean {
	const title = directChild(callout, 'callout-title');
	if (!title) return false;
	const inner = title.querySelector('.callout-title-inner');
	const text = (inner?.textContent ?? title.textContent ?? '').replace(/\s+/g, ' ').trim();
	return /^attempt log$/i.test(text);
}

function directChild(parent: HTMLElement, className: string): HTMLElement | null {
	for (const child of Array.from(parent.children)) {
		if (domInstanceOf(child, HTMLElement) && child.classList.contains(className)) return child;
	}
	return null;
}

function tagInsideLegacy(callout: HTMLElement): void {
	const content = directChild(callout, 'callout-content');
	if (!content) return;
	for (const child of Array.from(content.children)) {
		if (!domInstanceOf(child, HTMLElement)) continue;
		if (child.matches('table') || child.querySelector(':scope > table, table')) {
			child.classList.add('rv-locator-digest-block');
		}
		const text = (child.textContent ?? '').replace(/\s+/g, ' ').trim();
		const voice = digestVoiceClass(text);
		if (!voice) continue;
		child.classList.add('rv-locator-digest-block', voice);
	}
}

function tagQuote(quote: HTMLElement): void {
	const paras = Array.from(quote.querySelectorAll('p')).filter((node) => domInstanceOf(node, HTMLElement));
	const targets = paras.length > 0 ? paras : [quote];
	for (const node of targets) {
		const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
		const voice = digestVoiceClass(text);
		if (voice) node.classList.add('rv-locator-digest-line', voice);
	}
}

function blockHost(node: HTMLElement): HTMLElement {
	const parent = node.parentElement;
	if (!parent || parent.childElementCount !== 1) return node;
	if (parent.classList.contains('callout') || parent.classList.contains('callout-content')) return node;
	if (parent.classList.contains('markdown-preview-section') || parent.classList.contains('markdown-rendered')) return node;
	return parent;
}

function nearestPrevious(start: HTMLElement, selector: string): HTMLElement | null {
	let node: Element | null = start.previousElementSibling;
	while (node) {
		if (domInstanceOf(node, HTMLElement)) {
			const found = matchBlock(node, selector);
			if (found) return found;
			const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
			if (text.length > 0) return null;
		}
		node = node.previousElementSibling;
	}
	return null;
}

function matchBlock(node: HTMLElement, selector: string): HTMLElement | null {
	if (node.matches(selector)) return node;
	const found = node.querySelector(selector);
	if (!domInstanceOf(found, HTMLElement)) return null;
	if (node.querySelectorAll(selector).length !== 1) return null;
	return found;
}
