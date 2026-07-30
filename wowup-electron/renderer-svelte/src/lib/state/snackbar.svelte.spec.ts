import { beforeEach, describe, expect, it, vi } from 'vitest';
import { snackbar } from './snackbar.svelte';

// Written after the packaged build showed ~20 identical "error checking for updates from Curse"
// toasts stacked over the whole window. syncStandardProviders emits one sync error per provider
// per installation and syncBatchProviders adds more, so a single provider outage with two WoW
// installations is a burst, not a one-off — and the first version of this store rendered every
// one of them. MatSnackBar shows exactly one.

describe('snackbar', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		if (snackbar.current) snackbar.dismiss(snackbar.current.id);
	});

	it('shows one message at a time', () => {
		snackbar.show('a');
		snackbar.show('b');
		snackbar.show('c');

		expect(snackbar.current?.message).toBe('c');
	});

	it('a burst of provider errors never stacks', () => {
		// Two installations x several providers, the shape that produced the screenshot.
		for (let i = 0; i < 20; i++) snackbar.show('COMMON.ERRORS.ADDON_SYNC_ERROR');

		expect(snackbar.current).toBeDefined();
	});

	it('dismisses itself after the timeout', () => {
		snackbar.show('a', { timeout: 1000 });
		expect(snackbar.current).toBeDefined();

		vi.advanceTimersByTime(1000);
		expect(snackbar.current).toBeUndefined();
	});

	it('a replaced message does not cut short the one that replaced it', () => {
		snackbar.show('first', { timeout: 1000 });
		vi.advanceTimersByTime(900);

		// Arrives 100ms before the first would have expired, with a full timeout of its own.
		snackbar.show('second', { timeout: 1000 });
		vi.advanceTimersByTime(200);

		expect(snackbar.current?.message).toBe('second');

		vi.advanceTimersByTime(800);
		expect(snackbar.current).toBeUndefined();
	});

	it('a stale dismiss cannot close a newer message', () => {
		const first = snackbar.show('first', { timeout: 0 });
		snackbar.show('second', { timeout: 0 });

		snackbar.dismiss(first);

		expect(snackbar.current?.message).toBe('second');
	});

	it('timeout 0 keeps the message up', () => {
		snackbar.show('sticky', { timeout: 0 });
		vi.advanceTimersByTime(60_000);

		expect(snackbar.current?.message).toBe('sticky');
	});
});
