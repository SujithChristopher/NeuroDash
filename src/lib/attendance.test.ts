import { describe, expect, it } from 'vitest';
import { buildAttendance, levelFor, type AttendanceDay } from './attendance';

// 2026-09-30 is a Wednesday. A 10-day plan: Wed 30 Sep to Fri 9 Oct.
const plan = (minutes: number[], target = 40, start = '2026-09-30'): AttendanceDay[] =>
	minutes.map((m, i) => ({ dayNumber: i + 1, logDate: new Date(Date.parse(start + 'T00:00:00Z') + i * 86400_000).toISOString(), targetMinutes: target, actualMinutes: m }));

describe('levelFor', () => {
	it('is none for no training and "target met" at the target or above', () => {
		expect(levelFor(0, 40)).toBe(0);
		expect(levelFor(10, 40)).toBe(1);
		expect(levelFor(20, 40)).toBe(2);
		expect(levelFor(30, 40)).toBe(3);
		expect(levelFor(40, 40)).toBe(4);
		expect(levelFor(80, 40)).toBe(4);
	});
});

describe('buildAttendance', () => {
	const a = buildAttendance(plan([40, 20, 0, 40, 40, 40, 0, 10, 0, 0]), '2026-10-06'); // today is plan day 7

	it('lays the days out in Monday-first week columns, padded outside the plan', () => {
		expect(a.weeks).toHaveLength(2); // the weeks of 28 Sep and 5 Oct
		expect(a.weeks[0].map((c) => c?.dayNumber ?? null)).toEqual([null, null, 1, 2, 3, 4, 5]);
		expect(a.weeks[1].map((c) => c?.dayNumber ?? null)).toEqual([6, 7, 8, 9, 10, null, null]);
	});
	it('shades past days by the share of the target, and leaves days to come empty', () => {
		const cells = a.weeks.flat().filter(Boolean);
		expect(cells.find((c) => c!.dayNumber === 1)!.level).toBe(4);
		expect(cells.find((c) => c!.dayNumber === 2)!.level).toBe(2);
		expect(cells.find((c) => c!.dayNumber === 3)!.level).toBe(0); // missed
		expect(cells.find((c) => c!.dayNumber === 7)!.level).toBe(0); // today
		expect(cells.find((c) => c!.dayNumber === 8)!.level).toBeNull(); // 7 Oct: still to come
	});
	it('marks today', () => {
		expect(a.weeks.flat().filter((c) => c?.today).map((c) => c!.dayNumber)).toEqual([7]);
	});
	it('names the month above the first week of each month', () => {
		expect(a.months).toEqual(['Sep', 'Oct']);
	});
	it('counts training days in the last 7 days and the share of planned minutes since the start', () => {
		// 30 Sep .. 6 Oct covers plan days 1-7: trained on days 1, 2, 4, 5, 6
		expect(a.last7).toEqual({ trained: 5, planned: 7 });
		expect(a.sinceStartPct).toBe(Math.round((180 / 280) * 100));
	});
	it('has nothing for an empty plan', () => {
		expect(buildAttendance([], '2026-10-05')).toEqual({ weeks: [], months: [], last7: { trained: 0, planned: 0 }, sinceStartPct: null });
	});
	it('has no percentage before the plan starts', () => {
		expect(buildAttendance(plan([0, 0, 0]), '2026-09-01').sinceStartPct).toBeNull();
	});
});
