import { expect, test, type Page } from '@playwright/test';

// End-to-end tests for the two dialogs reachable from the My Addons page-actions menu:
// Import/Export (AddonManageDialog) and WTF Settings Backup (WtfBackup).
//
// Both are driven entirely by IPC, so the fixture stubs the channels they reach for rather
// than the services themselves: base64-encode and clipboard-read-text for import/export,
// list-files + stat-files + zip-read-file for the backup list.

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

// One active, one ignored — drives both counters on the export tab.
const ADDONS = [addon('DBM'), addon('Details', { isIgnored: true })];

interface Fixture {
	backupFiles?: string[];
	clipboardText?: string;
	zipMeta?: string;
	/** Provider names to leave enabled. Import checks the *enabled* provider list. */
	enableProviders?: string[];
}

async function stubPreload(page: Page, fixture: Fixture = {}) {
	await page.addInitScript(
		({ installs, providers, addonRows, backupFiles, clipboardText, zipMeta }) => {
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
						case 'addons-get-auto-update-enabled':
							return Promise.resolve([]);
						case 'base64-encode':
							return Promise.resolve(btoa(args[0] as string));
						case 'clipboard-read-text':
							return Promise.resolve(clipboardText ?? '');
						case 'list-files':
							return Promise.resolve(backupFiles ?? []);
						case 'stat-files': {
							const stats: Record<string, unknown> = {};
							for (const file of args[0] as string[]) {
								stats[file] = { size: 2048, birthtimeMs: Date.parse('2024-06-01') };
							}
							return Promise.resolve(stats);
						}
						case 'zip-read-file':
							// Rejecting here is what produces the GENERIC_ERROR backup state.
							return zipMeta === undefined
								? Promise.reject(new Error('no meta'))
								: Promise.resolve(zipMeta);
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
		{
			installs: [INSTALLATION],
			providers: DISABLED_PROVIDERS.filter(
				(p) => !(fixture.enableProviders ?? []).map((n) => n.toLowerCase()).includes(p.providerName)
			),
			addonRows: ADDONS,
			backupFiles: fixture.backupFiles,
			clipboardText: fixture.clipboardText,
			zipMeta: fixture.zipMeta
		}
	);

	await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
}

async function openPageActions(page: Page) {
	await page.goto('/');
	await page.locator('.tab-strip').getByRole('link', { name: 'My Addons' }).click();
	await expect(page.locator('.ag-row').first()).toBeVisible();
	await page.getByRole('button', { name: 'More actions' }).click();
	await expect(page.locator('.context-menu')).toBeVisible();
}

// ---- Import / Export -------------------------------------------------------------------

async function openManageDialog(page: Page, fixture: Fixture = {}) {
	await stubPreload(page, fixture);
	await openPageActions(page);
	await page.locator('.context-menu').getByText('Import/Export Addons').click();
	await expect(page.locator('dialog.addon-manage')).toBeVisible();
}

test('the import/export dialog opens on the export tab with the addon counts', async ({ page }) => {
	await openManageDialog(page);

	const dialog = page.locator('dialog.addon-manage');
	await expect(dialog.getByRole('heading')).toContainText('Retail');
	// One active (DBM), one ignored (Details).
	await expect(dialog.getByText('Active addons: 1')).toBeVisible();
	await expect(dialog.getByText('Ignored addons: 1')).toBeVisible();
});

test('the export tab shows the base64 payload', async ({ page }) => {
	await openManageDialog(page);

	const payload = page.locator('dialog.addon-manage .export-content');
	await expect(payload).toBeVisible();

	// Round-trips back to the export JSON, and excludes the ignored addon.
	const value = await payload.inputValue();
	const decoded = JSON.parse(atob(value)) as { addons: { name: string }[] };
	expect(decoded.addons.map((a) => a.name)).toEqual(['DBM']);
});

test('the import tab shows the instructions and an empty field', async ({ page }) => {
	await openManageDialog(page);

	const dialog = page.locator('dialog.addon-manage');
	await dialog.getByRole('tab', { name: 'Import' }).click();

	await expect(
		dialog.getByText('Paste WowUp addon export data into the field below to get started')
	).toBeVisible();
	await expect(dialog.locator('.import-content')).toHaveValue('');
	await expect(dialog.getByRole('button', { name: 'Import' })).toBeVisible();
});

test('Paste fills the import field from the clipboard', async ({ page }) => {
	await openManageDialog(page, { clipboardText: 'pasted-export-string' });

	const dialog = page.locator('dialog.addon-manage');
	await dialog.getByRole('tab', { name: 'Import' }).click();
	await dialog.getByRole('button', { name: 'Paste' }).click();

	await expect(dialog.locator('.import-content')).toHaveValue('pasted-export-string');
});

test('an unparseable import string is rejected', async ({ page }) => {
	await openManageDialog(page);

	const dialog = page.locator('dialog.addon-manage');
	await dialog.getByRole('tab', { name: 'Import' }).click();
	await dialog.locator('.import-content').fill('not-valid-at-all');
	await dialog.getByRole('button', { name: 'Import' }).click();

	await expect(page.getByText('Import string was invalid')).toBeVisible();
});

test('a valid import string produces a comparison list', async ({ page }) => {
	// The import rejects payloads naming a provider that is not enabled, so this is the one
	// case that needs WowUpHub live.
	await openManageDialog(page, { enableProviders: ['WowUpHub'] });

	const payload = {
		collection_name: 'test',
		// The enum *name* for the fixture's clientType 1, not the label.
		client_type: 'Classic',
		addons: [
			// Already installed, and version_id matches (both undefined) — no change.
			{ name: 'DBM', provider_name: 'WowUpHub', id: 'ext-DBM' },
			// Not installed — added.
			{ name: 'WeakAuras', provider_name: 'WowUpHub', id: 'ext-WeakAuras' }
		]
	};

	const dialog = page.locator('dialog.addon-manage');
	await dialog.getByRole('tab', { name: 'Import' }).click();
	await dialog.locator('.import-content').fill(JSON.stringify(payload));
	await dialog.getByRole('button', { name: 'Import' }).click();

	await expect(dialog.getByText('Importing 2 addons')).toBeVisible();
	await expect(dialog.locator('.comparison-row')).toHaveCount(2);
	await expect(dialog.locator('.added-badge')).toHaveCount(1);
	await expect(dialog.locator('.no-change-badge')).toHaveCount(1);

	// Reset returns to the entry form.
	await dialog.getByRole('button', { name: 'Reset' }).click();
	await expect(dialog.locator('.import-content')).toBeVisible();
});

// ---- WTF backup ------------------------------------------------------------------------

async function openBackupDialog(page: Page, fixture: Fixture = {}) {
	await stubPreload(page, fixture);
	await openPageActions(page);
	await page.locator('.context-menu').getByText('Interface Settings Backup').click();
	await expect(page.locator('dialog.wtf-backup')).toBeVisible();
}

test('the backup dialog reports an empty backup folder', async ({ page }) => {
	await openBackupDialog(page, { backupFiles: [] });

	const dialog = page.locator('dialog.wtf-backup');
	await expect(dialog.getByText('No backups were found at:')).toBeVisible();
	// The path is derived from the app folder plus the installation id.
	await expect(dialog.getByText('inst-1')).toBeVisible();
});

test('the backup dialog lists backups with size and date', async ({ page }) => {
	await openBackupDialog(page, {
		backupFiles: ['wtf_1717200000000.zip', 'wtf_1717300000000.zip'],
		zipMeta: JSON.stringify({
			contents: ['WTF/Config.wtf'],
			createdAt: Date.parse('2024-06-01'),
			createdBy: 'wowup'
		})
	});

	const dialog = page.locator('dialog.wtf-backup');
	await expect(dialog.getByText('Found 2 backups')).toBeVisible();
	await expect(dialog.locator('.backup-list-item')).toHaveCount(2);
	await expect(dialog.locator('.backup-list-item').first()).toContainText('2 kb');
});

test('a backup with unreadable metadata is flagged rather than listed as usable', async ({
	page
}) => {
	// zipMeta omitted, so zip-read-file rejects and the backup gets GENERIC_ERROR.
	await openBackupDialog(page, { backupFiles: ['wtf_1717200000000.zip'] });

	const dialog = page.locator('dialog.wtf-backup');
	await expect(dialog.getByText('There was an issue processing this backup')).toBeVisible();
	// No apply/delete buttons for a broken backup.
	await expect(dialog.locator('.backup-actions')).toHaveCount(0);
});

test('deleting a backup asks for confirmation first', async ({ page }) => {
	await openBackupDialog(page, {
		backupFiles: ['wtf_1717200000000.zip'],
		zipMeta: JSON.stringify({
			contents: ['WTF/Config.wtf'],
			createdAt: Date.parse('2024-06-01'),
			createdBy: 'wowup'
		})
	});

	await page
		.locator('dialog.wtf-backup')
		.getByRole('button', { name: 'Delete this backup' })
		.click();

	await expect(page.getByText('Delete WTF Backup?')).toBeVisible();
});
