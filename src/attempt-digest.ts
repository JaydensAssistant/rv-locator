/**
 * Suggested return times sit on the Attempt Log callout, under the title,
 * so the digest stays visible while the log itself is collapsed.
 */

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

export function ensureReturnDigestHost(callout: HTMLElement): HTMLElement {
	const existing = directChild(callout, 'rv-locator-return-digest');
	if (existing) return existing;
	const host = callout.createDiv({
		cls: 'rv-locator-return-digest',
		attr: { 'aria-label': 'Suggested return times' },
	});
	const title = directChild(callout, 'callout-title');
	if (title) callout.insertBefore(host, title.nextSibling);
	return host;
}

export function paintReturnDigest(host: HTMLElement, lines: readonly string[]): void {
	host.empty();
	for (const line of lines) {
		host.createDiv({ cls: returnLineClass(line), text: line });
	}
}

function isAttemptLogCallout(callout: HTMLElement): boolean {
	const title = directChild(callout, 'callout-title');
	if (!title) return false;
	const inner = title.querySelector('.callout-title-inner');
	const text = (inner?.textContent ?? '').replace(/\s+/g, ' ').trim();
	return /^attempt log$/i.test(text);
}

function directChild(parent: HTMLElement, className: string): HTMLElement | null {
	for (const child of Array.from(parent.children)) {
		if (child.instanceOf(HTMLElement) && child.classList.contains(className)) return child;
	}
	return null;
}

function returnLineClass(line: string): string {
	if (line.startsWith('Strongest')) return 'rv-locator-return-line is-strongest';
	if (line.startsWith('Avoid ·')) return 'rv-locator-return-line is-avoid';
	if (line.startsWith('Untried')) return 'rv-locator-return-line is-untried';
	return 'rv-locator-return-line';
}
