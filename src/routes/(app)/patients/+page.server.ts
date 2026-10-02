import { activeByCode } from '$lib/server/presence';
import type { PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { patientScopeFor } from '$lib/server/scope';
import { computePatientStats } from '$lib/patientStats';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireRole(locals.user, 'THERAPIST', 'CONSULTANT', 'ADMIN');

	const [patients, deviceTypes] = await Promise.all([
		prisma.patient.findMany({
			where: patientScopeFor(user),
			orderBy: { createdAt: 'desc' },
			include: {
				therapist: { select: { id: true, name: true } },
				therapyPlans: {
					include: { dayLog: true, devices: { select: { deviceTypeId: true } } },
					orderBy: { createdAt: 'desc' }
				}
			}
		}),
		prisma.deviceType.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
	]);

	const active = await activeByCode();
	const rows = patients.map((p) => {
		const st = computePatientStats(p, []);
		return {
			id: p.id,
			name: p.name,
			displayCode: p.displayCode,
			gender: p.gender,
			dob: p.dob?.toISOString() ?? null,
			status: p.status,
			liveDevice: active.get(p.displayCode)?.device ?? null,
			therapistId: p.therapist.id,
			therapistName: p.therapist.name,
			plan: st.plan ? { name: st.plan.name, durationDays: st.plan.durationDays, currentDay: st.currentDay } : null,
			adherence: st.plan ? st.adherence : null,
			deviceTypeIds: [...new Set(p.therapyPlans.flatMap((pl) => pl.devices.map((d) => d.deviceTypeId)))]
		};
	});

	const therapists = [...new Map(rows.map((r) => [r.therapistId, r.therapistName])).entries()].map(
		([id, name]) => ({ id, name })
	);

	return { patients: rows, therapists, deviceTypes };
};
