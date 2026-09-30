import type { Handle } from '@sveltejs/kit';
import { getSession } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	const session = await getSession(event.cookies.get('session'));

	if (session && session.purpose === 'access') {
		const u = session.user;
		event.locals.user = {
			id: u.id,
			displayCode: u.displayCode,
			name: u.name,
			role: u.role,
			title: u.title,
			email: u.email,
			initials: u.initials,
			locationId: u.locationId,
			location: u.location ? { id: u.location.id, name: u.location.name } : null
		};
	} else {
		event.locals.user = null;
	}

	return resolve(event);
};
