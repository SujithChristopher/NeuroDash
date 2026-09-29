import { describe, it, expect, beforeEach } from 'vitest';
import { resetSeed, RNG, rand, randInt, pick, clamp, gauss, round1, addDays, dayKey, startOfDay, fmtD, esc, uid } from './seed';

describe('RNG', () => {
	beforeEach(() => resetSeed(20260918));

	it('is deterministic for a given seed', () => {
		const a = [RNG(), RNG(), RNG()];
		resetSeed(20260918);
		const b = [RNG(), RNG(), RNG()];
		expect(a).toEqual(b);
	});

	it('rand stays within bounds', () => {
		for (let i = 0; i < 50; i++) {
			const v = rand(2, 5);
			expect(v).toBeGreaterThanOrEqual(2);
			expect(v).toBeLessThanOrEqual(5);
		}
	});

	it('randInt stays within inclusive bounds', () => {
		for (let i = 0; i < 50; i++) {
			const v = randInt(1, 3);
			expect([1, 2, 3]).toContain(v);
		}
	});

	it('pick returns an element from the array', () => {
		const arr = ['a', 'b', 'c'];
		expect(arr).toContain(pick(arr));
	});

	it('clamp bounds a value', () => {
		expect(clamp(10, 0, 5)).toBe(5);
		expect(clamp(-10, 0, 5)).toBe(0);
		expect(clamp(3, 0, 5)).toBe(3);
	});

	it('gauss returns a finite number', () => {
		expect(Number.isFinite(gauss())).toBe(true);
	});

	it('round1 rounds to one decimal', () => {
		expect(round1(1.2345)).toBe(1.2);
	});
});

describe('date helpers', () => {
	it('addDays advances by whole days', () => {
		const d = new Date(2026, 0, 1);
		expect(dayKey(addDays(d, 5))).toBe('2026-01-06');
	});

	it('startOfDay zeroes the time', () => {
		const d = new Date(2026, 0, 1, 13, 45);
		const s = startOfDay(d);
		expect(s.getHours()).toBe(0);
		expect(s.getMinutes()).toBe(0);
	});

	it('fmtD formats as "D Mon"', () => {
		expect(fmtD(new Date(2026, 8, 29))).toBe('29 Sep');
	});
});

describe('esc', () => {
	it('escapes html-significant characters', () => {
		expect(esc('<b>&"\'</b>')).toBe('&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
	});

	it('handles null/undefined as empty string', () => {
		expect(esc(null)).toBe('');
		expect(esc(undefined)).toBe('');
	});
});

describe('uid', () => {
	it('produces unique, prefixed ids', () => {
		const a = uid('AS'),
			b = uid('AS');
		expect(a).not.toBe(b);
		expect(a.startsWith('AS-')).toBe(true);
	});
});
