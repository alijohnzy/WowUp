import { expect, test, type Page } from '@playwright/test';

// Guards the payoff of routing the app instead of switching on session.selectedHomeTab.
//
// With the {#if} chain, one +page.svelte imported all five screens, so ag-grid's ~1 MB was in
// the initial bundle whichever screen you opened — including Options, which has no grid. The
// only way to notice a regression here is to measure what the browser actually fetches, which
// is what this does: a stray top-level `import AgGrid` in the shell would put it back and no
// other test would care.

const GRID_MARKER = 'ag-grid';

async function stubPreload(page: Page) {
	await page.addInitScript(() => {
		const store: Record<string, unknown> = {
			telemetry_enabled: false,
			wago_prompt: true,
			update_notes_popup_version: '2.23.0',
			addon_migration_version: '2.23.0',
			wow_installations: [
				{
					id: 'i1',
					location: '/wow/_retail_',
					label: 'Retail',
					clientType: 3,
					selected: true,
					defaultAddonChannelType: 0,
					defaultAutoUpdate: false
				}
			]
		};
		(window as never as Record<string, unknown>)['platform'] = 'linux';
		(window as never as Record<string, unknown>)['userDataPath'] = '/tmp/wowup';
		(window as never as Record<string, unknown>)['logPath'] = '/tmp/wowup/logs';
		(window as never as Record<string, unknown>)['wowup'] = {
			rendererInvoke: (channel: string, ...args: unknown[]) => {
				if (channel === 'get-app-version') return Promise.resolve('2.23.0');
				if (channel === 'store-get-object') return Promise.resolve(store[args[1] as string]);
				if (channel.startsWith('addons-get')) return Promise.resolve([]);
				return Promise.resolve(undefined);
			},
			rendererSend: () => {},
			rendererSendSync: () => undefined,
			rendererOn: () => {},
			rendererOff: () => {},
			onRendererEvent: () => {},
			openExternal: () => Promise.resolve(),
			openPath: () => Promise.resolve('')
		};
	});
}

/** Total bytes of JS fetched to render `path`, and whether ag-grid was among it. */
async function measure(page: Page, path: string) {
	let bytes = 0;
	let loadedGrid = false;
	const pending: Promise<void>[] = [];

	page.on('response', (response) => {
		if (!response.url().endsWith('.js')) return;
		pending.push(
			response
				.body()
				.then((body) => {
					bytes += body.length;
					if (body.includes(GRID_MARKER)) loadedGrid = true;
				})
				.catch(() => {})
		);
	});

	await stubPreload(page);
	await page.goto(path);
	await page.waitForTimeout(3000);
	await Promise.all(pending);

	return { kb: bytes / 1024, loadedGrid };
}

test('Options does not pay for the addon grid', async ({ page }) => {
	const options = await measure(page, '/#/options');

	expect(options.loadedGrid).toBe(false);
	// Generous: the point is the order of magnitude, not a byte count that churns on every
	// dependency bump. The grid alone is ~1 MB.
	expect(options.kb).toBeLessThan(1000);
});

test('My Addons does load the grid', async ({ page }) => {
	// The counterpart assertion — without it, the test above would also pass if routing broke
	// in a way that stopped loading the grid anywhere.
	const myAddons = await measure(page, '/#/my-addons');

	expect(myAddons.loadedGrid).toBe(true);
	// Attached, not visible: with no addons the page hides the grid behind its empty state,
	// which is correct behaviour. Presence proves the component mounted.
	await expect(page.locator('.ag-root-wrapper')).toBeAttached();
});
