import type { PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireUser } from '$lib/server/guard';
import { notificationWhereFor } from '$lib/server/notifications';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals.user);
	const filter = url.searchParams.get('filter') === 'unread' ? 'unread' : 'all';
	const where = notificationWhereFor(user);

	const [items, total, unread] = await Promise.all([
		prisma.notification.findMany({
			where: filter === 'unread' ? { ...where, isRead: false } : where,
			orderBy: { createdAt: 'desc' },
			take: 100
		}),
		prisma.notification.count({ where }),
		prisma.notification.count({ where: { ...where, isRead: false } })
	]);

	return {
		filter,
		total,
		unread,
		items: items.map((n) => ({
			id: n.id,
			title: n.title,
			description: n.description,
			tone: n.tone,
			icon: n.icon,
			isRead: n.isRead,
			createdAt: n.createdAt.toISOString(),
			link: n.link as { page: string } | null
		}))
	};
};
