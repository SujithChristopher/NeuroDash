import type { PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { patientScopeFor } from '$lib/server/scope';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireRole(locals.user, 'THERAPIST', 'CONSULTANT', 'ADMIN');
	const where = { patient: patientScopeFor(user) };
	const [total, sessions] = await Promise.all([
		prisma.therapySession.count({ where }),
		// The list shows only date, device and duration — detail lives in the drawer.
		prisma.therapySession.findMany({
			where,
			orderBy: [{ sessionDate: 'desc' }, { startTime: 'desc' }],
			take: 40,
			include: {
				patient: { select: { name: true, displayCode: true } },
				device: { select: { displayCode: true } }
			}
		})
	]);

	return {
		total,
		rows: sessions.map((s) => ({
			id: s.id,
			sessionNumber: s.sessionNumber,
			startTime: s.startTime.toISOString(),
			durationMinutes: s.durationMinutes == null ? null : Number(s.durationMinutes),
			patient: s.patient,
			deviceCode: s.device.displayCode
		}))
	};
};
