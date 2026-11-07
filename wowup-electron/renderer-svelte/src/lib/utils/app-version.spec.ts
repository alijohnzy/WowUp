import { describe, expect, it } from 'vitest';
import { versionLabel } from './app-version';

describe('versionLabel', () => {
	it('shows a CI build by its number', () => {
		expect(versionLabel('2.25.4+26', '5616b593')).toEqual({ text: '2.25.4 #26', localCommit: '' });
	});

	it('shows a local build by its commit', () => {
		expect(versionLabel('2.25.4', '5616b593')).toEqual({
			text: '2.25.4 5616b593',
			localCommit: '5616b593'
		});
	});

	it('shows the plain version when nothing else is known', () => {
		expect(versionLabel('2.25.4')).toEqual({ text: '2.25.4', localCommit: '' });
	});
});
