// Replaces src/app/services/wowup/patch-notes.service.ts (750 LOC).
//
// That "service" was an @Injectable wrapping a 38-entry array of hardcoded HTML strings
// concatenated with assets/changelog.json. There is no behaviour to inject — it is data.
// Extracted to changelogs.json; the Angular tree's assets/changelog.json is still the
// shared source for the older entries.

import inlineChangeLogs from './changelogs.json';
import changeLogJson from '../../../../src/assets/changelog.json';

export interface ChangeLog {
	Version: string;
	Description?: string;
	changes?: string[];
	html?: string;
}

export const changeLogs: ChangeLog[] = [
	...(inlineChangeLogs as ChangeLog[]),
	...(changeLogJson.ChangeLogs as ChangeLog[])
];
