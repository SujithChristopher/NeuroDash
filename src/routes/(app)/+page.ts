import { redirect } from '@sveltejs/kit';
import { get } from 'svelte/store';
import { currentUser } from '$lib/stores/auth';
import { HOME } from '$lib/data/users';

export const ssr = false;

export function load() {
	const user = get(currentUser)!; // guaranteed by the parent layout guard
	throw redirect(307, '/' + HOME[user.role]);
}
