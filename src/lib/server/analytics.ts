import { prisma } from './db';
import { patientScopeFor } from './scope';
import { utcDay } from '$lib/utils';
import { getScale } from '$lib/scales/registry';
import { buildScaleChanges, type ScaleChange } from '$lib/scaleChanges';

type User = NonNullable<App.Locals['user']>;

export type InflowRange = 'today' | 'week' | 'month' | 'year';
export const RANGES: InflowRange[] = ['today', 'week', 'month', 'year'];
export const parseRange = (v: string | null): InflowRange =>
	RANGES.includes(v as InflowRange) ? (v as InflowRange) : 'month';

const DAYS: Record<Exclude<InflowRange, 'year'>, number> = { today: 1, week: 7, month: 30 };

/**
 * Patient inflow over time, bucketed server-side in UTC. today/week/month → calendar-day buckets across the last 1/7/30
 * days; year → the last 12 calendar months. Three series per bucket:
 *   new      patients registered in the bucket
 *   old      patients registered in an earlier bucket who trained in this one (returning patients)
 *   overall  new + old
 */
export async function inflowSeries(user: User, range: InflowRange) {
	const today = utcDay();
	const scope = patientScopeFor(user);
	const monthly = range === 'year';

	let start: Date;
	const buckets: { key: string; label: string }[] = [];
	if (monthly) {
		start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
		for (let i = 0; i < 12; i++) {
			const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
			buckets.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) });
		}
	} else {
		const n = DAYS[range as Exclude<InflowRange, 'year'>];
		start = new Date(today);
		start.setUTCDate(start.getUTCDate() - n);
		for (let i = 0; i <= n; i++) {
			const d = new Date(start);
			d.setUTCDate(d.getUTCDate() + i);
			buckets.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) });
		}
	}
	const keyOf = (d: Date) => d.toISOString().slice(0, monthly ? 7 : 10);

	const [registered, sessions] = await Promise.all([
		prisma.patient.findMany({ where: { ...scope, registrationDate: { gte: start } }, select: { registrationDate: true } }),
		prisma.therapySession.findMany({
			where: { patient: scope, sessionDate: { gte: start } },
			select: { patientId: true, sessionDate: true, patient: { select: { registrationDate: true } } }
		})
	]);

	const fresh = new Map<string, number>();
	for (const r of registered) fresh.set(keyOf(r.registrationDate), (fresh.get(keyOf(r.registrationDate)) ?? 0) + 1);

	const returning = new Map<string, Set<string>>();
	for (const s of sessions) {
		const k = keyOf(s.sessionDate);
		if (keyOf(s.patient.registrationDate) >= k) continue; // registered this bucket (or later): counted as new, not returning
		if (!returning.has(k)) returning.set(k, new Set());
		returning.get(k)!.add(s.patientId);
	}

	const newValues = buckets.map((b) => fresh.get(b.key) ?? 0);
	const oldValues = buckets.map((b) => returning.get(b.key)?.size ?? 0);
	return {
		labels: buckets.map((b) => b.label),
		values: newValues, // kept for callers that only want registrations
		newValues,
		oldValues,
		overallValues: newValues.map((v, i) => v + oldValues[i])
	};
}

/** Patient-side KPIs + status mix, scoped to the caller's location (Admin: everything). */
export async function programStats(user: User) {
	const scope = patientScopeFor(user);
	const thirtyDaysAgo = utcDay();
	thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

	const [total, active, newPatients, activePlans, statusGroups] = await Promise.all([
		prisma.patient.count({ where: scope }),
		prisma.patient.count({ where: { ...scope, status: { in: ['Active', 'Ongoing'] } } }),
		prisma.patient.count({ where: { ...scope, registrationDate: { gte: thirtyDaysAgo } } }),
		prisma.therapyPlan.count({ where: { status: 'Active', patient: scope } }),
		prisma.patient.groupBy({ by: ['status'], where: scope, _count: { _all: true } })
	]);

	return {
		total,
		active,
		newPatients,
		activePlans,
		statusMix: statusGroups.map((g) => ({ status: g.status, count: g._count._all }))
	};
}

