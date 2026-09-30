import type { PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireUser } from '$lib/server/guard';

export const load: PageServerLoad = async ({ locals }) => {
	requireUser(locals.user);
	const events = await prisma.deviceEvent.findMany({
		orderBy: { eventDate: 'desc' },
		take: 100,
		include: { device: { select: { id: true, displayCode: true } } }
	});
	return {
		events: events.map((e) => ({
			id: e.id,
			date: e.eventDate.toISOString(),
			type: e.eventType,
			description: e.description,
			device: e.device
		}))
	};
};
