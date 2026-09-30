// computePatientStats — the single source of truth for every stat shown across the app (spec §7.1).
// Pure and serializable so it runs on the server and in the browser.

export interface DayLogLite {
	dayNumber: number;
	logDate: string | Date;
	status: string; // done|partial|missed|upcoming
	targetMinutes: number;
	actualMinutes: number;
}

export interface PlanLite {
	id: string;
	name: string;
	status: string;
	durationDays: number;
	dailyTargetMinutes: number;
	targetSessions: number | null;
	dayLog: DayLogLite[];
}

export interface SessionLite {
	durationMinutes: number | string | null;
	accuracyPct: number | null;
	device: { displayCode: string };
}

export function computePatientStats<P extends PlanLite>(
	patient: { therapyPlans: P[] },
	sessions: SessionLite[]
) {
	const plan = patient.therapyPlans.find((p) => p.status === 'Active') ?? patient.therapyPlans[0];
	const dayLog = plan?.dayLog ?? [];
	const elapsedDays = dayLog.filter((d) => d.status !== 'upcoming');
	const completedDays = dayLog.filter((d) => d.status === 'done').length;
	const currentDay = elapsedDays.length;
	const completionPct = plan ? Math.round((currentDay / plan.durationDays) * 100) : 0;
	const targetSum = elapsedDays.reduce((s, d) => s + d.targetMinutes, 0);
	const actualSum = elapsedDays.reduce((s, d) => s + d.actualMinutes, 0);
	const adherence = targetSum > 0 ? Math.round((actualSum / targetSum) * 100) : 0;
	const totalMin = sessions.reduce((s, x) => s + (Number(x.durationMinutes) || 0), 0);
	const devicesUsed = [...new Set(sessions.map((s) => s.device.displayCode))];
	const avgAccuracy =
		sessions.length > 0
			? Math.round((sessions.reduce((s, x) => s + (x.accuracyPct ?? 0), 0) / sessions.length) * 10) / 10
			: 0;
	return {
		plan,
		currentDay,
		completedDays,
		completionPct,
		adherence,
		targetSum,
		actualSum,
		totalMin,
		sessionsCount: sessions.length,
		devicesUsed,
		avgAccuracy
	};
}

/** accuracyPct is always computed server-side, never stored (spec §7.5). */
export function accuracyPct(totalTargets: number, totalHits: number): number | null {
	return totalTargets > 0 ? Math.round((totalHits / totalTargets) * 10000) / 100 : null;
}
