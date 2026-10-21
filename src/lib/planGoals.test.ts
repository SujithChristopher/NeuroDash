import { describe, expect, it } from 'vitest';
import { describeGoal, formatValue, goalProgress, goalUnit, isGoalTarget, latestMeasured, limbOf, type GoalLike } from './planGoals';
import type { RoboticAssessmentView } from './roboticAssessment';

const pluto = (timepoint: string, arom: number | null, over: Partial<RoboticAssessmentView> = {}): RoboticAssessmentView => ({
	id: `p${timepoint}`,
	device: 'PLUTO',
	limb: 'right',
	timepoint,
	assessedAt: `2026-0${1 + Number(timepoint.slice(1))}-01T00:00:00.000Z`,
	lockedAt: null,
	mechanisms: [],
	results: [
		{ mechanism: 'FPS', task: 'AROM', status: arom == null ? 'Skipped' : 'Complete', unit: 'deg', romMin: null, romMax: null, romRange: arom, attempts: 1, comment: null, extra: null },
		{ mechanism: 'FPS', task: 'PROM', status: 'Complete', unit: 'deg', romMin: null, romMax: null, romRange: 100 + Number(timepoint.slice(1)), attempts: 1, comment: null, extra: null }
	],
	...over
});
const mars = (timepoint: string, ml: number): RoboticAssessmentView => ({
	id: `m${timepoint}`,
	device: 'MARS',
	limb: 'right',
	timepoint,
	assessedAt: '2026-01-01T00:00:00.000Z',
	lockedAt: null,
	mechanisms: [],
	results: [{ mechanism: 'ML', task: 'ROM', status: 'Complete', unit: 'cm', romMin: null, romMax: null, romRange: ml, attempts: 3, comment: null, extra: { mlCm: ml, apCm: 10 } }]
});

const goal = (over: Partial<GoalLike> = {}): GoalLike => ({ deviceTypeId: 'PLUTO', mechanism: 'FPS', task: 'AROM', limb: 'right', baselineValue: 50, baselineTimepoint: 'A0', targetValue: 90, ...over });

describe('what a goal can be about', () => {
	it('knows the mechanisms and tasks of each device, and nothing else', () => {
		expect(isGoalTarget('PLUTO', 'FPS', 'AROM')).toBe(true);
		expect(isGoalTarget('PLUTO', 'HOC', 'APROM')).toBe(true);
		expect(isGoalTarget('PLUTO', 'FPS', 'DISC')).toBe(false); // discrete reaching has no range
		expect(isGoalTarget('MARS', 'ML', 'ROM')).toBe(true);
		expect(isGoalTarget('MARS', 'ML', 'AROM')).toBe(false);
		expect(isGoalTarget('MARS', 'FPS', 'ROM')).toBe(false);
		expect(isGoalTarget('ATOBOT', 'FPS', 'AROM')).toBe(false);
	});
	it('gives degrees for PLUTO, centimetres for MARS and no unit for hand open / close', () => {
		expect([goalUnit('PLUTO', 'FPS'), goalUnit('MARS', 'ML'), goalUnit('PLUTO', 'HOC')]).toEqual(['deg', 'cm', null]);
	});
	it('trains the limb of the plan side, else the affected side', () => {
		expect([limbOf('Left'), limbOf('Right'), limbOf('Both', 'Left'), limbOf(null, 'Right'), limbOf(null, 'Bilateral')]).toEqual(['left', 'right', null, 'right', null]);
	});
});

describe('the baseline of a new goal', () => {
	it('is the latest completed measurement of that mechanism and task on that device and limb', () => {
		const list = [pluto('A0', 50), pluto('A1', 62), pluto('A2', null)];
		expect(latestMeasured(list, { device: 'PLUTO', limb: 'right', mechanism: 'FPS', task: 'AROM' })).toMatchObject({ value: 62, timepoint: 'A1' }); // A2 skipped it
	});
	it('does not mix tasks, limbs or devices', () => {
		const list = [pluto('A0', 50), mars('A0', 44)];
		expect(latestMeasured(list, { device: 'PLUTO', limb: 'right', mechanism: 'FPS', task: 'PROM' })?.value).toBe(100);
		expect(latestMeasured(list, { device: 'PLUTO', limb: 'left', mechanism: 'FPS', task: 'AROM' })).toBeNull();
		expect(latestMeasured(list, { device: 'MARS', limb: null, mechanism: 'ML', task: 'ROM' })?.value).toBe(44);
		expect(latestMeasured([], { device: 'PLUTO', limb: null, mechanism: 'FPS', task: 'AROM' })).toBeNull();
	});
});

