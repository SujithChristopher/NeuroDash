import { redirect } from '@sveltejs/kit';
import { get } from 'svelte/store';
import { currentUser, restoreSession } from '$lib/stores/auth';
import { allowed } from '$lib/data/db';

export const ssr = false;

export function load({ url }: { url: URL }) {
	restoreSession();
	const user = get(currentUser);
	if (!user) throw redirect(307, '/login');
	const segments = url.pathname.split('/').filter(Boolean);
	const first = segments[0];
	const page = first === 'patients' && segments[1] ? 'patient' : first === 'fleet' && segments[1] ? 'device' : first;
	return { user, notAllowed: page ? !allowed(user, page) : false };
}
