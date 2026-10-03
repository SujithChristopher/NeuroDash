import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { notificationWhereFor } from '$lib/server/notifications';
import { inflowSeries, parseRange, programStats } from '$lib/server/analytics';
import { loadOverview } from '$lib/server/overview';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user;
	if (!user) throw redirect(302, '/login');
	// Engineer/Admin have no home concept — their nav starts at /analytics.
	if (user.role === 'ENGINEER' || user.role === 'ADMIN') throw redirect(302, '/analytics');

	const range = parseRange(url.searchParams.get('range'));

	const [program, inflow, overview, actionable] = await Promise.all([
		programStats(user),
		inflowSeries(user, range),
		loadOverview(user),
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
		schedule: overview.schedule,
		todos: [
			...overview.todos,
			...actionable
				.filter((n) => (n.link as { page?: string } | null)?.page)
				.map((n) => ({
					key: `n-${n.id}`,
					icon: n.icon ?? 'bell',
					tone: n.tone,
					title: n.title,
					sub: n.description,
					href: `/${(n.link as { page: string }).page}`,
					action: undefined
				}))
		]
	};
};
