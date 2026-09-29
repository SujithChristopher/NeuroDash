import { writable } from 'svelte/store';
import { USERS, userOf, DEMO_PASSWORD, type User } from '$lib/data/users';

export const currentUser = writable<User | null>(null);

function safeGet(k: string): string | null {
	try {
		return localStorage.getItem('nd.' + k) ?? sessionStorage.getItem('nd.' + k);
	} catch {
		return null;
	}
}
function safeSet(k: string, v: string, persist: boolean) {
	try {
		(persist ? localStorage : sessionStorage).setItem('nd.' + k, v);
	} catch {
		/* storage unavailable (private mode, SSR) — auth just won't persist */
	}
}
function safeClear(k: string) {
	try {
		localStorage.removeItem('nd.' + k);
		sessionStorage.removeItem('nd.' + k);
	} catch {
		/* noop */
	}
}

export function login(idOrEmail: string, password: string, remember: boolean): { ok: true } | { ok: false; message: string } {
	const id = idOrEmail.trim().toLowerCase();
	const u = USERS.find((x) => (x.login === id || x.email === id) && x.status === 'Active');
	if (!u || password !== DEMO_PASSWORD) {
		return { ok: false, message: 'Incorrect user ID or password.' };
	}
	currentUser.set(u);
	safeSet('user', u.id, remember);
	return { ok: true };
}

export function logout() {
	currentUser.set(null);
	safeClear('user');
}

export function restoreSession() {
	const id = safeGet('user');
	if (id && userOf(id)) currentUser.set(userOf(id)!);
}