describe('goalProgress', () => {
	it('waits for the next assessment: nothing measured after the baseline yet', () => {
		const p = goalProgress(goal(), [pluto('A0', 50)]);
		expect(p).toMatchObject({ state: 'not-measured', latest: null, change: null, percent: 0 });
		expect(p.baseline).toMatchObject({ value: 50, timepoint: 'A0' });
	});
	it('shows how far along it is after each assessment in between', () => {
		const list = [pluto('A0', 50), pluto('A1', 60), pluto('A2', 70)];
		const p = goalProgress(goal(), list);
		expect(p).toMatchObject({ state: 'progressing', change: 20, percent: 50 }); // 20 of the 40 to go
		expect(p.latest).toMatchObject({ timepoint: 'A2', value: 70 });
		expect(p.points.map((x) => x.timepoint)).toEqual(['A0', 'A1', 'A2']);
		expect(goalProgress(goal(), list.slice(0, 2))).toMatchObject({ percent: 25 });
	});
	it('is achieved once the target is reached, even if it is passed', () => {
		expect(goalProgress(goal(), [pluto('A0', 50), pluto('A1', 95)])).toMatchObject({ state: 'achieved', percent: 100, change: 45 });
	});
	it('says so when the patient went down', () => {
		expect(goalProgress(goal(), [pluto('A0', 50), pluto('A1', 44)])).toMatchObject({ state: 'declined', change: -6, percent: 0 });
	});
	it('ignores a measurement that was skipped and compares the last one that was not', () => {
		const p = goalProgress(goal(), [pluto('A0', 50), pluto('A1', 70), pluto('A2', null)]);
		expect(p.latest).toMatchObject({ timepoint: 'A1', value: 70 });
	});
	it('keeps the baseline stored with the goal even when the assessment is not in the list any more', () => {
		const p = goalProgress(goal({ baselineValue: 50, baselineTimepoint: 'A0' }), [pluto('A1', 60)]);
		expect(p.baseline).toMatchObject({ value: 50, timepoint: 'A0' });
		expect(p.percent).toBe(25);
	});
	it('uses the first assessment that measures it as the baseline when the goal had none', () => {
		const g = goal({ baselineValue: null, baselineTimepoint: null });
		expect(goalProgress(g, [])).toMatchObject({ state: 'no-data', baseline: null, percent: null });
		expect(goalProgress(g, [pluto('A1', 40)])).toMatchObject({ state: 'not-measured', baseline: { value: 40, timepoint: 'A1' } });
		expect(goalProgress(g, [pluto('A1', 40), pluto('A2', 65)])).toMatchObject({ state: 'progressing', change: 25, percent: 50 });
	});
	it('works for MARS reach in centimetres', () => {
		const g = goal({ deviceTypeId: 'MARS', mechanism: 'ML', task: 'ROM', baselineValue: 40, baselineTimepoint: 'A0', targetValue: 50 });
		expect(goalProgress(g, [mars('A0', 40), mars('A1', 45)])).toMatchObject({ state: 'progressing', percent: 50, change: 5 });
	});
	it('compares only the limb of the goal', () => {
		const list = [pluto('A0', 50), pluto('A1', 90, { limb: 'left' })];
		expect(goalProgress(goal({ limb: 'right' }), list).state).toBe('not-measured');
	});
});

describe('wording', () => {
	it('formats degrees, centimetres and plain numbers', () => {
		expect([formatValue(68.94, 'deg'), formatValue(46.6, 'cm'), formatValue(1.3, null)]).toEqual(['68.9°', '46.6 cm', '1.3']);
	});
	it('describes a goal for the plan history', () => {
		expect(describeGoal({ deviceTypeId: 'PLUTO', mechanism: 'FPS', task: 'AROM', targetValue: 85, unit: 'deg' })).toBe('PLUTO FPS AROM: target 85°');
		expect(describeGoal({ deviceTypeId: 'MARS', mechanism: 'ML', task: 'ROM', targetValue: 50, unit: 'cm' })).toBe('MARS ML: target 50 cm');
	});
});
