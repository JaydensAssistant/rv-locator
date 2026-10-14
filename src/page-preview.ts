export interface PagePreviewDecision {
	/** The hover is on the RV Dashboard or a Glancable card. */
	inScope: boolean;
	/** Stop the event so core Page Preview does not open on its own. */
	suppress: boolean;
	/** Open core Page Preview with its `preview` source. */
	open: boolean;
}

/**
 * Off blocks preview on the dashboard and Glancable cards.
 * On opens it through core's own preview source. A custom hover source is
 * not enough: core Page Preview leaves that hover closed.
 */
export function pagePreviewDecision(enabled: boolean, inScope: boolean): PagePreviewDecision {
	if (!inScope) return { inScope: false, suppress: false, open: false };
	if (!enabled) return { inScope: true, suppress: true, open: false };
	return { inScope: true, suppress: true, open: true };
}
