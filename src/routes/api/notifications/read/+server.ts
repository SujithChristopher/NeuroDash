import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/server/db';
import { notificationWhereFor } from '$lib/server/notifications';

/** Body `{ id }` marks one notification read; no id marks all of mine read. */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401);
	const body = (await request.json().catch(() => ({}))) as { id?: string };
	await prisma.notification.updateMany({
		where: { ...notificationWhereFor(locals.user), ...(body.id ? { id: body.id } : {}) },
		data: { isRead: true }
	});
	return json({ ok: true });
};
