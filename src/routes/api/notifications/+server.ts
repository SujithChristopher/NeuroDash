import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/server/db';
import { notificationWhereFor } from '$lib/server/notifications';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401);
	const take = Math.min(Number(url.searchParams.get('limit')) || 30, 100);
	const where = notificationWhereFor(locals.user);
	const [items, unread] = await Promise.all([
		prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take }),
		prisma.notification.count({ where: { ...where, isRead: false } })
	]);
	return json({ items, unread });
};
