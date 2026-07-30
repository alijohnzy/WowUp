// Port of src/app/services/push/push.service.ts (43 LOC).
//
// Push notifications are occurrences, so this keeps a listener API rather than becoming
// $state — the same judgement applied in ui-message.ts and electron.svelte.ts.

import { IPC_PUSH_NOTIFICATION } from '$common/constants';
import type { AddonUpdatePushNotification, PushNotification } from '$common/wowup/models';
import { isElectron, on } from '$lib/ipc';

type AddonUpdateListener = (updates: AddonUpdatePushNotification[]) => void;

// A listener registry, not state: only ever iterated from the IPC handler to call each
// subscriber, never read in a reactive context, so SvelteSet would add proxying for
// nothing. The rule keys off the .svelte.ts extension, which this file has for the runes
// further down.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const addonUpdateListeners = new Set<AddonUpdateListener>();

export function onAddonUpdatePush(fn: AddonUpdateListener): () => void {
	addonUpdateListeners.add(fn);
	return () => addonUpdateListeners.delete(fn);
}

function parseAddonUpdateNotification(note: PushNotification<AddonUpdatePushNotification[]>): void {
	// The main process forwards the raw payload; the message may still be a JSON string.
	const message =
		typeof note.message === 'string'
			? (JSON.parse(note.message) as AddonUpdatePushNotification[])
			: note.message;

	console.debug('parseAddonUpdateNotification', note);
	for (const fn of addonUpdateListeners) fn(message);
}

let started = false;

export function startPushService(): void {
	if (started || !isElectron()) return;
	started = true;

	on(IPC_PUSH_NOTIFICATION, (_evt, data: never) => {
		try {
			// PushNotification<T> constrains T to PushNotificationData | string, and the wire
			// payload can be either — hence the widening hop through unknown.
			const notification = data as PushNotification<string>;
			switch (notification.action) {
				case 'addon-update':
					parseAddonUpdateNotification(
						notification as unknown as PushNotification<AddonUpdatePushNotification[]>
					);
					break;
				default:
					console.warn('Unhandled push notification', notification.action);
			}
		} catch (e) {
			console.error('Failed to handle push notification', e);
		}
	});
}
