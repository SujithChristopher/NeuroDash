import type { PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireUser } from '$lib/server/guard';
import { MAINTENANCE_TYPES } from '$lib/deviceEvents';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals.user);
	const [records, devices] = await Promise.all([
		prisma.deviceMaintenance.findMany({
			orderBy: { maintenanceDate: 'desc' },
			take: 200,
			include: {
				device: { select: { id: true, displayCode: true } },
				engineer: { select: { name: true } }
			}
		}),
		prisma.device.findMany({ select: { id: true, displayCode: true }, orderBy: { displayCode: 'asc' } })
	]);

	return {
		canLog: user.role === 'ENGINEER',
		devices,
		types: MAINTENANCE_TYPES,
		records: records.map((m) => ({
			id: m.id,
			device: m.device,
			type: m.maintenanceType,
			date: m.maintenanceDate.toISOString(),
			engineer: m.engineer.name,
			notes: m.notes
		}))
	};
};
