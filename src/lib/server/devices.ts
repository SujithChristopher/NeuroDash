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
}

/** Per-device usage, computed with one groupBy on TherapySession.deviceId (spec §7.4). */
export async function deviceUsage(deviceId?: string): Promise<Map<string, UsageRow>> {
	const groups = await prisma.therapySession.groupBy({
		by: ['deviceId'],
		where: deviceId ? { deviceId } : undefined,
		_count: { _all: true },
		_sum: { durationMinutes: true, totalTargets: true, totalHits: true, totalStars: true }
	});
	return new Map(
		groups.map((g) => {
			const targets = g._sum.totalTargets ?? 0;
			const hits = g._sum.totalHits ?? 0;
			return [
				g.deviceId,
				{
					deviceId: g.deviceId,
					sessions: g._count._all,
					totalMin: Number(g._sum.durationMinutes ?? 0),
					totalTargets: targets,
					totalHits: hits,
					totalStars: g._sum.totalStars ?? 0,
					avgAccuracy: targets > 0 ? Math.round((hits / targets) * 1000) / 10 : 0
				}
			];
		})
	);
}
