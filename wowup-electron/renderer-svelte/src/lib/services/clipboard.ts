// Replaces @angular/cdk/clipboard's [cdkCopyToClipboard] directive and
// ElectronService.readClipboardText().
//
// Reads go through the main process, as they did in Angular: navigator.clipboard.readText()
// needs a secure context plus an explicit permission grant, and the renderer is loaded from
// file://. Writes do not have that restriction, so they stay in the renderer — which is
// also what the CDK directive did.

import { invoke } from '$lib/ipc';

const IPC_CLIPBOARD_READ_TEXT = 'clipboard-read-text';

export async function writeText(text: string): Promise<void> {
	await navigator.clipboard.writeText(text);
}

export function readText(): Promise<string> {
	return invoke<string>(IPC_CLIPBOARD_READ_TEXT);
}
