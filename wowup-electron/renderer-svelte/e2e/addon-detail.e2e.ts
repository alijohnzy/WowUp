import { expect, test, type Page } from '@playwright/test';

// End-to-end tests for the addon-detail dialog, opened from My Addons.
//
// Everything the dialog shows is derived from the addon record plus provider calls. No
// provider is registered in these fixtures, so getFullDescription resolves to '' and the
// component falls back to DESCRIPTION_NOT_FOUND — deterministic. The changelog takes the
// addon's own latestChangelog when latestChangelogVersion matches latestVersion, which is
// how a changelog gets into the test without a live provider.

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

// See get-addons.e2e.ts: provider state is stored lowercased.
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

function addon(name: string, opts: Record<string, unknown> = {}) {
	return {
		id: `id-${name}`,
		name,
		author: 'Tandanu',
		installationId: INSTALLATION.id,
		clientType: 1,
		providerName: 'WowUpHub',
		externalId: `ext-${name}`,
		externalUrl: `https://example.com/${name}`,
		thumbnailUrl: '',
		installedVersion: '1.2.3',
		latestVersion: '1.2.3',
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

const RICH = addon('DBM', {
	fundingLinks: [{ platform: 'GITHUB', url: 'https://github.com/sponsors/dbm' }],
	screenshotUrls: [
		'https://example.com/shot-1.png',
		'https://example.com/shot-2.png',
		'https://example.com/shot-3.png'
	],
	// AddonDependencyType.Required === 2
	dependencies: [{ externalAddonId: 'dep-1', type: 2 }],
	latestChangelog: '<p>Fixed a thing.</p>',
	latestChangelogVersion: '1.2.3'
});

async function stubPreload(page: Page, addons: unknown[]) {
	await page.addInitScript(
		({ installs, providers, addonRows }) => {
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
							return Promise.resolve([]);
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

async function openDetail(page: Page, addons: unknown[] = [RICH]) {
	await stubPreload(page, addons);
	await page.goto('/');
	await page.locator('.tab-strip').getByRole('link', { name: 'My Addons' }).click();
	await expect(page.locator('.ag-row').first()).toBeVisible();
	await page.locator('.ag-row').first().dblclick();
	await expect(page.locator('dialog.addon-detail')).toBeVisible();
}

test('double-clicking a row opens the detail dialog with the addon header', async ({ page }) => {
	await openDetail(page);

	const dialog = page.locator('dialog.addon-detail');
	await expect(dialog.locator('.title')).toHaveText('DBM');
	await expect(dialog.getByText('By Tandanu')).toBeVisible();
	await expect(dialog.getByText('1.2.3')).toBeVisible();
});

test('the description tab falls back when no provider supplies one', async ({ page }) => {
	await openDetail(page);

	// No provider is registered, so getFullDescription resolves to ''.
	await expect(page.locator('dialog.addon-detail .addon-summary')).toHaveText(
		'No description found'
	);
});

test('the changelog tab renders the addon changelog', async ({ page }) => {
	await openDetail(page);

	await page.locator('dialog.addon-detail').getByRole('tab', { name: 'Changelog' }).click();
	await expect(page.locator('dialog.addon-detail .addon-changelog')).toContainText(
		'Fixed a thing.'
	);
});

test('the previews tab shows a thumbnail per screenshot', async ({ page }) => {
	await openDetail(page);

	await page.locator('dialog.addon-detail').getByRole('tab', { name: 'Previews' }).click();
	await expect(page.locator('dialog.addon-detail .image-thumb')).toHaveCount(3);
});

test('clicking a thumbnail opens the lightbox and steps through images', async ({ page }) => {
	await openDetail(page);

	await page.locator('dialog.addon-detail').getByRole('tab', { name: 'Previews' }).click();
	await page.locator('.image-thumb-container').first().click();

	const lightbox = page.locator('.lightbox');
	await expect(lightbox).toBeVisible();
	await expect(lightbox.locator('.lightbox-counter')).toHaveText('1 / 3');

	await lightbox.getByRole('button', { name: 'Next' }).click();
	await expect(lightbox.locator('.lightbox-counter')).toHaveText('2 / 3');

	// Wraps backwards past the first image.
	await lightbox.getByRole('button', { name: 'Previous' }).click();
	await lightbox.getByRole('button', { name: 'Previous' }).click();
	await expect(lightbox.locator('.lightbox-counter')).toHaveText('3 / 3');
});

test('Escape closes the lightbox without closing the detail dialog', async ({ page }) => {
	await openDetail(page);

	await page.locator('dialog.addon-detail').getByRole('tab', { name: 'Previews' }).click();
	await page.locator('.image-thumb-container').first().click();
	await expect(page.locator('.lightbox')).toBeVisible();

	await page.keyboard.press('Escape');

	await expect(page.locator('.lightbox')).toBeHidden();
	await expect(page.locator('dialog.addon-detail')).toBeVisible();
});

test('funding links render for the author', async ({ page }) => {
	await openDetail(page);

	await expect(page.getByText('Support this author')).toBeVisible();
	await expect(
		page.locator('dialog.addon-detail .funding-row a, dialog.addon-detail .funding-row button')
	).toHaveCount(1);
});

test('the required-dependency banner counts dependencies', async ({ page }) => {
	await openDetail(page);

	await expect(page.locator('.addon-dependencies')).toContainText('1 required dependency');
});

test('tabs that have no content are not rendered', async ({ page }) => {
	// No screenshots and no changelog source, but the provider still allows changelogs.
	await openDetail(page, [addon('WeakAuras')]);

	const dialog = page.locator('dialog.addon-detail');
	await expect(dialog.getByRole('tab', { name: 'Previews' })).toHaveCount(0);
	await expect(dialog.getByRole('tab', { name: 'Description' })).toBeVisible();

	await dialog.getByRole('tab', { name: 'Changelog' }).click();
	await expect(dialog.getByText('No changelog available')).toBeVisible();
});

test('the close button dismisses the dialog', async ({ page }) => {
	await openDetail(page);

	await page.locator('dialog.addon-detail .close-icon').click();
	await expect(page.locator('dialog.addon-detail')).toHaveCount(0);
});

test('single-clicking the addon name opens the detail dialog', async ({ page }) => {
	// The name is a button in MyAddonsAddonCell wired to the column's `onViewDetails`
	// cellRendererParams. When the bridge did not forward those params the handler was
	// undefined, so nothing happened and the row could only be opened by double-clicking —
	// which is the grid's own onRowDoubleClicked, not the cell.
	await stubPreload(page, [RICH]);
	await page.goto('/');
	await page.locator('.tab-strip').getByRole('link', { name: 'My Addons' }).click();
	await expect(page.locator('.ag-row').first()).toBeVisible();

	await page.locator('.addon-title').first().click();

	await expect(page.locator('dialog.addon-detail')).toBeVisible();
});

test('clicking outside the dialog closes it', async ({ page }) => {
	// MatDialog dismissed on a backdrop click unless disableClose was set. A native modal
	// <dialog> does not do that on its own, so every dialog in the port had lost
	// click-outside-to-close until `closedBy` was wired up in the modalDialog attachment.
	await openDetail(page);

	// The backdrop is a pseudo-element, so a click on it lands on the <dialog> box itself.
	// Clicking well outside the dialog's rect is what exercises light dismiss.
	await page.mouse.click(20, 20);

	await expect(page.locator('dialog.addon-detail')).toHaveCount(0);
});

test('rapid snackbars never stack', async ({ page }) => {
	// MatSnackBar shows one at a time; the port originally rendered every message. That was
	// invisible for the one-off successes it was tested with, and catastrophic on a provider
	// outage: syncStandardProviders raises one error per provider per installation, and roughly
	// twenty identical toasts covered the entire window. Counting DOM nodes rather than store
	// entries so this holds regardless of how the store is shaped.
	// The handler writes to the clipboard before raising the toast, and an unpermitted
	// navigator.clipboard.writeText rejects — so without this the click produces nothing.
	await page.context().grantPermissions(['clipboard-write']);
	await openDetail(page);

	const copyId = page.locator('.wu-dialog button.icon').first();
	for (let i = 0; i < 5; i++) await copyId.click();

	await expect(page.locator('.snackbar')).toHaveCount(1);
});
