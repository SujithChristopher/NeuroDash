import { prisma } from './db';

export type DeviceEventType =
	| 'registered'
	| 'assigned'
	| 'maintenance'
	| 'issue'
	| 'investigating'
	| 'resolved'
	| 'cleared';

export async function logDeviceEvent(deviceId: string, eventType: DeviceEventType, description: string) {
	await prisma.deviceEvent.create({ data: { deviceId, eventType, description } });
}

export interface UsageRow {
	deviceId: string;
	sessions: number;
	totalMin: number;
	totalTargets: number;
	totalHits: number;
	totalStars: number;
	avgAccuracy: number;
	/** Distinct patients who trained on the unit, and the first / last training day (ISO) */
	patients: number;
	firstDay: string | null;
	lastDay: string | null;
	/** Sessions per week since first use (at least one week), and training days in the last 30 */
	sessionsPerWeek: number;
	activeDays30: number;
}

/** Per-device usage, computed with one groupBy on TherapySession.deviceId (spec §7.4). */
export async function deviceUsage(deviceId?: string): Promise<Map<string, UsageRow>> {
	const where = deviceId ? { deviceId } : undefined;
	const since = new Date();
	since.setUTCDate(since.getUTCDate() - 30);
	const [groups, perPatient, span, days] = await Promise.all([
		prisma.therapySession.groupBy({
			by: ['deviceId'],
			where,
			_count: { _all: true },
			_sum: { durationMinutes: true, totalTargets: true, totalHits: true, totalStars: true }
		}),
		prisma.therapySession.groupBy({ by: ['deviceId', 'patientId'], where }),
		prisma.therapySession.groupBy({ by: ['deviceId'], where, _min: { sessionDate: true }, _max: { sessionDate: true } }),
		prisma.therapySession.groupBy({ by: ['deviceId', 'sessionDate'], where: { ...where, sessionDate: { gte: since } } })
	]);
	const patientCount = new Map<string, number>();
	for (const r of perPatient) patientCount.set(r.deviceId, (patientCount.get(r.deviceId) ?? 0) + 1);
	const activeDays = new Map<string, number>();
	for (const r of days) activeDays.set(r.deviceId, (activeDays.get(r.deviceId) ?? 0) + 1);
	const range = new Map(span.map((r) => [r.deviceId, r]));
	return new Map(
		groups.map((g) => {
			const targets = g._sum.totalTargets ?? 0;
			const hits = g._sum.totalHits ?? 0;
			const r = range.get(g.deviceId);
			const first = r?._min.sessionDate ?? null;
			const weeks = first ? Math.max(1, (Date.now() - first.getTime()) / (7 * 86400_000)) : 1;
			return [
				g.deviceId,
				{
					deviceId: g.deviceId,
					sessions: g._count._all,
					totalMin: Number(g._sum.durationMinutes ?? 0),
					totalTargets: targets,
					totalHits: hits,
					totalStars: g._sum.totalStars ?? 0,
					avgAccuracy: targets > 0 ? Math.round((hits / targets) * 1000) / 10 : 0,
					patients: patientCount.get(g.deviceId) ?? 0,
					firstDay: first?.toISOString() ?? null,
					lastDay: r?._max.sessionDate?.toISOString() ?? null,
					sessionsPerWeek: Math.round((g._count._all / weeks) * 10) / 10,
					activeDays30: activeDays.get(g.deviceId) ?? 0
				}
			];
		})
	);
}
