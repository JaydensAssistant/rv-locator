/**
 * The suggester quote sits above the Attempt Log callout. The daypart table
 * is the first block inside that callout, then the dated bullets. The callout
 * is the rewrite boundary, so the note has no visible digest markers.
 * An ordinary rewrite leaves the fold (`+` / `-`) as the note already has it.
 * The one-time polish can collapse an opened log.
 */

import { domInstanceOf } from './dom';

/**
 * Older builds wrapped the digest in markers. Both forms are stripped on
 * rewrite and are never written again.
 * HTML comments are one HTML block: Obsidian keeps reading until a later
 * `-->`, so the table rendered as raw source. Same-line `%%` comments
 * rendered the table, and Live Preview still showed the marker text.
 */
const DIGEST_START = '%% rv-locator-digest %%';
const DIGEST_END = '%% /rv-locator-digest %%';
const LEGACY_DIGEST_START = '<!-- rv-locator-digest -->';
const LEGACY_DIGEST_END = '<!-- /rv-locator-digest -->';

/**
 * Bump when a one-time vault rewrite should run again.
 * 1 moved the dated visit list out of the digest and opened collapsed logs.
 * 2 moves the table and the suggester quote above Attempt Log and leaves
 * the callout fold alone. New logs start collapsed.
 * 3 rewrites the digest with `%%` markers and a blank line before the table,
 * and collapses an opened Attempt Log once.
 * 4 moves the table inside Attempt Log, leaves only the suggester quote
 * above the callout, strips `%%` and HTML markers, and collapses an opened
 * log once.
 */
export const DIGEST_POLISH_VERSION = 4;

export function isDigestStartLine(line: string): boolean {
	return line.includes(DIGEST_START) || line.includes(LEGACY_DIGEST_START);
}

export function isDigestEndLine(line: string): boolean {
	return line.includes(DIGEST_END) || line.includes(LEGACY_DIGEST_END);
}

const ATTEMPT_LOG_CALLOUT = /^>\s*\[!note\]\s*([+-])?\s*Attempt Log\s*$/i;

export interface DigestNoteParts {
	table: string;
	sentences: readonly string[];
	text: string;
}

/**
 * The suggester as a blockquote. The table is not included. An empty
 * schedule is one quoted line. {@link upsertAttemptDigest} places this
 * above Attempt Log and the table inside the callout.
 */
export function formatDigestNote(parts: DigestNoteParts): string {
	return quoteLines(parts).join('\n');
}

export interface DigestWriteOptions {
	/** One-time polish. Ordinary rewrites leave an existing `+` or `-` alone. */
	collapse?: boolean;
}

/**
 * Put the suggester quote above Attempt Log and the daypart table inside it,
 * above the bullets. Marker regions, a voice quote already on the callout,
 * and a markdown table already on the callout are replaced. A table or voice
 * block already inside the callout is replaced. Null when the note has no
 * Attempt Log. The callout header is not rewritten unless `collapse` is set.
 */
export function upsertAttemptDigest(markdown: string, parts: DigestNoteParts, options?: DigestWriteOptions): string | null {
	const source = options?.collapse ? collapseAttemptLog(markdown) : markdown;
	const newline = source.includes('\r\n') ? '\r\n' : '\n';
	let lines = removeDigestRegions(source.split(/\r?\n/));
	if (!lines.some((line) => ATTEMPT_LOG_CALLOUT.test(line))) return null;
	let start = lines.findIndex((line) => ATTEMPT_LOG_CALLOUT.test(line));
	if (start < 0) return null;
	({ lines, calloutIndex: start } = stripAdjacentVoice(lines, start));
	({ lines, calloutIndex: start } = stripAdjacentTable(lines, start));
	const end = calloutEnd(lines, start);
	const before = lines.slice(0, start);
	while (before.length > 0 && (before[before.length - 1] ?? '').trim() === '') before.pop();
	const header = lines[start] ?? '';
	const kept = logLinesAfterDigest(lines.slice(start + 1, end));
	const rest = lines.slice(end);
	const quote = quoteLines(parts);
	const table = calloutTableLines(parts.table);
	const lead = before.length > 0 ? [''] : [];
	const gap = quote.length > 0 ? [''] : [];
	const body = table.length === 0
		? kept
		: ['>', ...table, ...(kept.length > 0 ? ['>', ...kept] : [])];
	return [...before, ...lead, ...quote, ...gap, header, ...body, ...rest].join(newline);
}

/**
 * Where a new `###` stamp is inserted: above the suggester quote when one
 * sits on Attempt Log, above a legacy marker block, or at the callout.
 */
