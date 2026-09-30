import { prisma } from './db';
import { patientScopeFor } from './scope';
import { utcDay } from '$lib/utils';

type User = NonNullable<App.Locals['user']>;

export type InflowRange = 'today' | 'week' | 'month' | 'year';
export const RANGES: InflowRange[] = ['today', 'week', 'month', 'year'];
export const parseRange = (v: string | null): InflowRange =>
	RANGES.includes(v as InflowRange) ? (v as InflowRange) : 'month';

const DAYS: Record<Exclude<InflowRange, 'year'>, number> = { today: 1, week: 7, month: 30 };

/**
 * New-patient registrations over time, bucketed server-side in UTC from registrationDate.
 * today/week/month → calendar-day buckets across the last 1/7/30 days; year → the last 12 calendar months.
 */
export async function inflowSeries(user: User, range: InflowRange) {
	const today = utcDay();
	const scope = patientScopeFor(user);

	if (range === 'year') {
		const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
		const rows = await prisma.patient.findMany({
			where: { ...scope, registrationDate: { gte: start } },
			select: { registrationDate: true }
		});
		const counts = new Map<string, number>();
		for (const r of rows) {
			const k = r.registrationDate.toISOString().slice(0, 7);
			counts.set(k, (counts.get(k) ?? 0) + 1);
		}
		const labels: string[] = [];
		const values: number[] = [];
		for (let i = 0; i < 12; i++) {
			const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
			labels.push(d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }));
			values.push(counts.get(d.toISOString().slice(0, 7)) ?? 0);
		}
		return { labels, values };
	}

	const n = DAYS[range];
	const start = new Date(today);
	start.setUTCDate(start.getUTCDate() - n);
	const rows = await prisma.patient.findMany({
		where: { ...scope, registrationDate: { gte: start } },
		select: { registrationDate: true }
	});
	const counts = new Map<string, number>();
	for (const r of rows) {
		const k = r.registrationDate.toISOString().slice(0, 10);
		counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	const labels: string[] = [];
	const values: number[] = [];
	for (let i = 0; i <= n; i++) {
		const d = new Date(start);
		d.setUTCDate(d.getUTCDate() + i);
		labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }));
		values.push(counts.get(d.toISOString().slice(0, 10)) ?? 0);
	}
	return { labels, values };
}

/** Patient-side KPIs + status mix, scoped to the caller's location (Admin: everything). */
export async function programStats(user: User) {
	const scope = patientScopeFor(user);
	const thirtyDaysAgo = utcDay();
	thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

	const [total, active, newPatients, activePlans, sessions, assessments, statusGroups] = await Promise.all([
		prisma.patient.count({ where: scope }),
		prisma.patient.count({ where: { ...scope, status: 'Active' } }),
		prisma.patient.count({ where: { ...scope, registrationDate: { gte: thirtyDaysAgo } } }),
		prisma.therapyPlan.count({ where: { status: 'Active', patient: scope } }),
		prisma.therapySession.aggregate({
			where: { patient: scope },
			_count: { _all: true },
			_sum: { durationMinutes: true }
		}),
		prisma.assessment.count({ where: { patient: scope } }),
		prisma.patient.groupBy({ by: ['status'], where: scope, _count: { _all: true } })
	]);

	return {
		total,
		active,
		newPatients,
		activePlans,
		totalSessions: sessions._count._all,
		therapyHours: Math.round((Number(sessions._sum.durationMinutes ?? 0) / 60) * 10) / 10,
		assessments,
		statusMix: statusGroups.map((g) => ({ status: g.status, count: g._count._all }))
	};
}

/** Device-side KPIs (fleet-wide — devices have no location concept). */
export async function fleetStats() {
	const [byStatus, byType, openIssues, criticalIssues, issueGroups, events] = await Promise.all([
		prisma.device.groupBy({ by: ['status'], _count: { _all: true } }),
		prisma.deviceType.findMany({
			select: { id: true, name: true, category: true, colorSeries: true, devices: { select: { status: true } } },
			orderBy: { name: 'asc' }
		}),
		prisma.deviceIssue.count({ where: { status: { notIn: ['Resolved', 'Cleared'] } } }),
		prisma.deviceIssue.count({ where: { status: { notIn: ['Resolved', 'Cleared'] }, severity: 'Critical' } }),
		prisma.deviceIssue.groupBy({ by: ['status'], _count: { _all: true } }),
		prisma.deviceEvent.findMany({
			orderBy: { eventDate: 'desc' },
			take: 6,
			include: { device: { select: { id: true, displayCode: true } } }
		})
	]);

	const c = (s: string) => byStatus.find((g) => g.status === s)?._count._all ?? 0;
	const total = byStatus.reduce((n, g) => n + g._count._all, 0);
	const inUse = c('In Use');

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
			const used = t.devices.filter((d) => d.status === 'In Use').length;
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
