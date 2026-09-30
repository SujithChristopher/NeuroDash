import type { PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { patientScopeFor } from '$lib/server/scope';
import { computePatientStats } from '$lib/patientStats';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireRole(locals.user, 'THERAPIST', 'CONSULTANT', 'ADMIN');
	const plans = await prisma.therapyPlan.findMany({
		where: { patient: patientScopeFor(user) },
		orderBy: { createdAt: 'desc' },
		include: {
			patient: { select: { id: true, name: true, displayCode: true } },
			dayLog: true,
			devices: { include: { deviceType: { select: { name: true } } } }
		}
	});

	return {
		rows: plans.map((pl) => {
			const st = computePatientStats({ therapyPlans: [pl] }, []);
			return {
				id: pl.id,
				patient: pl.patient,
				name: pl.name,
				status: pl.status,
				durationDays: pl.durationDays,
				currentDay: st.currentDay,
				adherence: st.adherence,
				completionPct: st.completionPct,
				devices: pl.devices.map((d) => d.deviceType.name)
			};
		})
	};
};
