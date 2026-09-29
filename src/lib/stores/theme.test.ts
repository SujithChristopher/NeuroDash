import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { theme, setTheme, toggleTheme, densityFor } from './theme';

function fakeStorage() {
	let data: Record<string, string> = {};
	return {
		getItem: (k: string) => (k in data ? data[k] : null),
		setItem: (k: string, v: string) => {
			data[k] = v;
		},
		removeItem: (k: string) => {
			delete data[k];
		}
	};
}

beforeEach(() => {
	vi.stubGlobal('localStorage', fakeStorage());
	setTheme('light');
});

describe('theme', () => {
	it('defaults to light', () => {
		expect(get(theme)).toBe('light');
	});

	it('setTheme updates the store and persists', () => {
		setTheme('dark');
		expect(get(theme)).toBe('dark');
		expect(localStorage.getItem('nd.theme')).toBe('dark');
	});

	it('toggleTheme flips light/dark', () => {
		setTheme('light');
		toggleTheme();
		expect(get(theme)).toBe('dark');
		toggleTheme();
		expect(get(theme)).toBe('light');
	});
});

describe('densityFor', () => {
	it('returns the role-mapped density', () => {
		expect(densityFor('therapist')).toBe('low');
		expect(densityFor('engineer')).toBe('high');
	});
});
