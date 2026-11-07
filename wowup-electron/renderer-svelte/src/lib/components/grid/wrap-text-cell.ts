// Cell renderer for free text that may run long, such as an addon's author list: up to three
// lines, then an ellipsis, with the whole text in a tooltip.
//
// The clamp has to sit on an element inside the cell. Both grids give every cell an inline
// `display: flex` column to centre its content vertically (Get Addons also an inline
// `line-height: 62px`), and inline styles beat any class on the cell itself. When the clamp
// was a class on the cell, the inline style switched it off: each wrapped line was a whole
// row tall, so a two-line author list drew its lines across the row borders, half in the rows
// above and below. Inside the cell the text is a flex item: centred by the cell, clamped by
// itself. The Angular app's CellWrapTextComponent had the same shape.
//
// A plain function rather than a Svelte component: there is nothing reactive in it, and ag-grid
// calls it again whenever the value changes.

import type { ICellRendererParams } from 'ag-grid-community';

export const WRAP_TEXT_CLASS = 'wrap-text-cell';

export function wrapTextCell(params: Pick<ICellRendererParams, 'value' | 'valueFormatted'>) {
	const text = params.valueFormatted ?? (params.value == null ? '' : String(params.value));
	const el = document.createElement('span');
	el.className = WRAP_TEXT_CLASS;
	el.textContent = text;
	el.title = text;
	return el;
}
