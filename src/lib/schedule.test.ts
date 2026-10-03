import { describe, expect, it } from 'vitest';
import { buildSchedule, scheduleStatus, type ScheduleInput } from './schedule';

const base = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({ patientId: 'p', code: 'AG10001', devices: ['Mars'], plannedMinutes: 40, sessionsToday: [], inSession: false, ...over });
const sess = (id: string, minutes: number, targets: number, hits: number, startTime = '2026-10-02T04:30:00Z') => ({ id, minutes, targets, hits, startTime });

describe('scheduleStatus', () => {
	it('is waiting until something is trained', () => {
		expect(scheduleStatus(base())).toBe('waiting');
	});
	it('is in progress while the patient is training, even if earlier sessions exist', () => {
		expect(scheduleStatus(base({ inSession: true }))).toBe('in_progress');
		expect(scheduleStatus(base({ inSession: true, sessionsToday: [sess('a', 5, 10, 8)] }))).toBe('in_progress');
	});
	it('is done once anything was trained today', () => {
		expect(scheduleStatus(base({ sessionsToday: [sess('a', 5, 10, 8)] }))).toBe('done');
	});
});

describe('buildSchedule', () => {
	it('lists those training now first, then those still to come, then those done, by ID within each', () => {
		const rows = buildSchedule([
			base({ patientId: '1', code: 'D', sessionsToday: [sess('x', 10, 10, 9)] }),
			base({ patientId: '2', code: 'B' }),
			base({ patientId: '3', code: 'A', inSession: true }),
			base({ patientId: '4', code: 'C' }),
			base({ patientId: '5', code: 'E', sessionsToday: [sess('y', 10, 10, 9)] })
		]);
		expect(rows.map((r) => r.code)).toEqual(['A', 'B', 'C', 'D', 'E']);
	});
	it('sums minutes and accuracy over the day and points at the latest session', () => {
		const [r] = buildSchedule([base({ sessionsToday: [sess('early', 20, 10, 5, '2026-10-02T03:00:00Z'), sess('late', 17, 30, 27, '2026-10-02T09:00:00Z')] })]);
		expect(r).toMatchObject({ status: 'done', minutes: 37, accuracy: 80, sessionId: 'late' });
	});
	it('has no minutes or accuracy before anything is trained', () => {
		const [r] = buildSchedule([base()]);
		expect(r).toMatchObject({ status: 'waiting', minutes: null, accuracy: null, sessionId: null, plannedMinutes: 40 });
	});
});
