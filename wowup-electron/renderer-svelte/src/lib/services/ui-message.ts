// Port of src/app/services/ui-message/ui-message.service.ts (25 LOC).
//
// A genuine event bus — occurrences, not state — so it keeps a subscribe API rather than
// becoming a rune. Kept deliberately as the counter-example to "port every Subject to $state".

export type UiMessageAction = 'ad-frame-reload';

export interface UiMessage<T = unknown> {
	action: UiMessageAction;
	data?: T;
}

const listeners = new Set<(m: UiMessage) => void>();

export function onUiMessage(fn: (m: UiMessage) => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export function sendMessage<T>(action: UiMessageAction, data?: T): void {
	for (const fn of listeners) fn({ action, data });
}
