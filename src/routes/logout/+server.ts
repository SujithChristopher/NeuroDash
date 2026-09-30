import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { destroySession } from '$lib/server/auth';
import { clearSessionCookie, SESSION_COOKIE } from '$lib/server/session-cookie';

export const POST: RequestHandler = async ({ cookies }) => {
	const id = cookies.get(SESSION_COOKIE);
	if (id) await destroySession(id);
	clearSessionCookie(cookies);
	throw redirect(303, '/login');
};
