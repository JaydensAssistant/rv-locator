/**
 * The Attempt Log digest is stored in the note, directly under the callout title,
 * and hoisted in reading view so a collapsed log still shows it.
 */

export const DIGEST_START = '<!-- rv-locator-digest -->';
export const DIGEST_END = '<!-- /rv-locator-digest -->';

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

/**
 * Move the digest (everything in the callout before the visit list) to sit
 * under the title, outside the collapsible body.
 */
export function hoistAttemptDigest(callout: HTMLElement): void {
	const content = directChild(callout, 'callout-content');
	const title = directChild(callout, 'callout-title');
	if (!content || !title) return;
	let host = directChild(callout, 'rv-locator-return-digest');
	const moving = digestNodes(content);
	if (moving.length === 0) {
		if (host && host.childElementCount === 0) host.remove();
		return;
	}
	if (!host) {
		host = callout.createDiv({
			cls: 'rv-locator-return-digest',
			attr: { 'aria-label': 'Attempt log digest' },
		});
		callout.insertBefore(host, title.nextSibling);
	}
	host.empty();
	for (const node of moving) {
		const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
		const voice = digestVoiceClass(text);
		if (voice) node.classList.add(voice);
		host.appendChild(node);
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

function digestNodes(content: HTMLElement): HTMLElement[] {
	const moving: HTMLElement[] = [];
	for (const child of Array.from(content.children)) {
		if (!child.instanceOf(HTMLElement)) continue;
		if (isVisitList(child)) break;
		moving.push(child);
	}
	return moving;
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
