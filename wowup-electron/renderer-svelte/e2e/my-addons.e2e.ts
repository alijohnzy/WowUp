import { expect, test, type Page } from '@playwright/test';

// End-to-end tests for My Addons, driven with real addon rows so the grid, the Svelte cell
// renderers, filtering, and the right-click context menu are all exercised against data.

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

// See get-addons.e2e.ts: provider state is stored lowercased, and an unmatched name leaves
// the provider enabled at its default.
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

function addon(name: string, author: string, opts: Partial<Record<string, unknown>> = {}) {
	return {
		id: `id-${name}`,
		name,
		author,
		installationId: INSTALLATION.id,
		clientType: 1,
		providerName: 'WowUpHub',
		externalId: `ext-${name}`,
		externalUrl: `https://example.com/${name}`,
		thumbnailUrl: '',
		installedVersion: '1.0.0',
		latestVersion: '1.0.0',
		installedFolderList: [name],
		installedFolders: name,
		gameVersion: ['10.0.2'],
		channelType: 0,
		externalChannel: 'Stable',
		isIgnored: false,
		autoUpdateEnabled: false,
		autoUpdateNotificationsEnabled: false,
		isLoadOnDemand: false,
		installedAt: new Date('2024-05-01').toISOString(),
		releasedAt: new Date('2024-04-01').toISOString(),
		summary: `${name} summary`,
		dependencies: [],
		externalIds: [],
		...opts
	};
}

const ADDONS = [
	addon('DBM', 'Tandanu'),
	// Needs an update — drives the Update All button and the status cell.
	addon('WeakAuras', 'InfusOnWoW', { latestVersion: '2.0.0' }),
	addon('Details', 'Terciob', { isIgnored: true })
];

