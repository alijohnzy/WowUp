// The footer's update button gives an answer when clicked. A check that found nothing used to
// leave the footer exactly as it was, so the button looked like it did nothing.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const show = vi.fn();
const checkForAppUpdate = vi.fn();

vi.mock('$lib/ipc', () => ({
	isTauri: () => true,
	isElectron: () => false,
	invoke: vi.fn(() => Promise.resolve(undefined)),
	send: vi.fn(),
	on: vi.fn(() => () => {})
}));
vi.mock('$lib/state/snackbar.svelte', () => ({
	snackbar: { show: (...a: unknown[]) => show(...a) }
}));
vi.mock('$lib/state/wowup.svelte', () => ({
	wowup: { checkForAppUpdate: () => checkForAppUpdate(), installUpdate: vi.fn() }
}));
vi.mock('$lib/state/session.svelte', () => ({
	session: { appVersion: '2.25.4', statusText: '', pageContextText: '', loadAppVersion: vi.fn() }
}));
vi.mock('$lib/state/dialogs.svelte', () => ({ dialogs: { confirm: vi.fn() } }));
vi.mock('$lib/services/links', () => ({ openExternalLink: vi.fn() }));

import { AppUpdateState } from '$common/wowup/models';
import { electron } from '$lib/state/electron.svelte';
import Footer from './Footer.svelte';

let footer: ReturnType<typeof mount> | undefined;

function render(): HTMLElement {
	const target = document.createElement('div');
	document.body.appendChild(target);
	footer = mount(Footer, { target });
	flushSync();
	return target;
}

function clickCheck(target: HTMLElement): void {
	const button = target.querySelector<HTMLButtonElement>('.update-slot button');
	expect(button).not.toBeNull();
	button!.click();
	flushSync();
}

afterEach(() => {
	if (footer) unmount(footer);
	footer = undefined;
	electron.appUpdate = undefined;
	document.body.innerHTML = '';
	show.mockReset();
	checkForAppUpdate.mockReset();
});

describe('Footer update check', () => {
	it('says a copy built from source does not check', () => {
		const target = render();
		clickCheck(target);
		expect(checkForAppUpdate).toHaveBeenCalledOnce();

		electron.appUpdate = { state: AppUpdateState.UpdateNotAvailable, localBuild: true };
		flushSync();
		expect(show).toHaveBeenCalledWith('APP.WOWUP_UPDATE.LOCAL_BUILD_NO_UPDATES');
	});

	it('says the latest version is installed when nothing newer exists', () => {
		const target = render();
		clickCheck(target);
		electron.appUpdate = { state: AppUpdateState.CheckingForUpdate };
		flushSync();
		expect(show).not.toHaveBeenCalled();

		electron.appUpdate = { state: AppUpdateState.UpdateNotAvailable };
		flushSync();
		expect(show).toHaveBeenCalledWith('APP.WOWUP_UPDATE.NOT_AVAILABLE');
	});

	it('stays quiet for the background checks', () => {
		render();
		electron.appUpdate = { state: AppUpdateState.UpdateNotAvailable };
		flushSync();
		expect(show).not.toHaveBeenCalled();
	});
});
