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

test('Clients section scrolls when the installations overflow the window', async ({ page }) => {
	const installations = Array.from({ length: 6 }, (_, i) => ({
		...INSTALLATION,
		id: `inst-${i}`,
		label: `Client ${i}`,
		displayName: `Client ${i}`,
		location: `/games/wow-${i}/_retail_/Wow.exe`,
		selected: i === 0
	}));
	await page.setViewportSize({ width: 1280, height: 720 });
	await stubPreload(page, { installations });
	await openOptionsTab(page, 'Clients');

	const last = page.getByRole('heading', { name: 'Client 5' });
	await expect(last).not.toBeInViewport();

	// A wheel over the panel, not scrollIntoView: an overflow:hidden ancestor still scrolls
	// programmatically, so only a user-style scroll proves the list is reachable.
	await page.getByRole('heading', { name: 'Client 0' }).hover();
	await page.mouse.wheel(0, 5000);

	await expect(last).toBeInViewport();
	// The bottom of the last card too — a section taller than its panel scrolls, but its
	// final rows end up under the clip and still can't be reached.
	await expect(
		page.locator('.installation-card').last().getByRole('button', { name: 'Edit' })
	).toBeInViewport({ ratio: 1 });
});

test('Clients section shows the empty state with no installations', async ({ page }) => {
	await stubPreload(page, { installations: [] });
	await openOptionsTab(page, 'Clients');

	await expect(page.locator('.empty')).toBeVisible();
	await expect(page.locator('.installation-card')).toHaveCount(0);
});

// Only the Tauri tray has an Update All item, so the setting is shown only there. Faking a
// whole Tauri startup is a rabbit hole, so the app boots on the Electron stub and is marked as
// Tauri afterwards, before Options mounts. IPC keeps going through the stub (ipc.ts checks
// Electron first), so writes are still recorded, while isTauri() reports true.
test('a client can be set to update from the tray, and the tray is recounted', async ({ page }) => {
	await stubPreload(page);
	await page.goto('/#/my-addons');
	const optionsLink = page.getByRole('link', { name: 'Options' });
	await expect(optionsLink).toBeVisible();
	await page.evaluate(() => {
		(window as never as Record<string, unknown>)['__TAURI_INTERNALS__'] = {
			invoke: () => Promise.resolve(),
			transformCallback: () => 0
		};
	});
	await optionsLink.click();
	await optionsRail(page).getByRole('tab', { name: 'Clients' }).click();

	const row = page.locator('.installation-card .row', { hasText: 'Update from Tray' });
	await expect(row).toContainText('even when another client is selected');
	const toggle = row.getByRole('switch');
	await expect(toggle).toBeDisabled(); // like every card setting, only editable in edit mode

	await page.getByRole('button', { name: 'Edit' }).click();
	await toggle.click();
	const traySyncsBefore = await page.evaluate(
		() =>
			(window as never as { __ipcCalls: { channel: string }[] }).__ipcCalls.filter(
				(c) => c.channel === 'set-tray-update-count'
			).length
	);
	await page.getByRole('button', { name: 'Save' }).click();

	await expect
		.poll(
			async () => ((await store(page))['wow_installations'] as { updateFromTray?: boolean }[])[0]
		)
		.toMatchObject({ updateFromTray: true });
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(window as never as { __ipcCalls: { channel: string }[] }).__ipcCalls.filter(
						(c) => c.channel === 'set-tray-update-count'
					).length
			)
		)
		.toBeGreaterThan(traySyncsBefore);
	await expect(toggle).toBeChecked();
});

test('the tray setting is not offered outside the Tauri app', async ({ page }) => {
	await stubPreload(page);
	await openOptionsTab(page, 'Clients');

	await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
	await expect(page.getByText('Update from Tray')).toHaveCount(0);
});

// The client's color frames its addon tables. The default is stored as no color at all, so a
// client keeps following its type's default rather than a copy of it.
test('a color picked for a client frames its addon table', async ({ page }) => {
	await stubPreload(page);
	await openOptionsTab(page, 'Clients');
	const card = page.locator('.installation-card');
	const storedColor = async () =>
		((await store(page))['wow_installations'] as { color?: string }[])[0].color;

	// Like every card setting, only editable in edit mode.
	const gold = card.getByRole('button', { name: 'World of Warcraft Classic' });
	await expect(gold).toBeDisabled();

	await card.getByRole('button', { name: 'Edit' }).click();
	await gold.click();
	await expect(gold).toHaveAttribute('aria-pressed', 'true');
	await card.getByRole('button', { name: 'Save' }).click();
	await expect.poll(storedColor).toBe('#e3b02a');

	await page.getByRole('link', { name: 'My Addons' }).click();
	await expect(page.locator('.client-frame')).toHaveCSS('border-top-color', 'rgb(227, 176, 42)');
	await expect(page.locator('.select-trigger .client-dot')).toHaveCSS(
		'background-color',
		'rgb(227, 176, 42)'
	);

	await page.getByRole('link', { name: 'Options' }).click();
	await card.getByRole('button', { name: 'Edit' }).click();
	await card.getByRole('button', { name: 'Default' }).click();
	await card.getByRole('button', { name: 'Save' }).click();
	await expect.poll(storedColor).toBeUndefined();
});

// Off by default: the theme colors the buttons. On, the selected client's color does, with
// whichever label color reads on it — dark on the stub client's jade.
test('buttons can take the client color instead of the theme', async ({ page }) => {
	await stubPreload(page);
	await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
	await openOptionsTab(page, 'Application');
	const jade = 'rgb(34, 184, 154)';
	const button = page.getByRole('button', { name: 'Install from URL' });

	await page.getByRole('link', { name: 'Get Addons' }).click();
	await expect(button).toBeVisible();
	await expect(button).not.toHaveCSS('background-color', jade);

	await page.getByRole('link', { name: 'Options' }).click();
	await optionsRail(page).getByRole('tab', { name: 'Application' }).click();
	await page
		.locator('.setting', { hasText: "Buttons in the client's color" })
		.getByRole('switch')
		.click();
	await expect.poll(async () => (await store(page))['client_color_buttons']).toBe(true);

	await page.getByRole('link', { name: 'Get Addons' }).click();
	await expect(button).toHaveCSS('background-color', jade);
	await expect(button).toHaveCSS('color', 'rgb(20, 20, 28)');
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

	await page.locator('.setting', { hasText: 'Minimize on Close' }).locator('.switch-root').click();

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