/** Device-side KPIs (fleet-wide — devices have no location concept). */
export async function fleetStats() {
	const weekAgo = utcDay();
	weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
	const [byStatus, byType, openIssues, criticalIssues, issueGroups, events, recentlyUsed] = await Promise.all([
		prisma.device.groupBy({ by: ['status'], _count: { _all: true } }),
		prisma.deviceType.findMany({
			select: { id: true, name: true, category: true, colorSeries: true, devices: { select: { id: true, status: true } } },
			orderBy: { name: 'asc' }
		}),
		prisma.deviceIssue.count({ where: { status: { notIn: ['Resolved', 'Cleared'] } } }),
		prisma.deviceIssue.count({ where: { status: { notIn: ['Resolved', 'Cleared'] }, severity: 'Critical' } }),
		prisma.deviceIssue.groupBy({ by: ['status'], _count: { _all: true } }),
		prisma.deviceEvent.findMany({
			orderBy: { eventDate: 'desc' },
			take: 6,
			include: { device: { select: { id: true, displayCode: true } } }
		}),
		// "In use" = trained on in the last 7 days (units are set up at centres, not lent to patients).
		prisma.therapySession.findMany({ where: { sessionDate: { gte: weekAgo } }, distinct: ['deviceId'], select: { deviceId: true } })
	]);
	const used7 = new Set(recentlyUsed.map((r) => r.deviceId));

	const c = (s: string) => byStatus.find((g) => g.status === s)?._count._all ?? 0;
	const total = byStatus.reduce((n, g) => n + g._count._all, 0);
	const inUse = used7.size;

	return {
		total,
		inUse,
		available: c('Available'),
		issueDetected: c('Issue Detected') + c('Awaiting Engineer'),
		maintenance: c('Maintenance'),
		utilization: total ? Math.round((inUse / total) * 100) : 0,
		openIssues,
		criticalIssues,
		issueStatus: ['Open', 'Investigating', 'Resolved', 'Cleared'].map((s) => ({
			status: s,
			count: issueGroups.find((g) => g.status === s)?._count._all ?? 0
		})),
		utilByType: byType.map((t) => {
			const units = t.devices.length;
			const used = t.devices.filter((d) => used7.has(d.id)).length;
			return {
				id: t.id,
				name: t.name,
				category: t.category,
				series: t.colorSeries ?? 'series-1',
				units,
				inUse: used,
				pct: units ? Math.round((used / units) * 100) : 0
			};
		}),
		statusMix: byStatus.map((g) => ({ status: g.status, count: g._count._all })),
		events: events.map((e) => ({
			id: e.id,
			type: e.eventType,
			description: e.description,
			at: e.eventDate.toISOString(),
			device: e.device
		}))
	};
}

export async function recentAudit(take = 8) {
	const rows = await prisma.auditLog.findMany({
		orderBy: { occurredAt: 'desc' },
		take,
		include: { actorUser: { select: { name: true } } }
	});
	return rows.map((a) => ({
		id: a.id,
		user: a.actorUser?.name ?? (a.actorRole === 'SYSTEM' ? 'System' : '—'),
		role: a.actorRole,
		action: a.action,
		entity: `${a.entityType} ${a.entityId.slice(0, 8)}`,
		at: a.occurredAt.toISOString()
	}));
}

export const CENTRE_STATUSES = ['Active', 'Ongoing', 'Paused', 'Completed', 'Discontinued'] as const;

export interface CentreStats {
	id: string;
	name: string;
	engineer: string | null;
	therapists: number;
	consultants: number;
	devices: number;
	patients: number;
	byStatus: Record<(typeof CENTRE_STATUSES)[number], number>;
	totalHours: number;
	/** Distinct calendar days on which anyone trained at the centre: all time, and in the last 30 days */
	activeDays: number;
	activeDays30: number;
	lastTrained: string | null;
}

/** One row per centre: staff, responsible engineer, patients by status, hours trained and active days. Admin: every centre; others: their own. */
export async function centreStats(user: User): Promise<CentreStats[]> {
	const where = user.role === 'ADMIN' ? {} : { id: user.locationId ?? 'no-centre' };
	const since = utcDay();
	since.setUTCDate(since.getUTCDate() - 30);

	const locations = await prisma.location.findMany({
		where,
		orderBy: { name: 'asc' },
		include: {
			engineer: { select: { name: true } },
			users: { where: { isActive: true }, select: { role: true } },
			_count: { select: { devices: true } }
		}
	});

	return Promise.all(
		locations.map(async (l) => {
			const sessions = { patient: { therapist: { locationId: l.id } } };
			const [statuses, hours, days] = await Promise.all([
				prisma.patient.groupBy({ by: ['status'], where: { therapist: { locationId: l.id } }, _count: { _all: true } }),
				prisma.therapySession.aggregate({ where: sessions, _sum: { durationMinutes: true } }),
				prisma.therapySession.groupBy({ by: ['sessionDate'], where: sessions })
			]);
			const byStatus = Object.fromEntries(CENTRE_STATUSES.map((st) => [st, statuses.find((g) => g.status === st)?._count._all ?? 0])) as CentreStats['byStatus'];
			const dayList = days.map((d) => d.sessionDate.getTime()).sort((a, b) => a - b);
			return {
				id: l.id,
				name: l.name,
				engineer: l.engineer?.name ?? null,
				therapists: l.users.filter((u) => u.role === 'THERAPIST').length,
				consultants: l.users.filter((u) => u.role === 'CONSULTANT').length,
				devices: l._count.devices,
				patients: statuses.reduce((n, g) => n + g._count._all, 0),
				byStatus,
				totalHours: Math.round((Number(hours._sum.durationMinutes ?? 0) / 60) * 10) / 10,
				activeDays: dayList.length,
				activeDays30: dayList.filter((t) => t >= since.getTime()).length,
				lastTrained: dayList.length ? new Date(dayList[dayList.length - 1]).toISOString() : null
			};
		})
	);
}

/** For every assessment scale: how the average score of all the caller's patients moved from Day 1 to Day 30. */
export async function scaleChangeStats(user: User): Promise<ScaleChange[]> {
	const rows = await prisma.assessment.findMany({
		where: { patient: patientScopeFor(user), score: { not: null }, maxScore: { gt: 0 } },
		select: { scaleId: true, patientId: true, assessmentDate: true, score: true, maxScore: true }
	});
	return buildScaleChanges(
		rows.map((r) => ({ scaleId: r.scaleId, title: getScale(r.scaleId)?.title ?? r.scaleId, patientId: r.patientId, date: r.assessmentDate, score: Number(r.score), maxScore: Number(r.maxScore) }))
	);
}
