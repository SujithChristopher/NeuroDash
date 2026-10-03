// Today's list for the therapist's overview: who is due to train today and where each one stands.
// Pure (no database, no clock), so the rules are unit-tested.

export type ScheduleStatus = 'in_progress' | 'waiting' | 'done';

export interface ScheduleInput {
	patientId: string;
	code: string;
	devices: string[];
	plannedMinutes: number;
	/** Sessions already recorded today for this patient (any device) */
	sessionsToday: { id: string; minutes: number | null; targets: number; hits: number; startTime: string }[];
	/** True while the patient is training right now (their device is uploading) */
	inSession: boolean;
}

export interface ScheduleRow {
	patientId: string;
	code: string;
	devices: string[];
	plannedMinutes: number;
	status: ScheduleStatus;
	/** Filled once something was trained today */
	minutes: number | null;
	accuracy: number | null;
	/** The latest session of the day, to open its detail */
	sessionId: string | null;
}

export function scheduleStatus(row: Pick<ScheduleInput, 'sessionsToday' | 'inSession'>): ScheduleStatus {
	if (row.inSession) return 'in_progress';
	if (row.sessionsToday.length) return 'done'; // any training today counts, as in the plan's day log
	return 'waiting';
}

const ORDER: Record<ScheduleStatus, number> = { in_progress: 0, waiting: 1, done: 2 };

/** Training now first, then those still to come, then those finished; by patient ID within each. */
export function buildSchedule(inputs: ScheduleInput[]): ScheduleRow[] {
	return inputs
		.map((i) => {
			const done = i.sessionsToday;
			const targets = done.reduce((n, s) => n + s.targets, 0);
			const hits = done.reduce((n, s) => n + s.hits, 0);
			const latest = [...done].sort((a, b) => b.startTime.localeCompare(a.startTime))[0];
			return {
				patientId: i.patientId,
				code: i.code,
				devices: i.devices,
				plannedMinutes: i.plannedMinutes,
				status: scheduleStatus(i),
				minutes: done.length ? Math.round(done.reduce((n, s) => n + (s.minutes ?? 0), 0)) : null,
				accuracy: targets ? Math.round((hits / targets) * 100) : null,
				sessionId: latest?.id ?? null
			};
		})
		.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.code.localeCompare(b.code));
}
