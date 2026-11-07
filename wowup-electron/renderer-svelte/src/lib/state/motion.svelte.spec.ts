// Animations are on unless the user turns them off or the OS asks for reduced motion — and
// either of those must stop every one of them, Svelte transitions included.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored = new Map<string, unknown>();
vi.mock('$lib/services/storage', () => ({
	preferenceStorage: {
		getAsync: (key: string) => Promise.resolve(stored.get(key)),
		setAsync: (key: string, value: unknown) => {
			stored.set(key, String(value)); // the Rust store keeps booleans as strings
			return Promise.resolve();
		}
	}
}));

let reduced = false;
let notify: ((e: { matches: boolean }) => void) | undefined;

beforeEach(() => {
	stored.clear();
	reduced = false;
	notify = undefined;
	vi.resetModules();
	vi.stubGlobal('matchMedia', () => ({
		get matches() {
			return reduced;
		},
		addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => (notify = fn)
	}));
});

async function load() {
	const { motion, ANIMATIONS_KEY } = await import('./motion.svelte');
	await motion.init();
	return { motion, ANIMATIONS_KEY };
}

describe('motion', () => {
	it('animates by default', async () => {
		const { motion } = await load();
		expect(motion.enabled).toBe(true);
		expect(motion.ms(150)).toBe(150);
	});

	it('stays off once turned off', async () => {
		const first = await load();
		await first.motion.set(false);
		expect(first.motion.ms(150)).toBe(0);
		expect(stored.get(first.ANIMATIONS_KEY)).toBe('false');

		vi.resetModules();
		const { motion } = await load();
		expect(motion.enabled).toBe(false);
	});

	it('follows the OS asking for reduced motion, even with the setting on', async () => {
		reduced = true;
		const { motion } = await load();
		expect(motion.setting).toBe(true);
		expect(motion.enabled).toBe(false);

		notify?.({ matches: false });
		expect(motion.enabled).toBe(true);
	});
});
