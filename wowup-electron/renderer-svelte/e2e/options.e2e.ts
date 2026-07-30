import { expect, test, type Page } from '@playwright/test';

// Behavioural smoke tests for the migrated Options slice.
//
// These assert user-visible behaviour, not implementation details — the thing the Angular
// tree does not have. Its one E2E file asserts `app-home h1` reads "App works !" (the
// Angular scaffold string) on Spectron, archived since 2022.
//
// The renderer normally talks to the Electron preload bridge (window.wowup). Here it is
// stubbed so the slice can run in a plain browser, and so IPC calls can be asserted.

const IPC_CALLS = '__ipcCalls';

async function stubPreload(page: Page) {
	await page.addInitScript(() => {
		const calls: Array<{ channel: string; args: unknown[] }> = [];
		// Consent is a first-run gate that blocks bootstrap until answered — seed it as
		// already-answered so suites land on the page under test.
		const store: Record<string, unknown> = {
			telemetry_enabled: false,
			wago_prompt: true,
			update_notes_popup_version: '2.23.0',
			addon_migration_version: '2.23.0'
		};

		(window as never as Record<string, unknown>)['__ipcCalls'] = calls;

		(window as never as Record<string, unknown>)['platform'] = 'linux';
		// The preload supplies these; wowup.applicationFolderPath / applicationLogsFolderPath
		// read them at construction, so they must exist before the module graph loads.
		(window as never as Record<string, unknown>)['userDataPath'] = '/tmp/wowup';
		(window as never as Record<string, unknown>)['logPath'] = '/tmp/wowup/logs';
		(window as never as Record<string, unknown>)['wowup'] = {
			rendererInvoke: (channel: string, ...args: unknown[]) => {
				calls.push({ channel, args });
				if (channel === 'get-app-version') return Promise.resolve('2.23.0');
				if (channel === 'ow-is-cmp-required') return Promise.resolve(false);
				if (channel === 'store-get-object') return Promise.resolve(store[args[1] as string]);
				return Promise.resolve(undefined);
			},
			rendererSend: () => {},
			rendererSendSync: () => undefined,
			rendererOn: () => {},
			rendererOff: () => {},
			onRendererEvent: () => {},
			openExternal: (url: string) => {
				calls.push({ channel: 'openExternal', args: [url] });
				return Promise.resolve();
			},
			openPath: () => Promise.resolve('')
		};
	});
}

test.beforeEach(async ({ page }) => {
	await stubPreload(page);
	await page.goto('/#/options');
});

test('renders the vertical tab rail with translated labels', async ({ page }) => {
	// Labels come from src/assets/i18n/en.json via the messageformat layer that replaced
	// @ngx-translate — if the i18n glob broke, these would render as raw dot-path keys.
	await expect(page.getByRole('tab', { name: 'Clients' })).toBeVisible();
	await expect(page.getByRole('tab', { name: 'Application' })).toBeVisible();
	await expect(page.getByRole('tab', { name: 'Debug' })).toBeVisible();
	await expect(page.getByRole('tab', { name: 'About' })).toBeVisible();
});

test('About tab shows the app version fetched over IPC', async ({ page }) => {
	await page.getByRole('tab', { name: 'About' }).click();

	// Scoped to the About header: the shell footer renders the version too, and every
	// changelog entry carries its own .version element.
	await expect(page.locator('.about .header .version')).toHaveText('v2.23.0');

	const calls = await page.evaluate(
		(k) => (window as never as Record<string, { channel: string }[]>)[k],
		IPC_CALLS
	);
	expect(calls.map((c) => c.channel)).toContain('get-app-version');
});

test('external links open in the OS browser instead of navigating the renderer', async ({
	page
}) => {
	// This is the behaviour the dead ExternalLinkDirective was meant to have. Navigating
	// away would strand the user in a WoW addon manager with no back button.
	await page.getByRole('tab', { name: 'About' }).click();
	// Scoped to the header — the changelog body also contains wowup.io links.
	await page
		.locator('.link-container')
		.getByRole('link', { name: 'Check out the website!' })
		.click();

	const calls = await page.evaluate(
		(k) => (window as never as Record<string, { channel: string; args: unknown[] }[]>)[k],
		IPC_CALLS
	);
	const external = calls.filter((c) => c.channel === 'openExternal');
	expect(external).toHaveLength(1);
	expect(external[0].args[0]).toBe('https://wowup.io');

	await expect(page).toHaveURL(/\/options/);
});

test('Debug tab opens the log folder', async ({ page }) => {
	await page.getByRole('tab', { name: 'Debug' }).click();
	await page.locator('#show-log-btn').click();

	// This asserted `show-logs-folder`, a channel the main process does not register — the
	// component was calling it directly instead of going through wowup.showLogsFolder(). The
	// real path reveals the logs directory via the generic show-directory channel, and the
	// argument is what actually matters here.
	const calls = await page.evaluate(
		(k) => (window as never as Record<string, { channel: string; args: unknown[] }[]>)[k],
		IPC_CALLS
	);
	const showDirectory = calls.filter((c) => c.channel === 'show-directory');
	expect(showDirectory).toHaveLength(1);
	expect(String(showDirectory[0].args[0])).toContain('logs');
});

test('tab rail is keyboard navigable', async ({ page }) => {
	// bits-ui gives roving focus for free; the Angular original was a <mat-action-list>
	// of buttons driving an index, with no tab semantics at all.
	await page.getByRole('tab', { name: 'Clients' }).focus();
	await page.keyboard.press('ArrowDown');
	await expect(page.getByRole('tab', { name: 'Application' })).toBeFocused();
});
