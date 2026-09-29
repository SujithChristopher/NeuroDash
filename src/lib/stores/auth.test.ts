import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { currentUser, login, logout, restoreSession } from './auth';

function fakeStorage() {
	let data: Record<string, string> = {};
	return {
		getItem: (k: string) => (k in data ? data[k] : null),
		setItem: (k: string, v: string) => {
			data[k] = v;
		},
		removeItem: (k: string) => {
			delete data[k];
		},
		clear: () => {
			data = {};
		}
	};
}

beforeEach(() => {
	vi.stubGlobal('localStorage', fakeStorage());
	vi.stubGlobal('sessionStorage', fakeStorage());
	logout();
});

describe('login', () => {
	it('succeeds with a valid login id and the demo password', () => {
		const r = login('priya.nair', 'neuro@123', false);
		expect(r.ok).toBe(true);
		expect(get(currentUser)?.id).toBe('U-T1');
	});

	it('succeeds with email instead of login id', () => {
		const r = login('priya.nair@neurorehab.org', 'neuro@123', false);
		expect(r.ok).toBe(true);
	});

	it('fails with wrong password without throwing, leaves currentUser null', () => {
		const r = login('priya.nair', 'wrong', false);
		expect(r.ok).toBe(false);
		expect(get(currentUser)).toBeNull();
	});

	it('fails with unknown user id without throwing', () => {
		const r = login('nobody.here', 'neuro@123', false);
		expect(r.ok).toBe(false);
	});

	it('persists to localStorage when remember is true, sessionStorage otherwise', () => {
		login('priya.nair', 'neuro@123', true);
		expect(localStorage.getItem('nd.user')).toBe('U-T1');
		logout();
		login('priya.nair', 'neuro@123', false);
		expect(sessionStorage.getItem('nd.user')).toBe('U-T1');
	});
});

describe('restoreSession', () => {
	it('restores a valid persisted user', () => {
		login('priya.nair', 'neuro@123', true);
		currentUser.set(null);
		restoreSession();
		expect(get(currentUser)?.id).toBe('U-T1');
	});

	it('does not throw and leaves currentUser null for a stale/unknown persisted id', () => {
		localStorage.setItem('nd.user', 'U-DOES-NOT-EXIST');
		expect(() => restoreSession()).not.toThrow();
		expect(get(currentUser)).toBeNull();
	});

	it('is a no-op when nothing is persisted', () => {
		expect(() => restoreSession()).not.toThrow();
		expect(get(currentUser)).toBeNull();
	});
});

describe('logout', () => {
	it('clears currentUser and persisted storage', () => {
		login('priya.nair', 'neuro@123', true);
		logout();
		expect(get(currentUser)).toBeNull();
		expect(localStorage.getItem('nd.user')).toBeNull();
		expect(sessionStorage.getItem('nd.user')).toBeNull();
	});
});
