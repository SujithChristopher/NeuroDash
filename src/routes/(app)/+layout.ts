import { redirect } from '@sveltejs/kit';
import { get } from 'svelte/store';
import { currentUser, restoreSession } from '$lib/stores/auth';

export const ssr = false;

export function load() {
	restoreSession();
	const user = get(currentUser);
	if (!user) throw redirect(307, '/login');
	return { user };
}