async function stubPreload(page: Page, addons: unknown[] = ADDONS) {
	await page.addInitScript(
		({ installs, providers, addonRows }) => {
			// Consent is a first-run gate that blocks bootstrap until answered — seed it as
			// already-answered so suites land on the page under test.
			const store: Record<string, unknown> = {
				telemetry_enabled: false,
				wago_prompt: true,
				update_notes_popup_version: '2.23.0',
				addon_migration_version: '2.23.0',
				// getBool() compares against the literal 'true' — a boolean here reads as false.
				enable_system_notifications: 'true',
				wow_installations: installs,
				addon_providers: providers
			};

			(window as never as Record<string, unknown>)['platform'] = 'linux';
			(window as never as Record<string, unknown>)['userDataPath'] = '/tmp/wowup';
			(window as never as Record<string, unknown>)['logPath'] = '/tmp/wowup/logs';

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
						case 'addons-get-all-for-installation':
							return Promise.resolve(addonRows);
						case 'addons-get-available-for-update':
							return Promise.resolve(
								(addonRows as { installedVersion: string; latestVersion: string }[]).filter(
									(a) => a.installedVersion !== a.latestVersion
								)
							);
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
		{ installs: [INSTALLATION], providers: DISABLED_PROVIDERS, addonRows: addons }
	);

	await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
}

async function openMyAddons(page: Page) {
	await page.goto('/');
	await page.locator('.tab-strip').getByRole('link', { name: 'My Addons' }).click();
	// Rows render through the Svelte cell-renderer bridge.
	await expect(page.locator('.ag-row').first()).toBeVisible();
}

test('renders installed addons as grid rows', async ({ page }) => {
	await stubPreload(page);
	await openMyAddons(page);

	await expect(page.locator('.ag-row')).toHaveCount(3);
	await expect(page.getByText('DBM')).toBeVisible();
	await expect(page.getByText('WeakAuras')).toBeVisible();
});

test('addon names render through the Svelte cell renderer', async ({ page }) => {
	// ag-grid virtualises columns as well as rows: at the default 1280px viewport the
	// author column — last of nine — is scrolled out and simply absent from the DOM.
	await page.setViewportSize({ width: 1700, height: 900 });
	await stubPreload(page);
	await openMyAddons(page);

	// .addon-column is MyAddonsAddonCell.svelte markup, not ag-grid's.
	await expect(page.locator('.addon-column').filter({ hasText: 'DBM' })).toBeVisible();
	// Author is a plain ag-grid field, no cell renderer — it proves the column config.
	await expect(page.getByText('Tandanu')).toBeVisible();
});

test('the filter narrows the rows', async ({ page }) => {
	await stubPreload(page);
	await openMyAddons(page);

	await page.locator('.filter-container input').fill('Weak');

	// Filtering is debounced by 200ms.
	await expect(page.locator('.ag-row')).toHaveCount(1);
	await expect(page.getByText('WeakAuras')).toBeVisible();
});

test('clearing the filter restores all rows', async ({ page }) => {
	await stubPreload(page);
	await openMyAddons(page);

	await page.locator('.filter-container input').fill('Weak');
	await expect(page.locator('.ag-row')).toHaveCount(1);

	await page.locator('.filter-container').getByRole('button', { name: 'Clear' }).click();
	await expect(page.locator('.ag-row')).toHaveCount(3);
});

test('Update All is enabled only when something needs updating', async ({ page }) => {
	await stubPreload(page);
	await openMyAddons(page);

	// WeakAuras has 1.0.0 installed vs 2.0.0 latest. Update All is a split button: the
	// label (.menu-button) and the dropdown chip share the accessible name.
	await expect(page.locator('.split-button .menu-button')).toBeEnabled();
});

test('Update All is disabled when everything is current', async ({ page }) => {
	await stubPreload(page, [addon('DBM', 'Tandanu')]);
	await openMyAddons(page);

	await expect(page.locator('.split-button .menu-button')).toBeDisabled();
});

test('right-clicking a row opens the addon context menu', async ({ page }) => {
	await stubPreload(page);
	await openMyAddons(page);

	await page.locator('.ag-row').first().click({ button: 'right' });

	await expect(page.locator('.context-menu')).toBeVisible();
	await expect(page.locator('.context-menu').getByText('Remove')).toBeVisible();
	// Installed folders are listed for a single-row selection.
	await expect(page.locator('.context-menu .menu-item.indent').first()).toBeVisible();
});

test('the auto-update notifications toggle appears only for an auto-updating addon', async ({
	page
}) => {
	// This item was dropped in the port. It is conditional in a way that makes it easy to miss:
	// hidden unless system notifications are on AND the addon auto-updates, so a fixture with
	// the defaults shows nothing and the omission looks correct.
	await stubPreload(page, [
		addon('DBM', 'Tandanu', { autoUpdateEnabled: true }),
		addon('Details', 'Terciob')
	]);
	await openMyAddons(page);

	const label = 'Notifications Enabled';

	await page.locator('.ag-row').first().click({ button: 'right' });
	await expect(page.locator('.context-menu').getByText(label)).toBeVisible();

	await page.keyboard.press('Escape');
	await page.locator('.ag-row').nth(1).click({ button: 'right' });
	await expect(page.locator('.context-menu')).toBeVisible();
	await expect(page.locator('.context-menu').getByText(label)).toHaveCount(0);
});

test('right-clicking a column header opens the column picker', async ({ page }) => {
	await stubPreload(page);
	await openMyAddons(page);

	await page.locator('.ag-header-cell-text').first().click({ button: 'right' });

	await expect(page.locator('.context-menu')).toBeVisible();
	// 7 of the 9 columns are toggleable.
	await expect(page.locator('.context-menu input[type="checkbox"]')).toHaveCount(7);
});

test('an ignored addon gets the ignored row class', async ({ page }) => {
	await stubPreload(page);
	await openMyAddons(page);

	// Details is stubbed as ignored; rowClassRules applies .ignored.
	await expect(page.locator('.ag-row.ignored')).toHaveCount(1);
});

test('an addon whose thumbnail fails to load falls back to its initial', async ({ page }) => {
	// The WowUp hub serves GitHub social-preview images as presigned S3 URLs carrying
	// `X-Amz-Expires=300`, so by the time a row renders the link is usually dead — which is why
	// some rows showed an icon and their neighbours showed an empty box. `alt=""` means a broken
	// image renders nothing at all, so there was not even a broken-image glyph to explain it.
	// The component already has a placeholder for the no-thumbnail case; this covers the
	// failed-thumbnail case using it too.
	await stubPreload(page, [
		addon('Broken Thumb', 'someone', { thumbnailUrl: '/definitely-missing-thumbnail.png' })
	]);
	await openMyAddons(page);

	const row = page.locator('.ag-row').first();
	await expect(row).toBeVisible();
	await expect(row.locator('.addon-logo-letter')).toHaveText('B');
	await expect(row.locator('img')).toHaveCount(0);
});

test('floating panels are opaque, not see-through', async ({ page }) => {
	// The theme has three surface tokens that carry alpha (--background-secondary-2 at 0.9, -3
	// and -4 at 0.8) and one that does not (--background-secondary-2-fill). The translucent ones
	// are correct for panels that sit *in* the layout and wrong for anything floating above it:
	// the context menu used -4 and the addon grid showed straight through it.
	//
	// Angular never had to decide this — mat-menu and mat-select got their opaque surface from
	// mat.all-component-themes, which the port dropped along with the rest of Material. Checking
	// the computed alpha rather than the token, since the token is what keeps being chosen wrong.
	await stubPreload(page);
	await openMyAddons(page);

	const alphaOf = (css: string) => {
		const parts = css.match(/[\d.]+/g)!.map(Number);
		return parts.length > 3 ? parts[3] : 1;
	};

	// The page-actions menu behind the ⋮ button.
	await page.locator('.page-actions-btn, [aria-label="More"], .wu-btn-icon').last().click();
	const menu = page.locator('.context-menu');
	await expect(menu).toBeVisible();
	expect(alphaOf(await menu.evaluate((el) => getComputedStyle(el).backgroundColor))).toBe(1);
	await page.keyboard.press('Escape');

	// The client dropdown panel.
	await page.locator('.select-trigger').click();
	const panel = page.locator('.select-content');
	await expect(panel).toBeVisible();
	expect(alphaOf(await panel.evaluate((el) => getComputedStyle(el).backgroundColor))).toBe(1);
});
