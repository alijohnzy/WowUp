import { describe, expect, it } from 'vitest';
import { updateAllTooltipText } from './update-tooltip';

const more = (n: number) => `…and ${n} more`;

describe('updateAllTooltipText', () => {
	it('is just the header when nothing is pending', () => {
		// The button is disabled in this state, but it still has a tooltip.
		expect(updateAllTooltipText('Update all addons', [], more)).toBe('Update all addons');
	});

	it('lists what the press will act on, under the header', () => {
		const text = updateAllTooltipText('Update all addons', ['Details!', 'WeakAuras'], more);
		expect(text).toBe('Update all addons\n\n• Details!\n• WeakAuras');
	});

	it('truncates a long list rather than filling the screen', () => {
		const names = Array.from({ length: 40 }, (_, i) => `Addon ${i + 1}`);
		const lines = updateAllTooltipText('h', names, more, 5).split('\n');

		// header, blank, 5 addons, the summary
		expect(lines).toHaveLength(8);
		expect(lines.at(-1)).toBe('…and 35 more');
		expect(lines).toContain('• Addon 5');
		expect(lines).not.toContain('• Addon 6');
	});

	it('lists the last addon instead of summarising a single one', () => {
		// "…and 1 more" costs the same line as the name and says less.
		const names = ['a', 'b', 'c'];
		const lines = updateAllTooltipText('h', names, more, 2).split('\n');
		expect(lines.at(-1)).toBe('• c');
		expect(lines.join('\n')).not.toContain('1 more');
	});

	it('shows every addon when the list exactly fills the cap', () => {
		// The boundary the off-by-one lives on.
		const names = ['a', 'b', 'c'];
		const text = updateAllTooltipText('h', names, more, 3);
		expect(text).toBe('h\n\n• a\n• b\n• c');
		expect(text).not.toContain('more');
	});
});
