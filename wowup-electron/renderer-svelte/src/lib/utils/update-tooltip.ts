// Composes the Update All button's tooltip: a header, then the addons the press will act on.
//
// Separate from the component because the truncation is the part that goes wrong quietly —
// an off-by-one leaves one addon silently unlisted, or says "and 1 more" while showing it.

/** Long enough to be useful, short enough that the tooltip is not a wall of text. */
export const TOOLTIP_MAX_ADDONS = 15;

/**
 * @param header the plain tooltip, used on its own when nothing is pending
 * @param names addons that would be updated, in display order
 * @param more renders the count of names beyond the cap, e.g. `(n) => \`…and ${n} more\``
 */
export function updateAllTooltipText(
	header: string,
	names: string[],
	more: (count: number) => string,
	max: number = TOOLTIP_MAX_ADDONS
): string {
	if (names.length === 0) return header;

	const shown = names.slice(0, max);
	const lines = shown.map((name) => `• ${name}`);

	// A single hidden addon is listed rather than summarised: "…and 1 more" costs a line and
	// tells the reader less than the name would have.
	const hidden = names.length - shown.length;
	if (hidden === 1) {
		lines.push(`• ${names[max]}`);
	} else if (hidden > 1) {
		lines.push(more(hidden));
	}

	return [header, '', ...lines].join('\n');
}
