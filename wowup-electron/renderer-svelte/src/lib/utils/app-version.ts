// How the app's version is shown in the footer and on the About page.
//
// CI builds carry their run number as semver build metadata (2.25.4+26), shown as "#26".
// Local builds have no number, so the commit they were built from tells them apart.

export interface VersionLabel {
	/** e.g. "2.25.4 #26", or "2.25.4 5616b593" for a local build. */
	text: string;
	/** The commit of a local build, for its tooltip; empty for CI builds. */
	localCommit: string;
}

export function versionLabel(version: string, commit = ''): VersionLabel {
	const [base, build] = version.split('+');
	if (build) return { text: `${base} #${build}`, localCommit: '' };
	return { text: commit ? `${base} ${commit}` : base, localCommit: commit };
}
