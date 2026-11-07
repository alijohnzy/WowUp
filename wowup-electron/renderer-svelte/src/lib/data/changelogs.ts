// Replaces src/app/services/wowup/patch-notes.service.ts (750 LOC).
//
// That "service" was an @Injectable wrapping a 38-entry array of hardcoded HTML strings
// concatenated with assets/changelog.json. There is no behaviour to inject — it is data.
// Extracted to changelogs.json; the Angular tree's assets/changelog.json is still the
// shared source for the older entries.
//
// Two kinds of entry, newest first: WowUpNight's own builds ("2.25.4 #28", Night: true), and
// upstream WowUp releases as WowUp wrote them (src/app/services/wowup/patch-notes.service.ts).
//
// Notes for the build not yet released go under "2.25.4 #next": CI's version stamp replaces
// #next with the run number (.github/workflows/tauri-build.yml), which is not known before.

import inlineChangeLogs from './changelogs.json';
import changeLogJson from '../../../../src/assets/changelog.json';

export interface ChangeLog {
	/** A WowUp version, or for this fork's own builds the version and build: "2.25.4 #28". */
	Version: string;
	/** A WowUpNight build rather than an upstream WowUp release. */
	Night?: boolean;
	Description?: string;
	changes?: string[];
	html?: string;
}

export const changeLogs: ChangeLog[] = [
	...(inlineChangeLogs as ChangeLog[]),
	...(changeLogJson.ChangeLogs as ChangeLog[])
];
