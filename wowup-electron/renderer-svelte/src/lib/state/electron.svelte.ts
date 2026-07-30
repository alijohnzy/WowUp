// Replaces src/app/services/electron/electron.service.ts (367 LOC, 7 BehaviorSubjects).
//
// The original pushed every main-process event through a Subject that templates consumed
// with `| async`. Here they are plain reactive fields. Event streams that are genuinely
// streams (custom protocol URLs, power-monitor transitions) keep a listener API, because
// they carry occurrences rather than state — squashing those into $state would drop events.

import {
	IPC_APP_UPDATE_STATE,
	IPC_CUSTOM_PROTOCOL_RECEIVED,
	IPC_FOCUS_WINDOW,
	IPC_GET_APP_VERSION,
	IPC_GET_LOGIN_ITEM_SETTINGS,
	IPC_IS_DEFAULT_PROTOCOL_CLIENT,
	IPC_MAXIMIZE_WINDOW,
	IPC_MINIMIZE_WINDOW,
	IPC_POWER_MONITOR_LOCK,
	IPC_POWER_MONITOR_RESUME,
	IPC_POWER_MONITOR_SUSPEND,
	IPC_POWER_MONITOR_UNLOCK,
	IPC_QUIT_APP,
	IPC_REMOVE_AS_DEFAULT_PROTOCOL_CLIENT,
	IPC_SET_AS_DEFAULT_PROTOCOL_CLIENT,
	IPC_SET_LOGIN_ITEM_SETTINGS,
	IPC_SET_ZOOM_LIMITS,
	IPC_WINDOW_MAXIMIZED,
	IPC_WINDOW_MINIMIZED,
	IPC_WINDOW_RESUME,
	IPC_WINDOW_UNMAXIMIZED
} from '$common/constants';
import { invoke, isElectron, on } from '$lib/ipc';

export interface AppUpdateEvent {
	state: number;
	progress?: unknown;
	error?: string;
}

type Listener<T> = (value: T) => void;

/** Minimal multicast emitter — the part of RxJS that does not map to a rune. */
class Emitter<T> {
	#listeners = new Set<Listener<T>>();

	subscribe(fn: Listener<T>): () => void {
		this.#listeners.add(fn);
		return () => this.#listeners.delete(fn);
	}

	emit(value: T): void {
		for (const fn of this.#listeners) fn(value);
	}
}

class ElectronState {
	appVersion = $state('');
	windowMaximized = $state(false);
	windowMinimized = $state(false);
	windowFocused = $state(true);
	online = $state(true);
	appUpdate = $state<AppUpdateEvent | undefined>(undefined);

	/** Occurrences, not state — see note at top of file. */
	readonly customProtocol = new Emitter<string>();
	readonly powerMonitor = new Emitter<string>();
	readonly windowResumed = new Emitter<void>();

	#started = false;

	/** Called once from the root layout. Idempotent. */
	start(): void {
		if (this.#started || !isElectron()) return;
		this.#started = true;

		this.online = navigator.onLine;
		window.addEventListener('online', () => (this.online = true));
		window.addEventListener('offline', () => (this.online = false));

		on(IPC_APP_UPDATE_STATE, (_e, evt: never) => (this.appUpdate = evt as AppUpdateEvent));
		on(IPC_WINDOW_MINIMIZED, () => (this.windowMinimized = true));
		on(IPC_WINDOW_MAXIMIZED, () => (this.windowMaximized = true));
		on(IPC_WINDOW_UNMAXIMIZED, () => (this.windowMaximized = false));
		on(IPC_WINDOW_RESUME, () => this.windowResumed.emit());
		on('blur', () => (this.windowFocused = false));
		on('focus', () => (this.windowFocused = true));
		on(IPC_CUSTOM_PROTOCOL_RECEIVED, (_e, protocol: never) =>
			this.customProtocol.emit(protocol as string)
		);

		for (const ch of [
			IPC_POWER_MONITOR_LOCK,
			IPC_POWER_MONITOR_UNLOCK,
			IPC_POWER_MONITOR_SUSPEND,
			IPC_POWER_MONITOR_RESUME
		]) {
			on(ch, () => this.powerMonitor.emit(ch));
		}

		invoke<string>(IPC_GET_APP_VERSION)
			.then((v) => (this.appVersion = v))
			.catch((e: unknown) => console.error('Failed to get app version', e));

		invoke(IPC_SET_ZOOM_LIMITS, 1, 1).catch((e: unknown) =>
			console.error('Failed to set zoom limits', e)
		);
	}

	minimizeWindow = (): Promise<void> => invoke(IPC_MINIMIZE_WINDOW);
	maximizeWindow = (): Promise<void> => invoke(IPC_MAXIMIZE_WINDOW);
	focusWindow = (): Promise<void> => invoke(IPC_FOCUS_WINDOW);
	quitApplication = (): Promise<void> => invoke(IPC_QUIT_APP);

	showOpenDialog = <T>(options: unknown): Promise<T> => invoke('show-open-dialog', options);

	getLoginItemSettings = <T>(): Promise<T> => invoke(IPC_GET_LOGIN_ITEM_SETTINGS);
	setLoginItemSettings = (settings: unknown): Promise<void> =>
		invoke(IPC_SET_LOGIN_ITEM_SETTINGS, settings);

	isDefaultProtocolClient = (protocol: string): Promise<boolean> =>
		invoke(IPC_IS_DEFAULT_PROTOCOL_CLIENT, protocol);
	setAsDefaultProtocolClient = (protocol: string): Promise<boolean> =>
		invoke(IPC_SET_AS_DEFAULT_PROTOCOL_CLIENT, protocol);
	removeAsDefaultProtocolClient = (protocol: string): Promise<boolean> =>
		invoke(IPC_REMOVE_AS_DEFAULT_PROTOCOL_CLIENT, protocol);
}

export const electron = new ElectronState();
