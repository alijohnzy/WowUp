// Port of src/app/services/download/download.service.ts (64 LOC).
// uuid -> crypto.randomUUID(); ElectronService.on/off/send -> $lib/ipc.

import { IPC_DOWNLOAD_FILE_CHANNEL } from '$common/constants';
import type { DownloadStatus } from '$common/models/download-status';
import { DownloadStatusType } from '$common/models/download-status-type';
import { on, send } from '$lib/ipc';
import type { DownloadAuth } from 'wowup-lib-core';

export interface DownloadOptions {
	auth?: DownloadAuth;
	fileName: string;
	outputFolder: string;
	url: string;
	onProgress?: (progress: number) => void;
}

/**
 * Download a URL into a folder, prefixed with a UUID so concurrent downloads cannot collide.
 * Resolves with the saved file path.
 */
export function downloadZipFile(options: DownloadOptions): Promise<string> {
	return new Promise((resolve, reject) => {
		const responseKey = crypto.randomUUID();

		// `on` returns its own unsubscribe, so the manual off() bookkeeping the Angular
		// version did with a named handler goes away.
		const off = on(responseKey, (_evt, arg: never) => {
			const status = arg as DownloadStatus;
			if (status.type !== DownloadStatusType.Progress) off();

			switch (status.type) {
				case DownloadStatusType.Complete:
					resolve(status.savePath ?? '');
					break;
				case DownloadStatusType.Error:
					reject(status.error);
					break;
				case DownloadStatusType.Progress:
					options.onProgress?.(status.progress ?? 0);
					break;
				default:
					break;
			}
		});

		send(IPC_DOWNLOAD_FILE_CHANNEL, {
			auth: options.auth,
			fileName: options.fileName,
			outputFolder: options.outputFolder,
			responseKey,
			url: options.url
		});
	});
}
