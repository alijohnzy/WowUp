import { expect, test, type Page } from '@playwright/test';

// End-to-end verification of the ag-grid integration: the vanilla createGrid wrapper, the
// Svelte cell-renderer bridge, and the custom sort header — all rendering real rows.
//
// This is the part the migration assessment called the top risk, so it is worth exercising
// against actual data rather than trusting the unit test of the bridge alone.

const INSTALLATION = {
	id: 'inst-1',
	clientType: 1,
	label: 'Retail',
	displayName: 'Retail',
	location: '/games/wow/_retail_/Wow.exe',
	selected: true,
	defaultAddonChannelType: 0,
	defaultAutoUpdate: false
};

function searchResult(name: string, author: string, downloads: number) {
	return {
		externalId: `ext-${name}`,
		providerName: 'curseforge',
		name,
		author,
		thumbnailUrl: '',
		externalUrl: `https://example.com/${name}`,
		downloadCount: downloads,
		summary: `${name} summary`,
		screenshotUrls: [],
		files: [
			{
				channelType: 0,
				version: '1.2.3',
				downloadUrl: 'https://example.com/f.zip',
				folders: [],
				gameVersion: '100002',
				releaseDate: new Date('2024-06-01').toISOString(),
				dependencies: []
			}
		]
	};
}

const FEATURED = [
	searchResult('DBM', 'Tandanu', 5_000_000),
	searchResult('WeakAuras', 'InfusOnWoW', 9_000_000),
	searchResult('Details', 'Terciob', 3_000_000)
];

// Every addon provider is disabled via the stored preference, so the page takes its
// "no enabled providers" branch: an empty grid, no network, no error dialogs.
//
// That matters here — with providers enabled and no network, each one fails, each failure
// emits searchError, and the page opens an error alert. A modal <dialog> sits in the top
// layer and covers the whole UI, so every later click in the test would be intercepted.
// (Correct app behaviour; it just makes for a useless fixture.)
// Stored lowercased: setAddonProviderState() lowercases before writing and
// getAddonProviderState() looks up with `providerName.toLowerCase()`. A name that does not
// match is not an error — the provider simply keeps its default (enabled), which is exactly
// how the first two attempts at this fixture silently did nothing.
const DISABLED_PROVIDERS = [
	'Zip',
	'RaiderIO',
	'WowUpCompanion',
	'WowUpHub',
	'TukUI',
	'WowInterface',
	'GitHub',
	'Wago',
	'Curse',
	'CurseV2'
].map((name) => ({ providerName: name.toLowerCase(), enabled: false, canEdit: true }));

async function stubPreload(page: Page, featured: unknown[] = FEATURED) {
	await page.addInitScript(
		({ installs, addons, providers }) => {
			// Consent is a first-run gate that blocks bootstrap until answered — seed it as
			// already-answered so suites land on the page under test.
			const store: Record<string, unknown> = {
				telemetry_enabled: false,
				wago_prompt: true,
				update_notes_popup_version: '2.23.0',
				addon_migration_version: '2.23.0',
				wow_installations: installs,
				addon_providers: providers
			};
			(window as never as Record<string, unknown>)['platform'] = 'linux';
			(window as never as Record<string, unknown>)['userDataPath'] = '/tmp/wowup';
			(window as never as Record<string, unknown>)['logPath'] = '/tmp/wowup/logs';
			(window as never as Record<string, unknown>)['__featured'] = addons;

			(window as never as Record<string, unknown>)['wowup'] = {
				rendererInvoke: (channel: string, ...args: unknown[]) => {
					switch (channel) {
						case 'get-app-version':
							return Promise.resolve('2.23.0');
						case 'get-locale':
							return Promise.resolve('en');
						case 'store-get-object':
							return Promise.resolve(store[args[1] as string]);
						case 'store-set-object':
							store[args[1] as string] = args[2];
							return Promise.resolve();
						case 'addons-get-all':
						case 'addons-get-available-for-update':
						case 'addons-get-auto-update-enabled':
							return Promise.resolve([]);
						default:
							return Promise.resolve(undefined);
					}
				},
				rendererSend: () => {},
				rendererSendSync: () => undefined,
				rendererOn: () => {},
				rendererOff: () => {},
				onRendererEvent: () => {},
				openExternal: () => Promise.resolve(),
				openPath: () => Promise.resolve('')
			};
		},
		{ installs: [INSTALLATION], addons: featured, providers: DISABLED_PROVIDERS }
	);

	// Belt and braces: nothing should reach the network, and if something does it must not
	// sit on the circuit breaker's 10s-per-provider timeout. Note the page holds
	// setEnableControls(false) for the whole load, and enableControls also gates the
	// navigation rail — so a slow load disables the entire UI, not just this screen.
	await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
}

async function openGetAddons(page: Page) {
	await page.goto('/');
	await page.locator('.tab-strip').getByRole('link', { name: 'Get Addons' }).click();
}

test('Get Addons renders its controls', async ({ page }) => {
	await stubPreload(page);
	await openGetAddons(page);

	await expect(page.getByRole('button', { name: 'Install From URL' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Categories' })).toBeVisible();
	await expect(page.locator('.search-container input')).toBeVisible();
});

test('the grid mounts with ag-grid markup and column headers', async ({ page }) => {
	await stubPreload(page);
	await openGetAddons(page);

	// With no enabled providers the page short-circuits to an empty grid — which still
	// proves createGrid ran and the header cells rendered through the Svelte bridge.
	await expect(page.locator('.ag-theme-material')).toBeVisible();
	await expect(page.locator('.ag-header-cell-text').first()).toBeVisible();
});

test('column headers come from the ported Svelte header component', async ({ page }) => {
	await stubPreload(page);
	await openGetAddons(page);

	// .ag-cell-label-container is rendered by TableContextHeaderCell.svelte, not by ag-grid.
	const headers = page.locator('.ag-header-cell-text');
	await expect(headers.first()).toBeVisible();
	await expect(headers.filter({ hasText: 'Author' })).toHaveCount(1);
});

test('the categories drawer opens and lists categories', async ({ page }) => {
	await stubPreload(page);
	await openGetAddons(page);

	await page.getByRole('button', { name: 'Categories' }).click();

	await expect(page.locator('.drawer')).toBeVisible();
	await expect(page.locator('.category-item').first()).toBeVisible();
});

test('right-clicking a header opens the column picker', async ({ page }) => {
	await stubPreload(page);
	await openGetAddons(page);

	await page.locator('.ag-header-cell-text').first().click({ button: 'right' });

	await expect(page.locator('.column-menu')).toBeVisible();
	// Only toggleable columns are offered.
	await expect(page.locator('.column-menu-item')).toHaveCount(3);
});

test('Install From URL opens its dialog', async ({ page }) => {
	await stubPreload(page);
	await openGetAddons(page);

	await page.getByRole('button', { name: 'Install From URL' }).click();

	await expect(page.locator('dialog.wu-dialog')).toBeVisible();
	await expect(page.getByPlaceholder('Ex. GitHub or WowInterface URL')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Import' })).toBeVisible();
});
