import { writable } from 'svelte/store';
import { DENSITY, type Role } from '$lib/data/users';

export type Theme = 'light' | 'dark';

function readPersisted(): Theme {
	try {
		const t = localStorage.getItem('nd.theme');
		return t === 'dark' || t === 'light' ? t : 'light';
	} catch {
		return 'light';
	}
}

export const theme = writable<Theme>(readPersisted());

export function setTheme(t: Theme) {
	theme.set(t);
	try {
		localStorage.setItem('nd.theme', t);
	} catch {
		/* noop */
	}
}

export function toggleTheme() {
	theme.update((t) => {
		const next = t === 'dark' ? 'light' : 'dark';
		try {
			localStorage.setItem('nd.theme', next);
		} catch {
			/* noop */
		}
		return next;
	});
}

export const densityFor = (role: Role) => DENSITY[role];
