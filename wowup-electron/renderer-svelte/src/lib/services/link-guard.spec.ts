// @vitest-environment jsdom
//
// The failure this exists to stop: a link in an addon description navigated the app window to
// icy-veins.com, and with the titlebar drawn by the app there was no back button to return.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const confirmLinkNavigation = vi.fn();
vi.mock('$lib/services/links', () => ({
	confirmLinkNavigation: (href: string) => confirmLinkNavigation(href)
}));

import { guardExternalLinks } from './link-guard';

let stop: () => void;

beforeEach(() => {
	confirmLinkNavigation.mockReset();
	document.body.innerHTML = '';
	stop?.();
	stop = guardExternalLinks();
});

/** Returns the click event so callers can check whether navigation was cancelled. */
function clickLink(html: string): MouseEvent {
	document.body.innerHTML = html;
	const anchor = document.querySelector('a') as HTMLAnchorElement;
	const event = new MouseEvent('click', { bubbles: true, cancelable: true });
	anchor.dispatchEvent(event);
	return event;
}

describe('links in injected HTML', () => {
	it('sends an external link to the browser instead of the app window', () => {
		const event = clickLink('<a href="https://www.icy-veins.com/wow/">guide</a>');

		expect(event.defaultPrevented).toBe(true);
		expect(confirmLinkNavigation).toHaveBeenCalledWith('https://www.icy-veins.com/wow/');
	});

	it('handles a nested target, since the click lands on the child', () => {
		const event = clickLink('<a href="https://wago.io"><img alt="" /><span>go</span></a>');

		expect(event.defaultPrevented).toBe(true);
		expect(confirmLinkNavigation).toHaveBeenCalledWith('https://wago.io/');
	});

	it('opens a mailto link rather than swallowing it', () => {
		clickLink('<a href="mailto:a@b.com">mail</a>');
		expect(confirmLinkNavigation).toHaveBeenCalledWith('mailto:a@b.com');
	});
});

describe('what it must not touch', () => {
	// The nav rail is built from these; hijacking them would break every route in the app.
	it('leaves in-app routes to the router', () => {
		const event = clickLink('<a href="/my-addons">My Addons</a>');

		expect(event.defaultPrevented).toBe(false);
		expect(confirmLinkNavigation).not.toHaveBeenCalled();
	});

	it('leaves fragment links alone', () => {
		const event = clickLink('<a href="#section">jump</a>');

		expect(event.defaultPrevented).toBe(false);
		expect(confirmLinkNavigation).not.toHaveBeenCalled();
	});

	// An anchor carrying the externalLink attachment cancels the event itself; opening it here
	// as well would launch the browser twice on one click.
	it('stands aside when something already handled the click', () => {
		document.body.innerHTML = '<a href="https://wowup.io">site</a>';
		const anchor = document.querySelector('a') as HTMLAnchorElement;
		anchor.addEventListener('click', (e) => e.preventDefault());

		anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(confirmLinkNavigation).not.toHaveBeenCalled();
	});
});

describe('hostile hrefs', () => {
	// Descriptions are addon-authored HTML, so these are reachable by anyone who publishes one.
	it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<h1>x'])(
		'blocks %s without handing it on',
		(href) => {
			const event = clickLink(`<a href="${href}">click</a>`);

			expect(event.defaultPrevented).toBe(true);
			expect(confirmLinkNavigation).not.toHaveBeenCalled();
		}
	);
});
