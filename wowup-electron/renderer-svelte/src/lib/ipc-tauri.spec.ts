// Guards the three ways the Tauri backend can differ from Electron's IPC without failing.
//
// Each of these was a real hazard found while writing the backend, and each fails silently
// rather than throwing: a mis-named argument arrives as undefined, an unmigrated channel
// resolves to nothing, and a platform-name mismatch makes isMac()/isWin() both false.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const listenMock = vi.fn();
const platformMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: (...a: unknown[]) => listenMock(...a) }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => platformMock() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(), openPath: vi.fn() }));

import {
	IPC_WARCRAFT_GET_BLIZZARD_AGENT_PATH,
	IPC_WARCRAFT_GET_EXECUTABLE_NAME,
	IPC_WARCRAFT_GET_INSTALLED_PRODUCTS,
	IPC_UNZIP_FILE_CHANNEL
} from '$common/constants';
import { invoke, on, platform, sendSync, UnmigratedChannelError } from './ipc-tauri';

beforeEach(() => {
	invokeMock.mockReset().mockResolvedValue(undefined);
	listenMock.mockReset().mockResolvedValue(() => {});
	platformMock.mockReset();
});

describe('argument mapping', () => {
	it('converts the channel to a snake_case command', async () => {
		await invoke(IPC_WARCRAFT_GET_BLIZZARD_AGENT_PATH);
		expect(invokeMock).toHaveBeenCalledWith('warcraft_get_blizzard_agent_path', {});
	});

	it('names positional arguments per the channel table', async () => {
		await invoke(IPC_WARCRAFT_GET_INSTALLED_PRODUCTS, '/tmp/product.db');
		expect(invokeMock).toHaveBeenCalledWith('warcraft_get_installed_products', {
			agentPath: '/tmp/product.db'
		});
	});

	it('passes a numeric enum argument through unchanged', async () => {
		// WowClientType crosses as a bare number; boxing it would break the Rust deserialiser.
		await invoke(IPC_WARCRAFT_GET_EXECUTABLE_NAME, 6);
		expect(invokeMock).toHaveBeenCalledWith('warcraft_get_executable_name', { clientType: 6 });
	});

	it('rejects more arguments than the command declares', async () => {
		// Extra positionals would otherwise be dropped in silence.
		await expect(invoke(IPC_WARCRAFT_GET_INSTALLED_PRODUCTS, 'a', 'b')).rejects.toThrow(
			/takes 1 argument/
		);
	});
});

describe('unmigrated channels', () => {
	it('throws rather than resolving to undefined', async () => {
		// A real channel with no Rust command yet — unzip is Phase 2 (Group B). If this ever
		// starts failing because unzip landed, repoint it at another pending channel rather
		// than deleting the test: it guards the fail-loud behaviour, not this one channel.
		await expect(invoke(IPC_UNZIP_FILE_CHANNEL, {})).rejects.toBeInstanceOf(UnmigratedChannelError);
		expect(invokeMock).not.toHaveBeenCalled();
	});

	it('names the channel so the failure is actionable', async () => {
		await expect(invoke('some-unported-channel')).rejects.toThrow(/some-unported-channel/);
	});
});

describe('platform naming', () => {
	it.each([
		['macos', 'darwin'],
		['windows', 'win32'],
		['linux', 'linux']
	])('maps Tauri %s to Node %s', (tauriName, nodeName) => {
		platformMock.mockReturnValue(tauriName);
		expect(platform()).toBe(nodeName);
	});
});

describe('event shim', () => {
	it('restores the Electron (event, ...args) call shape', async () => {
		let emit: ((e: { payload: unknown }) => void) | undefined;
		listenMock.mockImplementation((_ch: string, handler: (e: { payload: unknown }) => void) => {
			emit = handler;
			return Promise.resolve(() => {});
		});

		const seen: unknown[][] = [];
		on('window-maximized', (...args) => seen.push(args));
		await vi.waitFor(() => expect(emit).toBeDefined());

		// A scalar payload is one argument after the event object.
		emit!({ payload: 'hello' });
		expect(seen[0]).toEqual([{}, 'hello']);

		// An array payload spreads, matching a multi-value Electron send.
		emit!({ payload: [1, 2] });
		expect(seen[1]).toEqual([{}, 1, 2]);

		// No payload means no trailing arguments at all.
		emit!({ payload: undefined });
		expect(seen[2]).toEqual([{}]);
	});

	it('unsubscribes even when cancelled before listen resolves', async () => {
		const unlisten = vi.fn();
		let resolveListen: ((fn: () => void) => void) | undefined;
		listenMock.mockReturnValue(
			new Promise<() => void>((res) => {
				resolveListen = res;
			})
		);

		// `on` is synchronous but `listen` is not, so an $effect that tears down in the same
		// tick would otherwise leak a listener for the life of the process.
		const off = on('window-maximized', () => {});
		off();
		resolveListen!(unlisten);

		await vi.waitFor(() => expect(unlisten).toHaveBeenCalled());
	});
});

describe('synchronous IPC', () => {
	it('throws, because Tauri has no equivalent', () => {
		expect(() => sendSync('store-get-object-sync')).toThrow(/not available under Tauri/);
	});
});
