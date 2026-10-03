import { describe, expect, it } from 'vitest';
import { computePresence, presenceSignature } from './presence';

const local = (ms: number, now = Date.now()) => new Date(now - ms - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

describe('computePresence', () => {
	const now = Date.now();
	const raw = {
		'118': { device: 'MARS01', last_upload: local(20_000, now), ip: '10.0.0.5' },
		testr: { device: 'PLUTO01', last_upload: local(10 * 60_000, now) },
		'113': { device: 'MARS01', last_upload: local(299_000, now) },
		'114': { device: 'MARS01', last_upload: local(301_000, now) }
	};

	it('is active within the window and inactive after it', () => {
		const by = Object.fromEntries(computePresence(raw, now, 300).map((e) => [e.code, e]));
		expect(by['118']).toMatchObject({ device: 'MARS01', active: true });
		expect(by['118'].secondsAgo).toBeGreaterThanOrEqual(19);
		expect(by['118'].secondsAgo).toBeLessThanOrEqual(21);
		expect(by.testr.active).toBe(false);
		expect(by['113'].active).toBe(true); // just inside 5 minutes
		expect(by['114'].active).toBe(false); // just outside
	});

	it('respects a custom window', () => {
		const by = Object.fromEntries(computePresence(raw, now, 60).map((e) => [e.code, e.active]));
		expect(by).toMatchObject({ '118': true, '113': false });
	});

	it('ignores malformed entries and non-objects', () => {
		expect(computePresence(null)).toEqual([]);
		expect(computePresence([])).toEqual([]);
		expect(computePresence('x')).toEqual([]);
		const bad = { a: null, b: { device: 'X' }, c: { last_upload: 'nope', device: 'X' }, d: { last_upload: local(1000), device: 5 } };
		expect(computePresence(bad)).toEqual([]);
	});

	it('never reports a negative age (laptop clock slightly ahead)', () => {
		const future = { a: { device: 'MARS01', last_upload: local(-30_000, now) } };
		expect(computePresence(future, now)[0].secondsAgo).toBe(0);
	});
});

describe('presenceSignature', () => {
	const e = (code: string, device: string, active: boolean) => ({ code, device, client: null, lastUpload: '', secondsAgo: 0, active });
	it('lists only active patients, sorted, and ignores timing', () => {
		expect(presenceSignature([e('b', 'MARS01', true), e('a', 'PLUTO01', true), e('c', 'X', false)])).toBe('a@PLUTO01,b@MARS01');
		expect(presenceSignature([])).toBe('');
	});
});
