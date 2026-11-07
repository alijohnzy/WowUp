// A busy indicator must not flash for a load that finishes quickly, and must go away the
// moment the load does.

import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { delayed } from './delayed.svelte';

let busy = $state(false);
let cleanup: () => void;
let indicator: { readonly current: boolean };

beforeEach(() => {
	vi.useFakeTimers();
	busy = false;
	cleanup = $effect.root(() => {
		indicator = delayed(() => busy, 300);
	});
	flushSync();
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('delayed', () => {
	it('stays off for a load shorter than the delay', () => {
		busy = true;
		flushSync();
		vi.advanceTimersByTime(299);
		busy = false;
		flushSync();
		vi.advanceTimersByTime(1000);
		expect(indicator.current).toBe(false);
	});

	it('comes on once the load outlasts the delay, and goes off with it', () => {
		busy = true;
		flushSync();
		vi.advanceTimersByTime(300);
		expect(indicator.current).toBe(true);

		busy = false;
		flushSync();
		expect(indicator.current).toBe(false);
	});
});
