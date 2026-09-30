import { describe, expect, it } from 'vitest';
import { accuracyPct, computePatientStats, type PlanLite } from './patientStats';

const plan = (over: Partial<PlanLite> = {}): PlanLite => ({
	id: 'p1',
	name: 'Plan',
	status: 'Active',
	durationDays: 10,
	dailyTargetMinutes: 60,
	targetSessions: 10,
	dayLog: [
		{ dayNumber: 1, logDate: '2026-01-01', status: 'done', targetMinutes: 60, actualMinutes: 60 },
		{ dayNumber: 2, logDate: '2026-01-02', status: 'partial', targetMinutes: 60, actualMinutes: 30 },
		{ dayNumber: 3, logDate: '2026-01-03', status: 'missed', targetMinutes: 60, actualMinutes: 0 },
		{ dayNumber: 4, logDate: '2026-01-04', status: 'upcoming', targetMinutes: 60, actualMinutes: 0 }
	],
	...over
});

describe('computePatientStats', () => {
	it('derives day, completion and adherence from elapsed days only', () => {
		const s = computePatientStats({ therapyPlans: [plan()] }, []);
		expect(s.currentDay).toBe(3);
		expect(s.completedDays).toBe(1);
		expect(s.completionPct).toBe(30);
		expect(s.adherence).toBe(50); // 90 / 180
	});

	it('prefers the Active plan and handles no plan', () => {
		const paused = plan({ id: 'old', status: 'Paused' });
		expect(computePatientStats({ therapyPlans: [paused, plan()] }, []).plan?.id).toBe('p1');
		const none = computePatientStats({ therapyPlans: [] }, []);
		expect(none.plan).toBeUndefined();
		expect(none.completionPct).toBe(0);
		expect(none.adherence).toBe(0);
	});

	it('aggregates sessions', () => {
		const s = computePatientStats({ therapyPlans: [] }, [
			{ durationMinutes: '30.5', accuracyPct: 80, device: { displayCode: 'A' } },
			{ durationMinutes: 29.5, accuracyPct: 90, device: { displayCode: 'B' } },
			{ durationMinutes: null, accuracyPct: null, device: { displayCode: 'A' } }
		]);
		expect(s.totalMin).toBe(60);
		expect(s.devicesUsed).toEqual(['A', 'B']);
		expect(s.avgAccuracy).toBe(56.7);
	});
});

describe('accuracyPct', () => {
	it('is null without targets, else rounded to 2dp', () => {
		expect(accuracyPct(0, 0)).toBeNull();
		expect(accuracyPct(3, 1)).toBe(33.33);
	});
});
