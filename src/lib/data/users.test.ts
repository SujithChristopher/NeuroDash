import { describe, it, expect } from 'vitest';
import { USERS, DEMO_PASSWORD, userOf, usersByRole, ownerOfType, NAV, HOME, DENSITY } from './users';

describe('USERS', () => {
	it('has 10 seeded users across 4 roles', () => {
		expect(USERS).toHaveLength(10);
		const roles = new Set(USERS.map((u) => u.role));
		expect(roles).toEqual(new Set(['therapist', 'consultant', 'engineer', 'admin']));
	});

	it('derives login/email/status for every user', () => {
		for (const u of USERS) {
			expect(u.login).toMatch(/^[a-z.]+$/);
			expect(u.email.endsWith('@neurorehab.org')).toBe(true);
			expect(u.status).toBe('Active');
		}
	});

	it('userOf finds by id, undefined for unknown id', () => {
		expect(userOf('U-T1')?.name).toBe('Priya Nair');
		expect(userOf('U-NOPE')).toBeUndefined();
	});

	it('usersByRole filters correctly', () => {
		expect(usersByRole('engineer')).toHaveLength(3);
	});

	it('ownerOfType finds the engineer who owns a device type', () => {
		expect(ownerOfType('PLUTO')?.id).toBe('U-E1');
		expect(ownerOfType('NOPE')).toBeUndefined();
	});

	it('DEMO_PASSWORD is shared and non-empty', () => {
		expect(DEMO_PASSWORD.length).toBeGreaterThan(0);
	});
});

describe('NAV / HOME / DENSITY', () => {
	it('every role has a HOME page listed in its own NAV', () => {
		for (const role of Object.keys(HOME) as (keyof typeof HOME)[]) {
			const pages = NAV[role].filter((n): n is [string, string, string] => Array.isArray(n)).map((n) => n[0]);
			expect(pages).toContain(HOME[role]);
		}
	});

	it('every role has a density', () => {
		for (const role of Object.keys(HOME) as (keyof typeof HOME)[]) {
			expect(DENSITY[role]).toBeTruthy();
		}
	});
});
