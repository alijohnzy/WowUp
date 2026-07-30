import { expect, test, type Page } from '@playwright/test';

// Behavioural tests for the six Options sections.
//
// The preload bridge is stubbed with a mutable store so preference writes can be asserted
// — several of these settings persist through store-set-object and nothing else would
// prove the toggle actually did anything.

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

async function stubPreload(page: Page, opts: { installations?: unknown[] } = {}) {
	const installations = opts.installations ?? [INSTALLATION];

	await page.addInitScript((installs) => {
		const calls: Array<{ channel: string; args: unknown[] }> = [];
		// Consent is a first-run gate that blocks bootstrap until answered — seed it as
		// already-answered so suites land on the page under test.
		const store: Record<string, unknown> = {
			telemetry_enabled: false,
			wago_prompt: true,
			update_notes_popup_version: '2.23.0',
			addon_migration_version: '2.23.0',
			wow_installations: installs
		};

		(window as never as Record<string, unknown>)['__ipcCalls'] = calls;
		(window as never as Record<string, unknown>)['__store'] = store;
		(window as never as Record<string, unknown>)['platform'] = 'linux';
		(window as never as Record<string, unknown>)['userDataPath'] = '/tmp/wowup';
		(window as never as Record<string, unknown>)['logPath'] = '/tmp/wowup/logs';

		(window as never as Record<string, unknown>)['wowup'] = {
			rendererInvoke: (channel: string, ...args: unknown[]) => {
				calls.push({ channel, args });
				switch (channel) {
					case 'get-app-version':
						return Promise.resolve('2.23.0');
					case 'get-locale':
						return Promise.resolve('en');
					case 'store-get-object':
						// args[0] names the store. The real profile has a GitHub token in the
						// sensitive one; returning undefined for it is what kept the Addons
						// section's persist loop from ever firing in these tests.
						return Promise.resolve(
							args[0] === 'sensitive'
								? { github_personal_access_token: 'ghp_atokenshapedvalue000000000000000001' }[
										args[1] as string
									]
								: store[args[1] as string]
						);
					case 'store-set-object':
						store[args[1] as string] = args[2];
						return Promise.resolve();
					case 'addons-get-all':
					case 'addons-get-available-for-update':
					case 'addons-get-auto-update-enabled':
						return Promise.resolve([]);
					case 'warcraft-get-executable-name':
						return Promise.resolve('Wow.exe');
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
	}, installations);
}

const optionsRail = (page: Page) => page.locator('.nav-item-list');

async function openOptionsTab(page: Page, name: string) {
	await page.goto('/#/options');
	await optionsRail(page).getByRole('tab', { name }).click();
}

const store = (page: Page) =>
	page.evaluate(() => (window as never as Record<string, Record<string, unknown>>)['__store']);

test('Clients section lists installations and offers rescan / add', async ({ page }) => {
	await stubPreload(page);
	await openOptionsTab(page, 'Clients');

	await expect(page.getByRole('button', { name: 'Re-Scan' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add New' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Retail' })).toBeVisible();
});

test('Clients section shows the empty state with no installations', async ({ page }) => {
	await stubPreload(page, { installations: [] });
	await openOptionsTab(page, 'Clients');

	await expect(page.locator('.empty')).toBeVisible();
	await expect(page.locator('.installation-card')).toHaveCount(0);
});

test('a client card enters edit mode and reveals save / cancel', async ({ page }) => {
	await stubPreload(page);
	await openOptionsTab(page, 'Clients');

	// Edit-mode controls are hidden until Edit is pressed.
	await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);

	await page.getByRole('button', { name: 'Edit' }).click();

	await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
});

test('Application section renders its settings', async ({ page }) => {
	await stubPreload(page);
	await openOptionsTab(page, 'Application');

	// Theme, language and scale selects plus the toggle rows.
	await expect(page.locator('.container select')).toHaveCount(4);
	await expect(page.locator('.container .switch-root').first()).toBeVisible();
});

test('toggling a simple Application setting persists it', async ({ page }) => {
	await stubPreload(page);
	await openOptionsTab(page, 'Application');

	// "Minimize on close" persists straight through with no confirmation dialog.
	const before = await store(page);
	expect(before['collapse_to_tray']).toBeUndefined();

	await page.locator('.container .switch-root').first().click();

	await expect.poll(async () => (await store(page))['collapse_to_tray']).toBe(true);
});

test('a setting that requires confirmation reverts when declined', async ({ page }) => {
	await stubPreload(page);
	await openOptionsTab(page, 'Application');

	// Symlink mode prompts before enabling; declining must put the toggle back.
	const symlink = page
		.locator('.setting')
		.filter({ hasText: 'Enable Symlink Support' })
		.locator('.switch-root');
	await symlink.click();

	// DIALOGS.CONFIRM.NEGATIVE_BUTTON is "No", not "Cancel".
	await expect(page.locator('dialog.wu-dialog')).toBeVisible();
	await page.locator('dialog.wu-dialog').getByRole('button', { name: 'No' }).click();

	await expect(symlink).toHaveAttribute('data-state', 'unchecked');
	expect((await store(page))['use_symlink_mode']).toBeUndefined();
});

test('Addons section lists editable providers', async ({ page }) => {
	await stubPreload(page);
	await openOptionsTab(page, 'Addons');

	await expect(page.locator('.provider-list li').first()).toBeVisible();
	// GitHub token field is always present; the Wago one is flavour-gated.
	await expect(page.locator('input[type="password"]').first()).toBeVisible();
});

test('WTF Explorer renders its tree container and path', async ({ page }) => {
	await stubPreload(page);
	await openOptionsTab(page, 'WTF Explorer');

	await expect(page.locator('.tree-container')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
});

test('Options > Addons does not lock up the app', async ({ page }) => {
	// Persisting the tokens used to be an $effect that read both of them and called a debounced
	// writer. That was safe with a hand-rolled setTimeout debounce, and became an infinite loop
	// the moment it was swapped for runed's `useDebounce`, which keeps its timer in `$state`:
	// calling it wrote that state and the teardown's `cancel()` wrote it again, so the effect
	// invalidated itself. Svelte reports effect_update_depth_exceeded and the renderer stops
	// responding — every button in the app, not just this screen, because one runaway effect
	// starves the scheduler.
	//
	// It only reproduces with a token present, which is why every existing test on this section
	// passed: the stub returned undefined for the sensitive store.
	const pageErrors: string[] = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));

	await stubPreload(page);
	await page.goto('/#/options');
	await page.getByRole('tab', { name: 'Addons' }).click();
	await expect(page.getByText('Enabled Addon Providers')).toBeVisible();

	await page.waitForTimeout(2500);
	expect(pageErrors.join('\n')).not.toContain('effect_update_depth_exceeded');

	// And the rest of the UI still answers.
	await page.getByRole('tab', { name: 'Debug' }).click();
	await expect(page.locator('#show-log-btn')).toBeVisible();
});
