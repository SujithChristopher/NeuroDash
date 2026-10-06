import { describe, expect, it } from 'vitest';
import { changeSincePrevious, compareTimepoints, reachTrend, romTrend, usable, type RoboticAssessmentView } from './roboticAssessment';

const pluto = (timepoint: string, fps: [number, number] | null, over: Partial<RoboticAssessmentView> = {}): RoboticAssessmentView => ({
	id: timepoint,
	device: 'PLUTO',
	limb: 'right',
	timepoint,
	assessedAt: `2026-0${1 + Number(timepoint.slice(1))}-01T00:00:00.000Z`,
	lockedAt: null,
	mechanisms: [
		{ code: 'FPS', status: 'Complete', ability: 'Active' },
		{ code: 'WFE', status: 'Partially Complete', ability: 'Passive' },
		{ code: 'HOC', status: 'Skipped', ability: 'None' }
	],
	results: [
		{ mechanism: 'FPS', task: 'AROM', status: fps ? 'Complete' : 'Skipped', unit: 'deg', romMin: 0, romMax: fps?.[0] ?? null, romRange: fps?.[0] ?? null, attempts: 1, comment: null, extra: null },
		{ mechanism: 'FPS', task: 'PROM', status: fps ? 'Complete' : 'Skipped', unit: 'deg', romMin: 0, romMax: fps?.[1] ?? null, romRange: fps?.[1] ?? null, attempts: 1, comment: null, extra: null }
	],
	...over
});
const mars = (timepoint: string, ml: number, ap: number): RoboticAssessmentView => ({
	id: 'm' + timepoint,
	device: 'MARS',
	limb: 'right',
	timepoint,
	assessedAt: '2026-01-01T00:00:00.000Z',
	lockedAt: null,
	mechanisms: [{ code: 'ML', status: 'Complete', ability: 'Passive' }],
	results: [{ mechanism: 'ML', task: 'ROM', status: 'Complete', unit: 'cm', romMin: null, romMax: null, romRange: ml, attempts: 3, comment: null, extra: { mlCm: ml, apCm: ap } }]
});

describe('compareTimepoints', () => {
	it('orders A0, A1 ... A10 by number, not as text', () => {
		expect(['A10', 'A2', 'A0', 'B1', 'A1'].sort(compareTimepoints)).toEqual(['A0', 'A1', 'A2', 'A10', 'B1']);
	});
});

describe('romTrend', () => {
	const list = [pluto('A2', [70, 100]), pluto('A0', [50, 90]), pluto('A1', null), pluto('A3', [80, 105], { limb: 'left' })];
	it('is one point per timepoint in order, skipping timepoints where the task was not completed', () => {
		const t = romTrend(list, { limb: 'right', mechanism: 'FPS', task: 'AROM' });
		expect(t.map((p) => [p.timepoint, p.range])).toEqual([['A0', 50], ['A2', 70]]);
	});
	it('keeps the tasks and limbs apart', () => {
		expect(romTrend(list, { limb: 'right', mechanism: 'FPS', task: 'PROM' }).map((p) => p.range)).toEqual([90, 100]);
		expect(romTrend(list, { limb: 'left', mechanism: 'FPS', task: 'AROM' }).map((p) => p.range)).toEqual([80]);
		expect(romTrend(list, { limb: 'right', mechanism: 'WFE', task: 'AROM' })).toEqual([]);
	});
	it('ignores another device', () => {
		expect(romTrend([mars('A0', 40, 20)], { limb: 'right', mechanism: 'ML', task: 'ROM' })).toEqual([]);
	});
});

describe('reachTrend', () => {
	it('gives the sideways and forward reach per timepoint', () => {
		const t = reachTrend([mars('A1', 48, 24), mars('A0', 44, 20)], { limb: 'right', movement: 'ML' });
		expect(t.map((p) => [p.timepoint, p.mlCm, p.apCm])).toEqual([['A0', 44, 20], ['A1', 48, 24]]);
	});
});

describe('changeSincePrevious', () => {
	const list = [pluto('A0', [50, 90]), pluto('A1', null), pluto('A2', [70, 100])];
	it('compares with the last earlier timepoint that has a value', () => {
		expect(changeSincePrevious(list, list[2], 'FPS', 'AROM')).toBe(20); // A1 has none: back to A0
		expect(changeSincePrevious(list, list[2], 'FPS', 'PROM')).toBe(10);
	});
	it('is null for the first timepoint or when there is no value now', () => {
		expect(changeSincePrevious(list, list[0], 'FPS', 'AROM')).toBeNull();
		expect(changeSincePrevious(list, list[1], 'FPS', 'AROM')).toBeNull();
	});
});

describe('usable', () => {
	it('lists the mechanisms moved actively and those only passively', () => {
		expect(usable(pluto('A0', [50, 90]))).toEqual({ active: ['FPS'], passive: ['WFE'] });
	});
});
