/**
 * Return Suggestions is the outer callout. Voice lines sit inside it.
 * Attempt Log is nested under those lines, with the daypart table and then
 * the dated bullets. The outer callout is the rewrite boundary, so the note
 * has no visible digest markers.
 * An ordinary rewrite leaves each fold (`+` / `-` / unmarked) as the note
 * already has it. The one-time polish can collapse an opened log.
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
 * 5 wraps that quote and log in Return Suggestions, nests Attempt Log,
 * and rewrites the suggestions callout type from the color setting.
 * 6 adds an empty line between the frontmatter and RV Dashboard.
 * 7 drops the RV Dashboard fold mark and re-voices every digest with
 * attempted Off slots included.
 * 8 adds the Log past visit and Archive buttons beside Home and Not home.
 */
export const DIGEST_POLISH_VERSION = 8;

export function isDigestStartLine(line: string): boolean {
	return line.includes(DIGEST_START) || line.includes(LEGACY_DIGEST_START);
}

export function isDigestEndLine(line: string): boolean {
	return line.includes(DIGEST_END) || line.includes(LEGACY_DIGEST_END);
}

const ATTEMPT_LOG_CALLOUT = /^(?:>[\t ]*)+\[!note\][\t ]*([+-])?[\t ]*Attempt Log[\t ]*$/i;
const RETURN_SUGGESTIONS = /^(?:>[\t ]*)+\[!([A-Za-z0-9-]+)\][\t ]*([+-])?[\t ]*Return Suggestions[\t ]*$/i;

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
	/** Obsidian callout type for Return Suggestions, such as `example` or `info`. */
	suggestionType?: string;
}

/**
 * Rebuild Return Suggestions around Attempt Log. Voice lines go inside the
 * outer callout. The daypart table and the dated bullets stay inside the
 * nested Attempt Log. A flat 1.2.11 quote-plus-log is wrapped on rewrite.
 * Marker regions are stripped. Null when the note has no Attempt Log.
 */
export function upsertAttemptDigest(markdown: string, parts: DigestNoteParts, options?: DigestWriteOptions): string | null {
	const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
	const lines = removeDigestRegions(markdown.split(/\r?\n/));
	const logIndex = lines.findIndex((line) => ATTEMPT_LOG_CALLOUT.test(line));
	if (logIndex < 0) return null;
	const start = suggestionsRegionStart(lines, logIndex);
	const end = calloutEnd(lines, start);
	const logAt = lines.findIndex((line, index) => index >= start && index < end && ATTEMPT_LOG_CALLOUT.test(line));
	if (logAt < 0) return null;
	const before = lines.slice(0, start);
	while (before.length > 0 && (before[before.length - 1] ?? '').trim() === '') before.pop();
	const rest = lines.slice(end);
	const suggestionFold = isReturnSuggestionsLine(lines[start] ?? '') ? foldMark(lines[start] ?? '') : '';
	const logFold = options?.collapse ? '-' : foldMark(lines[logAt] ?? '');
	const block = buildSuggestionsBlock({
		type: sanitizeSuggestionType(options?.suggestionType),
		suggestionFold,
		logFold,
		sentences: quoteLines(parts),
		table: parts.table,
		bullets: extractBullets(lines.slice(logAt + 1, end)),
	});
	const lead = before.length > 0 ? [''] : [];
	return [...before, ...lead, ...block, ...rest].join(newline);
}

/**
 * Where a new `###` stamp is inserted: above the suggester quote when one
 * sits on Attempt Log, above a legacy marker block, or at the callout.
 * A thematic break that sits on that block stays with the quote, so the
 * stamp lands in the notes area above the rule.
 */
export function attemptLogAnchor(lines: readonly string[], calloutIndex: number): number {
	let anchor = suggestionsRegionStart(lines, calloutIndex);
	if (anchor === calloutIndex) {
		let index = calloutIndex;
		while (index > 0 && (lines[index - 1] ?? '') === '') index -= 1;
		const previous = lines[index - 1] ?? '';
		if (index > 0 && isDigestEndLine(previous)) {
			let start = index - 1;
			while (start > 0 && !isDigestStartLine(lines[start] ?? '')) start -= 1;
			if (isDigestStartLine(lines[start] ?? '')) anchor = start;
		}
	}
	return aboveThematicBreak(lines, anchor);
}

function aboveThematicBreak(lines: readonly string[], index: number): number {
	let cursor = index;
	while (cursor > 0 && (lines[cursor - 1] ?? '') === '') cursor -= 1;
	if (cursor > 0 && isThematicBreak(lines[cursor - 1] ?? '')) return cursor - 1;
	return index;
}

function isThematicBreak(line: string): boolean {
	return /^([-*_])\1{2,}\s*$/.test(line.trim());
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
 * a note not yet rewritten, is marked too. With `suggestionType`, Return
 * Suggestions is shown in that callout color even before the file is rewritten.
 */
export function decorateAttemptLog(root: HTMLElement, suggestionType?: string): void {
	const type = suggestionType ? sanitizeSuggestionType(suggestionType) : '';
	for (const callout of returnSuggestionCallouts(root)) {
		callout.classList.add('rv-locator-return-suggestions');
		if (type && callout.getAttribute('data-callout') !== type) callout.setAttribute('data-callout', type);
		tagInsideLegacy(callout);
	}
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
		if (foldMark(line) === '-') return line;
		changed = true;
		return `${quoteMarks(quoteDepth(line))} [!note]- Attempt Log`;
	});
	return changed ? next.join(newline) : markdown;
}

