import { describe, expect, it, vi } from 'vitest';
import { SerialByKey } from './serial-by-key';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The shape of AddonService.rescanInstallation against the addon store: read, scan, remove
 * everything for the installation, save the result — with awaits between, as every store call
 * is an IPC round trip.
 */
function fakeStore() {
	let rows: string[] = [];
	const rescan = async (): Promise<string[]> => {
		await tick(); // read + scan
		const scanned = ['DBM', 'WeakAuras', 'Details'];
		await tick();
		rows = []; // remove all for installation
		await tick();
		rows.push(...scanned); // save all
		return rows;
	};
	return { rescan, rows: () => rows };
}

describe('SerialByKey', () => {
	// #1561: several My Addons loads at startup, nothing saved yet, each one rescanning.
	it('stops overlapping rescans from leaving a copy of every addon', async () => {
		const store = fakeStore();
		const rescans = new SerialByKey<string[]>();

		await Promise.all([
			rescans.run('retail', store.rescan),
			rescans.run('retail', store.rescan),
			rescans.run('retail', store.rescan)
		]);

		expect(store.rows()).toEqual(['DBM', 'WeakAuras', 'Details']);
	});

	it('runs a call made mid-run again afterwards, and shares that rerun with later callers', async () => {
		const rescans = new SerialByKey<number>();
		let runs = 0;
		let release!: () => void;
		const fn = vi.fn(async () => {
			runs++;
			if (runs === 1) await new Promise<void>((r) => (release = r));
			return runs;
		});

		const first = rescans.run('retail', fn);
		const second = rescans.run('retail', fn);
		const third = rescans.run('retail', fn);
		await tick();
		expect(fn).toHaveBeenCalledTimes(1); // the rerun waits for the first

		release();
		expect(await first).toBe(1);
		expect(await second).toBe(2);
		expect(await third).toBe(2);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('keeps different keys independent', async () => {
		const rescans = new SerialByKey<string>();
		let release!: () => void;
		const blocked = rescans.run(
			'retail',
			() => new Promise<string>((r) => (release = () => r('retail')))
		);

		expect(await rescans.run('classic', () => Promise.resolve('classic'))).toBe('classic');
		release();
		expect(await blocked).toBe('retail');
	});

	it('does not let a failed run block the next one', async () => {
		const rescans = new SerialByKey<string>();
		const failing = rescans.run('retail', () => Promise.reject(new Error('scan failed')));
		const next = rescans.run('retail', () => Promise.resolve('ok'));

		await expect(failing).rejects.toThrow('scan failed');
		expect(await next).toBe('ok');
		expect(rescans.active('retail')).toBeUndefined();
	});
});
