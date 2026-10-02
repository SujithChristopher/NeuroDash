import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { patientScopeFor } from '$lib/server/scope';
import { notificationWhereFor } from '$lib/server/notifications';
import { inflowSeries, parseRange, programStats } from '$lib/server/analytics';
import { utcDay } from '$lib/utils';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user;
	if (!user) throw redirect(302, '/login');
	// Engineer/Admin have no home concept — their nav starts at /analytics.
	if (user.role === 'ENGINEER' || user.role === 'ADMIN') throw redirect(302, '/analytics');

	const range = parseRange(url.searchParams.get('range'));
	const scope = patientScopeFor(user);

	// sessionDate is a plain DATE stored at UTC midnight, so "today" must be computed in UTC.
	const startOfDay = utcDay();
	const endOfDay = new Date(startOfDay);
	endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

	const [program, inflow, todaySessions, pending, actionable] = await Promise.all([
		programStats(user),
		inflowSeries(user, range),
		prisma.therapySession.findMany({
			where: { patient: scope, sessionDate: { gte: startOfDay, lt: endOfDay } },
			orderBy: { startTime: 'asc' },
			include: {
				patient: { select: { id: true, name: true, displayCode: true } },
				device: { select: { displayCode: true } }
			}
		}),
		prisma.patient.findMany({
			where: { ...scope, status: 'Active', therapyPlans: { none: {} } },
			select: { id: true, name: true, displayCode: true },
			orderBy: { createdAt: 'desc' },
			take: 6
		}),
		prisma.notification.findMany({
			where: { ...notificationWhereFor(user), isRead: false },
			orderBy: { createdAt: 'desc' },
			take: 20
		})
	]);

	return {
		range,
		program,
		inflow,
		today: todaySessions.map((s) => ({
			id: s.id,
			startTime: s.startTime.toISOString(),
			durationMinutes: s.durationMinutes == null ? null : Number(s.durationMinutes),
			patient: s.patient,
			deviceCode: s.device.displayCode
		})),
		todos: [
			...pending.map((p) => ({
				key: `p-${p.id}`,
				icon: 'clipboard',
				tone: 'warning',
				title: `Create a therapy plan for ${p.displayCode}`,
				sub: 'New patient · no plan or devices yet',
				href: user.role === 'THERAPIST' ? `/patients/${p.id}?tab=plan` : `/patients/${p.id}`
			})),
			...actionable
				.filter((n) => (n.link as { page?: string } | null)?.page)
				.map((n) => ({
					key: `n-${n.id}`,
					icon: n.icon ?? 'bell',
					tone: n.tone,
					title: n.title,
					sub: n.description,
					href: `/${(n.link as { page: string }).page}`
				}))
		]
	};
};