function quoteLines(parts: DigestNoteParts): string[] {
	const lines = parts.sentences.length > 0
		? parts.sentences
		: (!parts.table && parts.text ? [parts.text] : []);
	return lines.filter((line) => line.trim().length > 0).map((line) => `> ${line}`);
}

function isSuggesterText(text: string): boolean {
	return /^(?:Avoid|Try|Unsure|Untried)\b/.test(text) || text === 'No May-go-out days';
}

function isVoiceQuoteLine(line: string): boolean {
	if (!/^>/.test(line) || /\[!/.test(line)) return false;
	return isSuggesterText(line.replace(/^(?:>\s*)+/, '').trim());
}

function isReturnSuggestionsLine(line: string): boolean {
	return RETURN_SUGGESTIONS.test(line);
}

function suggestionsRegionStart(lines: readonly string[], logIndex: number): number {
	let index = logIndex;
	while (index > 0) {
		const prev = lines[index - 1] ?? '';
		if (prev.trim() === '') {
			const earlier = index > 1 ? lines[index - 2] ?? '' : '';
			if (isReturnSuggestionsLine(earlier) || isVoiceQuoteLine(earlier) || isDigestFurniture(earlier)) {
				index -= 1;
				continue;
			}
			break;
		}
		if (isReturnSuggestionsLine(prev)) return index - 1;
		if (isVoiceQuoteLine(prev) || isDigestFurniture(prev)) {
			index -= 1;
			continue;
		}
		break;
	}
	return index;
}

function isDigestFurniture(line: string): boolean {
	if (!/^>/.test(line)) return false;
	if (isReturnSuggestionsLine(line) || ATTEMPT_LOG_CALLOUT.test(line) || isVoiceQuoteLine(line)) return false;
	if (isDigestStartLine(line) || isDigestEndLine(line)) return true;
	const text = line.replace(/^(?:>\s*)+/, '').trim();
	if (text === '') return true;
	return text.startsWith('|') && text.endsWith('|');
}

function foldMark(line: string): '' | '+' | '-' {
	const match = /\[![A-Za-z0-9-]+\][\t ]*([+-])?/.exec(line);
	if (match?.[1] === '+' || match?.[1] === '-') return match[1];
	return '';
}

function quoteDepth(line: string): number {
	const lead = /^(?:>\s*)+/.exec(line)?.[0] ?? '>';
	return Math.max(1, (lead.match(/>/g) ?? []).length);
}

function quoteMarks(depth: number): string {
	return Array.from({ length: Math.max(1, depth) }, () => '>').join(' ');
}

function sanitizeSuggestionType(value: string | undefined): string {
	const text = (value ?? 'example').trim().toLowerCase();
	return /^[a-z0-9-]+$/.test(text) ? text : 'example';
}

function extractBullets(lines: readonly string[]): string[] {
	const bullets: string[] = [];
	for (const line of lines) {
		const text = line.replace(/^(?:>\s*)+/, '').trim();
		const match = /^[-*]\s+(.+)$/.exec(text);
		if (match?.[1]) bullets.push(match[1].trim());
	}
	return bullets;
}

function buildSuggestionsBlock(args: {
	type: string;
	suggestionFold: '' | '+' | '-';
	logFold: '' | '+' | '-';
	sentences: readonly string[];
	table: string;
	bullets: readonly string[];
}): string[] {
	const lines = [`> [!${args.type}]${args.suggestionFold} Return Suggestions`, ...args.sentences];
	lines.push('>');
	lines.push(`> > [!note]${args.logFold} Attempt Log`);
	lines.push('> >');
	const table = args.table.split('\n').map((row) => row.trim()).filter((row) => row.length > 0).map((row) => `> >${row}`);
	lines.push(...table);
	if (table.length > 0 && args.bullets.length > 0) lines.push('> >');
	for (const bullet of args.bullets) lines.push(`> >- ${bullet}`);
	return lines;
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
	while (end < lines.length) {
		const line = lines[end] ?? '';
		if (/^>/.test(line)) {
			end += 1;
			continue;
		}
		if (line.trim() === '') {
			let next = end + 1;
			while (next < lines.length && (lines[next] ?? '').trim() === '') next += 1;
			const following = lines[next] ?? '';
			if (
				isReturnSuggestionsLine(following)
				|| ATTEMPT_LOG_CALLOUT.test(following)
				|| isVoiceQuoteLine(following)
				|| isDigestFurniture(following)
			) {
				end = next;
				continue;
			}
		}
		break;
	}
	return end;
}

function returnSuggestionCallouts(root: HTMLElement): HTMLElement[] {
	const nodes: HTMLElement[] = [];
	const consider = (node: Element): void => {
		if (!domInstanceOf(node, HTMLElement)) return;
		if (!node.classList.contains('callout')) return;
		const title = directChild(node, 'callout-title');
		if (!title) return;
		const inner = title.querySelector('.callout-title-inner');
		const text = (inner?.textContent ?? title.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (/^return suggestions$/i.test(text)) nodes.push(node);
	};
	consider(root);
	root.querySelectorAll('.callout').forEach(consider);
	return nodes;
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
