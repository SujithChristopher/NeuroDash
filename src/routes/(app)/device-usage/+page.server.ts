import type { PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireUser } from '$lib/server/guard';
import { deviceUsage } from '$lib/server/devices';

export const load: PageServerLoad = async ({ locals }) => {
	requireUser(locals.user);
	const [devices, usage] = await Promise.all([
		prisma.device.findMany({
			select: { id: true, displayCode: true, deviceType: { select: { category: true } } },
			orderBy: { displayCode: 'asc' }
		}),
		deviceUsage()
	]);

	const rows = devices
		.map((d) => {
			const u = usage.get(d.id);
			return {
				id: d.id,
				displayCode: d.displayCode,
				category: d.deviceType.category,
				sessions: u?.sessions ?? 0,
				totalMin: Math.round(u?.totalMin ?? 0),
				patients: u?.patients ?? 0,
				sessionsPerWeek: u?.sessionsPerWeek ?? 0,
				lastDay: u?.lastDay ?? null
			};
		})
		.sort((a, b) => b.totalMin - a.totalMin);

	return { rows };
};
