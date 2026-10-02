import { describe, expect, it } from 'vitest';
import { buildPatientReport, cleanNotes, parsePeriod, type ReportInput } from './patientReport';

const d = (s: string) => new Date(s + 'T00:00:00Z');
const MARS = { typeId: 'MARS', typeName: 'Mars', colorSeries: 'series-2' };
const PLUTO = { typeId: 'PLUTO', typeName: 'Pluto', colorSeries: 'series-1' };

const base = (over: Partial<ReportInput> = {}): ReportInput => ({
	patient: { displayCode: 'HOC1', status: 'Ongoing', gender: 'Female', dob: d('1980-06-15'), affectedSide: 'Left', strokeDate: d('2026-05-01'), therapistName: 'Dr P' },
	plan: null,
	sessions: [],
	assessments: [],
	now: d('2026-10-02'),
	...over
});

describe('devices in the report', () => {
	const r = buildPatientReport(
		base({
			sessions: [
				{ date: d('2026-09-01'), durationMinutes: 30, device: MARS, trials: [{ mechanism: 'ML', durationSec: 60 }, { mechanism: 'ML', durationSec: 60 }, { mechanism: 'AP', durationSec: 30 }] },
				{ date: d('2026-09-05'), durationMinutes: 20, device: MARS, trials: [{ mechanism: 'AP', durationSec: 90 }, { mechanism: null, durationSec: 10 }] },
				{ date: d('2026-09-03'), durationMinutes: 10, device: PLUTO, trials: [{ mechanism: 'WURD', durationSec: 600 }] }
			]
		})
	);

	it('sums time and sessions per device, most-used first, with first and last day', () => {
		expect(r.devices.map((x) => x.typeId)).toEqual(['MARS', 'PLUTO']);
		expect(r.devices[0]).toMatchObject({ sessions: 2, minutes: 50, firstDay: '2026-09-01', lastDay: '2026-09-05' });
		expect(r.totals).toEqual({ sessions: 3, minutes: 60, devices: 2 });
	});
	it('lists the movements / mechanisms of each device with trials and minutes, skipping trials with none', () => {
		expect(r.devices[0].movements).toEqual([
			{ code: 'ML', trials: 2, minutes: 2 },
			{ code: 'AP', trials: 2, minutes: 2 }
		]);
		expect(r.devices[1].movements).toEqual([{ code: 'WURD', trials: 1, minutes: 10 }]);
	});
});

describe('assessment change per scale', () => {
	const a = (scaleId: string, date: string, score: number | null, max = 100, label: string | null = null) => ({ scaleId, title: scaleId.toUpperCase(), date: d(date), label, score, maxScore: max });
	const r = buildPatientReport(
		base({
			assessments: [a('fma', '2026-08-01', 20, 66, 'Baseline'), a('arat', '2026-08-02', 10, 57), a('fma', '2026-09-01', 40, 66, 'Day 28'), a('arat', '2026-09-02', 30, 57), a('bbt', '2026-09-03', null)]
		})
	);
	it('gives each scored scale its own series and ignores unscored ones', () => {
		expect(r.scales.map((s) => s.scaleId)).toEqual(['fma', 'arat']);
		expect(r.scales[0].points.map((p) => p.label)).toEqual(['Baseline', 'Day 28']);
	});
	it('reports the change from the first to the latest assessment of that scale', () => {
		expect(r.scales[0].change).toMatchObject({ fromScore: 20, toScore: 40, max: 66, fromPct: 30, toPct: 61, pctPoints: 31, direction: 'improved' });
		expect(r.scales[1].change?.fromPct).toBe(18);
	});
	it('has no change with a single assessment, and flags a decline', () => {
		const one = buildPatientReport(base({ assessments: [a('fma', '2026-08-01', 20, 66)] }));
		expect(one.scales[0].change).toBeNull();
		const worse = buildPatientReport(base({ assessments: [a('fma', '2026-08-01', 40, 66), a('fma', '2026-09-01', 20, 66)] }));
		expect(worse.scales[0].change).toMatchObject({ direction: 'declined', pctPoints: -31 });
	});
});

describe('patient and plan', () => {
	it('calculates age and carries no name or contact details', () => {
		const r = buildPatientReport(base());
		expect(r.patient).toMatchObject({ displayCode: 'HOC1', age: 46, affectedSide: 'Left', strokeDate: '2026-05-01', therapist: 'Dr P' });
		expect(Object.keys(r.patient)).not.toContain('name');
	});
	it('summarises the plan', () => {
		const r = buildPatientReport(
			base({
				plan: {
					id: 'p',
					name: 'x',
					status: 'Active',
					durationDays: 10,
					dailyTargetMinutes: 30,
					targetSessions: 5,
					trainingSide: 'Right',
					startDate: d('2026-09-28'),
					devices: [{ id: 'MARS', name: 'Mars' }],
					dayLog: [
						{ dayNumber: 1, logDate: d('2026-09-28'), status: 'done', targetMinutes: 30, actualMinutes: 30 },
						{ dayNumber: 2, logDate: d('2026-09-29'), status: 'missed', targetMinutes: 30, actualMinutes: 0 },
						{ dayNumber: 3, logDate: d('2026-09-30'), status: 'upcoming', targetMinutes: 30, actualMinutes: 0 }
					]
				}
			})
		);
		expect(r.plan).toMatchObject({ trainingSide: 'Right', devices: ['Mars'], currentDay: 2, adherence: 50 });
	});
});

