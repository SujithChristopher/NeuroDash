import type { PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { patientScopeFor } from '$lib/server/scope';
import { getScale } from '$lib/scales/registry';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireRole(locals.user, 'THERAPIST', 'CONSULTANT', 'ADMIN');
	const rows = await prisma.assessment.findMany({
		where: { patient: patientScopeFor(user) },
		orderBy: { assessmentDate: 'desc' },
		select: {
			id: true,
			patientId: true,
			scaleId: true,
			assessmentDate: true,
			label: true,
			score: true,
			maxScore: true,
			patient: { select: { id: true, name: true, displayCode: true } },
			administeredBy: { select: { name: true } },
			_count: { select: { documents: true } }
		}
	});

	// Change vs the previous assessment of the same scale for the same patient.
	const prevScore = new Map<string, number>();
	const delta = new Map<string, number | null>();
	for (const a of [...rows].reverse()) {
		const key = `${a.patientId}:${a.scaleId}`;
		delta.set(a.id, a.score != null && prevScore.has(key) ? a.score - prevScore.get(key)! : null);
		if (a.score != null) prevScore.set(key, a.score);
	}

	return {
		rows: rows.map((a) => ({
			id: a.id,
			patient: a.patient,
			typeName: getScale(a.scaleId)?.title ?? a.scaleId,
			date: a.assessmentDate.toISOString(),
			label: a.label,
			by: a.administeredBy?.name ?? '—',
			score: a.score,
			maxScore: a.maxScore,
			percentage: a.score != null && a.maxScore ? Math.round((a.score / a.maxScore) * 100) : null,
			scans: a._count.documents,
			delta: delta.get(a.id) ?? null
		})),
		patientCount: new Set(rows.map((r) => r.patientId)).size
	};
};
