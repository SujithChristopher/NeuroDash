import type { Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const SESSION_COOKIE = 'session';

export function setSessionCookie(cookies: Cookies, id: string, expiresAt: Date) {
	cookies.set(SESSION_COOKIE, id, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		// `secure` is left to SvelteKit's default: on everywhere except plain http://localhost, so sign-in only works over HTTPS
		// (or on localhost). ALLOW_HTTP_COOKIES=1 turns it off for a trusted clinic network where the dashboard is opened by
		// IP address over plain http (e.g. http://192.168.1.20:5173). Do not set it on anything reachable from the internet.
		...(env.ALLOW_HTTP_COOKIES === '1' ? { secure: false } : {}),
		expires: expiresAt
	});
}

export function clearSessionCookie(cookies: Cookies) {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