describe('cleanNotes', () => {
	it('keeps known fields, trims, limits length and drops notes for unknown scales', () => {
		const n = cleanNotes({ summary: '  hello ', devices: 5, scales: { fma: ' ok ', ghost: 'x', arat: '   ' }, extra: 'z' }, ['fma', 'arat']);
		expect(n).toEqual({ summary: 'hello', devices: '', scales: { fma: 'ok' } });
		expect(cleanNotes({ summary: 'a'.repeat(9000) }, []).summary).toHaveLength(4000);
		expect(cleanNotes(null, [])).toEqual({ summary: '', devices: '', scales: {} });
	});
});

describe('a report for a chosen period', () => {
	const a = (date: string, score: number) => ({ scaleId: 'fma', title: 'FMA', date: d(date), label: null, score, maxScore: 66 });
	const input = base({
		sessions: [
			{ date: d('2026-08-01'), durationMinutes: 10, device: MARS, trials: [{ mechanism: 'ML', durationSec: 60 }] },
			{ date: d('2026-09-10'), durationMinutes: 20, device: MARS, trials: [{ mechanism: 'AP', durationSec: 60 }] },
			{ date: d('2026-09-20'), durationMinutes: 30, device: PLUTO, trials: [{ mechanism: 'WFE', durationSec: 60 }] }
		],
		assessments: [a('2026-08-01', 20), a('2026-09-01', 30), a('2026-09-25', 50)]
	});

	it('is all time without a period', () => {
		const r = buildPatientReport(input);
		expect(r.period).toBeNull();
		expect(r.totals).toMatchObject({ sessions: 3, minutes: 60 });
		expect(r.scales[0].points).toHaveLength(3);
	});
	it('counts only the sessions and assessments inside the period, ends included', () => {
		const r = buildPatientReport({ ...input, period: { from: '2026-09-01', to: '2026-09-20' } });
		expect(r.period).toEqual({ from: '2026-09-01', to: '2026-09-20' });
		expect(r.totals).toMatchObject({ sessions: 2, minutes: 50, devices: 2 });
		expect(r.scales[0].points.map((p) => p.score)).toEqual([30]);
		expect(r.scales[0].change).toBeNull(); // one assessment in the period: nothing to compare
	});
	it('supports an open-ended period and an empty one', () => {
		expect(buildPatientReport({ ...input, period: { from: '2026-09-15', to: null } }).totals.sessions).toBe(1);
		const none = buildPatientReport({ ...input, period: { from: '2027-01-01', to: null } });
		expect(none.totals.sessions).toBe(0);
		expect(none.devices).toEqual([]);
		expect(none.scales).toEqual([]);
	});
	it('limits plan adherence to the period', () => {
		const plan = {
			id: 'p', name: 'x', status: 'Active', durationDays: 4, dailyTargetMinutes: 30, targetSessions: 4, trainingSide: 'Left', startDate: d('2026-09-01'), devices: [],
			dayLog: [
				{ dayNumber: 1, logDate: d('2026-09-01'), status: 'done', targetMinutes: 30, actualMinutes: 30 },
				{ dayNumber: 2, logDate: d('2026-09-02'), status: 'done', targetMinutes: 30, actualMinutes: 30 },
				{ dayNumber: 3, logDate: d('2026-09-03'), status: 'missed', targetMinutes: 30, actualMinutes: 0 },
				{ dayNumber: 4, logDate: d('2026-09-04'), status: 'missed', targetMinutes: 30, actualMinutes: 0 }
			]
		};
		expect(buildPatientReport(base({ plan })).plan?.adherence).toBe(50);
		expect(buildPatientReport(base({ plan, period: { from: '2026-09-01', to: '2026-09-02' } })).plan?.adherence).toBe(100);
	});
});

describe('parsePeriod', () => {
	it('keeps valid dates, drops bad ones and swaps a reversed range', () => {
		expect(parsePeriod('2026-09-01', '2026-09-30')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
		expect(parsePeriod('nope', '2026-13-45')).toEqual({ from: null, to: null });
		expect(parsePeriod(null, '2026-09-30')).toEqual({ from: null, to: '2026-09-30' });
		expect(parsePeriod('2026-09-30', '2026-09-01')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
		expect(parsePeriod('2026-09-01; DROP', '')).toEqual({ from: null, to: null });
	});
});
