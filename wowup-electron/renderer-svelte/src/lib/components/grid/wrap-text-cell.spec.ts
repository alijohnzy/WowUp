// @vitest-environment jsdom
//
// The author columns put their text in an inner element, so the three-line clamp in
// AgGrid.svelte applies. As a class on the cell itself it was overridden by the cell's inline
// style, and long author lists drew across the neighbouring rows.

import { describe, expect, it } from 'vitest';
import { WRAP_TEXT_CLASS, wrapTextCell } from './wrap-text-cell';

describe('wrapTextCell', () => {
	it('puts the text in an inner element that carries the clamp class', () => {
		const el = wrapTextCell({
			value: 'Aero, BreakBB, Cheeq, Dyaxler, Muehe',
			valueFormatted: null
		});
		expect(el.className).toBe(WRAP_TEXT_CLASS);
		expect(el.textContent).toBe('Aero, BreakBB, Cheeq, Dyaxler, Muehe');
	});

	it('shows the full text as a tooltip, since the cell may cut it off', () => {
		expect(wrapTextCell({ value: 'a, b, c', valueFormatted: null }).title).toBe('a, b, c');
	});

	it('prefers the formatted value and renders a missing one as empty', () => {
		expect(wrapTextCell({ value: 'raw', valueFormatted: 'shown' }).textContent).toBe('shown');
		expect(wrapTextCell({ value: undefined, valueFormatted: null }).textContent).toBe('');
	});

	it('treats the value as text, never markup', () => {
		const el = wrapTextCell({ value: '<img src=x onerror=alert(1)>', valueFormatted: null });
		expect(el.children).toHaveLength(0);
	});
});