export function attemptLogAnchor(lines: readonly string[], calloutIndex: number): number {
	let index = calloutIndex;
	while (index > 0 && (lines[index - 1] ?? '') === '') index -= 1;
	const previous = lines[index - 1] ?? '';
	if (index > 0 && isDigestEndLine(previous)) {
		let start = index - 1;
		while (start > 0 && !isDigestStartLine(lines[start] ?? '')) start -= 1;
		if (isDigestStartLine(lines[start] ?? '')) return start;
	}
	if (index > 0 && isVoiceQuoteLine(previous)) {
		let start = index;
		while (start > 0 && isVoiceQuoteLine(lines[start - 1] ?? '')) start -= 1;
		return start;
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
 * Grey the Attempt Log callout, mark the suggester quote above it, and mark
 * the daypart table inside it. A table still sitting above the callout, from
 * a note not yet rewritten, is marked too.
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

/**
 * Collapse `> [!note]+` and an unmarked `> [!note]` Attempt Log to `-`.
 * A header that is already collapsed stays as written.
 */
export function collapseAttemptLog(markdown: string): string {
	const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
	const lines = markdown.split(/\r?\n/);
	let changed = false;
	const next = lines.map((line) => {
		if (!ATTEMPT_LOG_CALLOUT.test(line)) return line;
		if (/^>\s*\[!note\]-\s*Attempt Log\s*$/i.test(line)) return line;
		changed = true;
		return '> [!note]- Attempt Log';
	});
	return changed ? next.join(newline) : markdown;
}

function quoteLines(parts: DigestNoteParts): string[] {
	const lines = parts.sentences.length > 0
		? parts.sentences
		: (!parts.table && parts.text ? [parts.text] : []);
	return lines.filter((line) => line.trim().length > 0).map((line) => `> ${line}`);
}

function calloutTableLines(table: string): string[] {
	return table.split('\n').map((row) => row.trim()).filter((row) => row.length > 0).map((row) => `> ${row}`);
}

function isSuggesterText(text: string): boolean {
	return /^(?:Avoid|Try|Unsure|Untried)\b/.test(text) || text === 'No May-go-out days';
}

function isVoiceQuoteLine(line: string): boolean {
	if (!/^>/.test(line) || /^>\s*\[!/.test(line)) return false;
	return isSuggesterText(line.replace(/^>\s?/, '').trim());
}

function isMarkdownTableLine(line: string): boolean {
	const text = line.trim();
	return text.startsWith('|') && text.endsWith('|');
}

function stripAdjacentVoice(lines: readonly string[], calloutIndex: number): { lines: string[]; calloutIndex: number } {
	let index = calloutIndex;
	while (index > 0 && (lines[index - 1] ?? '').trim() === '') index -= 1;
	if (index === 0 || !isVoiceQuoteLine(lines[index - 1] ?? '')) return { lines: [...lines], calloutIndex };
	let start = index;
	while (start > 0 && isVoiceQuoteLine(lines[start - 1] ?? '')) start -= 1;
	return {
		lines: [...lines.slice(0, start), ...lines.slice(calloutIndex)],
		calloutIndex: start,
	};
}

function stripAdjacentTable(lines: readonly string[], calloutIndex: number): { lines: string[]; calloutIndex: number } {
	let index = calloutIndex;
	while (index > 0 && (lines[index - 1] ?? '').trim() === '') index -= 1;
	if (!isMarkdownTableLine(lines[index - 1] ?? '')) return { lines: [...lines], calloutIndex };
	let start = index;
	while (start > 0) {
		const prev = lines[start - 1] ?? '';
		if (isMarkdownTableLine(prev)) {
			start -= 1;
			continue;
		}
		if (prev.trim() === '' && start > 1 && isMarkdownTableLine(lines[start - 2] ?? '')) {
			start -= 1;
			continue;
		}
		break;
	}
	return {
		lines: [...lines.slice(0, start), ...lines.slice(calloutIndex)],
		calloutIndex: start,
	};
}

function logLinesAfterDigest(body: readonly string[]): string[] {
	let index = 0;
	let sawDigest = false;
	while (index < body.length) {
		const line = body[index] ?? '';
		if (isTableOrVoice(line)) {
			sawDigest = true;
			index += 1;
			continue;
		}
		if (/^>\s*$/.test(line) && (sawDigest || nextIsDigest(body, index + 1))) {
			index += 1;
			continue;
		}
		break;
	}
	return [...body.slice(index)];
}

function isTableOrVoice(line: string): boolean {
	const text = line.replace(/^>\s?/, '').trim();
	if (text.startsWith('|') && text.endsWith('|')) return true;
	return isSuggesterText(text);
}

function nextIsDigest(body: readonly string[], index: number): boolean {
	return index < body.length && isTableOrVoice(body[index] ?? '');
}

function removeDigestRegions(lines: readonly string[]): string[] {
	const next: string[] = [];
	let skipping = false;
	for (const line of lines) {
		if (!skipping && isDigestStartLine(line)) {
			skipping = !isDigestEndLine(line);
			continue;
		}
		if (skipping) {
			if (isDigestEndLine(line)) skipping = false;
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
		const table = child.matches('table') ? child : child.querySelector(':scope > table, table');
		if (table && domInstanceOf(table, HTMLElement)) {
			child.classList.add('rv-locator-digest-block');
			table.classList.add('rv-locator-digest-table');
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
