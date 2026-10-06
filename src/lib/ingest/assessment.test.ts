import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAssessmentPackage, parseLocked, type AssessmentFile, type ParsedAssessment } from './assessment';

// Real files from a PLUTO and a MARS assessment (the raw trial files are left out: they are 20 MB).
const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tests/fixtures/assessment');

function load(dir: string, prefix = ''): AssessmentFile[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? load(path.join(dir, e.name), `${prefix}${e.name}/`) : [{ path: prefix + e.name, text: fs.readFileSync(path.join(dir, e.name), 'utf8') }]));
}
const locked = { path: 'A0.locked', text: fs.readFileSync(path.join(FIX, 'A0.locked'), 'utf8') };
const ok = (r: ParsedAssessment | { error: string }) => {
	if ('error' in r) throw new Error(r.error);
	return r;
};

describe('a PLUTO assessment', () => {
	const a = ok(parseAssessmentPackage([...load(path.join(FIX, 'pluto')), locked]));
	const res = (m: string, t: string) => a.results.find((r) => r.mechanism === m && r.task === t)!;

	it('knows the device, limb and timepoint', () => {
		expect(a).toMatchObject({ device: 'PLUTO', limb: 'right', timepoint: 'A0' });
		expect(a.lockedAt?.toISOString()).toBe('2026-07-07T12:30:55.000Z');
	});
	it('starts at the first task that was done', () => {
		expect(a.assessedAt?.toISOString()).toBe('2026-09-17T14:17:49.000Z'); // WURD AROM was the first
	});
	it('lists the mechanisms and which of them the patient can use, actively or only passively', () => {
		expect(a.mechanisms).toEqual([
			{ code: 'FPS', status: 'Complete', ability: 'Active' },
			{ code: 'WFE', status: 'Partially Complete', ability: 'Passive' }, // AROM rejected twice then skipped
			{ code: 'WURD', status: 'Partially Complete', ability: 'Active' },
			{ code: 'HOC', status: 'Partially Complete', ability: 'Passive' }
		]);
	});
	it('takes the accepted attempt: the last Complete one, with its range in degrees', () => {
		const arom = res('FPS', 'AROM');
		expect(arom).toMatchObject({ status: 'Complete', unit: 'deg', attempts: 3 }); // two rejected attempts came first
		expect(arom.romMin).toBeCloseTo(-88.06, 2);
		expect(arom.romMax).toBeCloseTo(-19.18, 2);
		expect(arom.romRange).toBeCloseTo(68.88, 2);
		expect(res('FPS', 'PROM').romRange).toBeCloseTo(99.83, 2);
		expect(res('FPS', 'APROM').romRange).toBeCloseTo(156.78, 2);
	});
	it('adds what the summary files hold', () => {
		expect(res('FPS', 'AROM').extra).toMatchObject({ cycles: 5 });
		expect(res('FPS', 'APROM').extra).toMatchObject({ durationSec: 3, assist: 'Assisted' });
		expect(res('FPS', 'PROM').extra).toMatchObject({ startPosition: expect.any(Number) });
	});
	it('keeps skipped and excluded tasks with their reason and no range', () => {
		expect(res('WFE', 'AROM')).toMatchObject({ status: 'Skipped', romRange: null, unit: null });
		expect(res('WFE', 'AROM').comment).toMatch(/not completed within 60s/);
		expect(res('WFE', 'DISC').status).toBe('Excluded');
		expect(res('WURD', 'DISC')).toMatchObject({ status: 'Skipped', comment: 'AROM 8.23deg below 10.0deg threshold' });
	});
	it('keeps a discrete-reach task that was done, without a range', () => {
		expect(res('FPS', 'DISC')).toMatchObject({ status: 'Complete', romRange: null });
	});
});

describe('a MARS assessment', () => {
	const a = ok(parseAssessmentPackage([...load(path.join(FIX, 'mars')), locked]));
	const res = (m: string) => a.results.find((r) => r.mechanism === m)!;

	it('knows the device, timepoint and time', () => {
		expect(a).toMatchObject({ device: 'MARS', timepoint: 'A0' });
		expect(a.assessedAt?.toISOString()).toBe('2026-07-07T12:21:09.000Z');
	});
	it('gives the reach range of each movement in centimetres, the best trial over every session', () => {
		expect(res('ML')).toMatchObject({ task: 'ROM', unit: 'cm', status: 'Complete' });
		expect(res('ML').romRange).toBeCloseTo(46.6, 1); // the device's MAXIMUM of the better session
		expect(res('AP').romRange).toBeCloseTo(res('AP').extra!.apCm as number, 5); // the AP movement's headline is its forward range
		expect(res('ML').extra).toMatchObject({ avgMlCm: expect.any(Number) });
		expect(res('MLAP').extra).toMatchObject({ mlCm: expect.any(Number), apCm: expect.any(Number) });
		expect(res('ML').attempts).toBe(6); // three trials in each of two sessions: the AVERAGE and MAXIMUM rows are not trials
		expect((res('ML').extra as { sessions: number }).sessions).toBe(2);
	});
	it('lists the movements as passive: the device moves the arm', () => {
		expect(a.mechanisms.filter((m) => ['ML', 'AP', 'MLAP'].includes(m.code)).every((m) => m.ability === 'Passive')).toBe(true);
	});
	it('reports which targets of arm weight and discrete reaching were completed', () => {
		expect(res('ARMWEIGHT')).toMatchObject({ task: 'CHECK', status: 'Complete', comment: '5 of 5 targets completed' });
		expect(res('DISCRETE')).toMatchObject({ status: 'Complete', comment: '4 of 4 targets completed' });
	});
});

describe('bad packages', () => {
	it('says what is missing', () => {
		expect(parseAssessmentPackage([{ path: 'notes.txt', text: 'x' }])).toHaveProperty('error');
		expect(parseAssessmentPackage([{ path: 'x_details.json', text: '{not json' }])).toHaveProperty('error');
		expect(parseAssessmentPackage([{ path: 'x_details.json', text: '{"subj":"a"}' }])).toHaveProperty('error'); // no results
	});
	it('reads the lock time', () => {
		expect(parseLocked('Locked on 2026-07-07 12:30:55')?.toISOString()).toBe('2026-07-07T12:30:55.000Z');
		expect(parseLocked('nothing')).toBeNull();
	});
});
