// Port of src/app/services/addons/addon-fingerprint.service.ts (38 LOC).
//
// The heavy lifting already happens in the main process (app/curse-folder-scanner.ts,
// app/wowup-folder-scanner.ts, plus the native/curse.cc N-API addon). This is only the
// call and the result stitching.

import { IPC_CURSE_GET_SCAN_RESULTS, IPC_WOWUP_GET_SCAN_RESULTS } from '$common/constants';
import { AppConfig } from '$config/environment';
import { invoke } from '$lib/ipc';
import type { AddonFolder, AddonScanResult } from 'wowup-lib-core';

export async function getFingerprints(addonFolders: AddonFolder[]): Promise<void> {
	const filePaths = addonFolders.map((addonFolder) => addonFolder.path);

	console.time('WowUpScan');
	const wowUpScanResults = await invoke<AddonScanResult[]>(IPC_WOWUP_GET_SCAN_RESULTS, filePaths);
	console.timeEnd('WowUpScan');

	let cfScanResults: AddonScanResult[] = [];
	if (AppConfig.curseforge.enabled) {
		console.time('CFScan');
		cfScanResults = await invoke<AddonScanResult[]>(IPC_CURSE_GET_SCAN_RESULTS, filePaths);
		console.timeEnd('CFScan');
	}

	for (const af of addonFolders) {
		af.wowUpScanResults = wowUpScanResults.find((wur) => wur.path === af.path);
		if (AppConfig.curseforge.enabled) {
			af.cfScanResults = cfScanResults.find((cfr) => cfr.path === af.path);
		}
	}
}
