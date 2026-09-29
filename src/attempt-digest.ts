/**
 * The Attempt Log digest is stored in the note, inside the callout, directly
 * under the title. Reading view leaves that block in the collapsible body.
 */

export const DIGEST_START = '<!-- rv-locator-digest -->';
export const DIGEST_END = '<!-- /rv-locator-digest -->';

/**
 * Bump when 1.2.8-style polish should run once per vault: drop the dated
 * visit list from the digest, and open Attempt Log headers that still use
 * the old collapsed default. A later manual collapse is left alone.
 */
export const DIGEST_POLISH_VERSION = 1;

const ATTEMPT_LOG_CALLOUT = /^>\s*\[!note\]\s*([+-])?\s*Attempt Log\s*$/i;

/** Insert or replace the digest block. Null when the note has no Attempt Log. */
export function upsertAttemptDigest(markdown: string, inner: string): string | null {
	const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
	const lines = markdown.split(/\r?\n/);
	const start = lines.findIndex((line) => ATTEMPT_LOG_CALLOUT.test(line));
	if (start < 0) return null;
	let end = start + 1;
	while (end < lines.length && /^>/.test(lines[end] ?? '')) end += 1;
	const section = lines.slice(start + 1, end);
	const block = digestLines(inner);
	const markerStart = section.findIndex((line) => line.includes(DIGEST_START));
	const markerEnd = section.findIndex((line) => line.includes(DIGEST_END));
	const nextSection = markerStart >= 0 && markerEnd >= markerStart
		? [...section.slice(0, markerStart), ...block, ...section.slice(markerEnd + 1)]
		: [...block, ...section];
	return [...lines.slice(0, start + 1), ...nextSection, ...lines.slice(end)].join(newline);
}

export function attemptLogCallouts(root: HTMLElement): HTMLElement[] {
	const nodes: HTMLElement[] = [];
	const consider = (node: Element): void => {
		if (!node.instanceOf(HTMLElement)) return;
		if (node.classList.contains('callout') && isAttemptLogCallout(node)) nodes.push(node);
	};
	consider(root);
	root.querySelectorAll('.callout').forEach(consider);
	return nodes;
}

export type AttemptLogRole = 'title' | 'hoisted' | 'body' | 'visit-list';

export interface AttemptLogPiece {
	key: string;
	role: AttemptLogRole;
	text: string;
}

/**
 * Table and bucket lines stay in the collapsible body, before the visit list.
 * A block that an older build parked outside the body is moved back in.
 * Nothing is left in the hoisted slot.
 */
export function containedAttemptLog(pieces: readonly AttemptLogPiece[]): AttemptLogPiece[] {
	const title = pieces.filter((piece) => piece.role === 'title');
	const hoisted = pieces
		.filter((piece) => piece.role === 'hoisted')
		.map((piece) => ({ ...piece, role: 'body' as const }));
	const body = pieces.filter((piece) => piece.role === 'body' || piece.role === 'visit-list');
	const listAt = body.findIndex((piece) => piece.role === 'visit-list');
	const head = listAt < 0 ? body : body.slice(0, listAt);
	const tail = listAt < 0 ? [] : body.slice(listAt);
	return [...title, ...hoisted, ...head, ...tail];
}

/**
 * One-time open for the old collapsed default (`> [!note]- Attempt Log`).
 * An already open `+` header, and any other callout, stays as written.
 */
export function openAttemptLogCallout(markdown: string): string {
	const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
	let changed = false;
	const lines = markdown.split(/\r?\n/).map((line) => {
		const match = /^(>\s*\[!note\])-(\s+Attempt Log\s*)$/i.exec(line);
		if (!match) return line;
		changed = true;
		return `${match[1]}+${match[2]}`;
	});
	return changed ? lines.join(newline) : markdown;
}

/**
 * Keep the digest inside the collapsible body and tag bucket lines.
 * Does not park a copy under the title where a collapsed callout would still show it.
 */
export function containAttemptDigest(callout: HTMLElement): void {
	const content = directChild(callout, 'callout-content');
	const title = directChild(callout, 'callout-title');
	if (!content || !title) return;
	const host = directChild(callout, 'rv-locator-return-digest');
	const pieces: AttemptLogPiece[] = [];
	const nodes = new Map<string, HTMLElement>();
	let serial = 0;
	const push = (role: AttemptLogRole, node: HTMLElement): void => {
		const key = String(serial);
		serial += 1;
		const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
		nodes.set(key, node);
		pieces.push({ key, role, text });
	};
	push('title', title);
	if (host) {
		for (const child of Array.from(host.children)) {
			if (!child.instanceOf(HTMLElement)) continue;
			push('hoisted', child);
		}
	}
	for (const child of Array.from(content.children)) {
		if (!child.instanceOf(HTMLElement)) continue;
		push(isVisitList(child) ? 'visit-list' : 'body', child);
	}
	if (host) host.remove();
	let seenList = false;
	for (const piece of containedAttemptLog(pieces)) {
		if (piece.role === 'title') continue;
		const node = nodes.get(piece.key);
		if (!node) continue;
		content.appendChild(node);
		if (piece.role === 'visit-list') {
			seenList = true;
			continue;
		}
		if (seenList) continue;
		node.classList.add('rv-locator-digest-block');
		const voice = digestVoiceClass(piece.text);
		if (voice) node.classList.add(voice);
	}
}

/** Class for one hoisted digest line. Untried is checked before Try. */
export function digestVoiceClass(text: string): string | null {
	if (/^Avoid\b/.test(text)) return 'is-avoid';
	if (/^Untried\b/.test(text)) return 'is-untried';
	if (/^Unsure\b/.test(text)) return 'is-unsure';
	if (/^Try\b/.test(text)) return 'is-try';
	if (/— (?:Home|Not home)$/.test(text)) return 'is-history';
	return null;
}

function digestLines(inner: string): string[] {
	const body = inner.replace(/\s+$/g, '').split('\n').map((line) => (line.trim() === '' ? '>' : `> ${line}`));
	return [`> ${DIGEST_START}`, ...body, `> ${DIGEST_END}`];
}

function isVisitList(node: HTMLElement): boolean {
	if (node.matches('ul, ol')) return true;
	if (node.classList.contains('list-item') || node.querySelector(':scope > ul, :scope > ol, .list-bullet')) return true;
	return false;
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
		if (child.instanceOf(HTMLElement) && child.classList.contains(className)) return child;
	}
	return null;
}
