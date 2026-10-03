import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { isOwnerTherapist, patientScopeFor } from '$lib/server/scope';
import { auditAs } from '$lib/server/audit';
import { checkUpload } from '$lib/server/files';
import { getScale, isOffered, listScales } from '$lib/scales/registry';
import { allItems, computeScores, maxScore, primaryScoreId, validateAnswers } from '$lib/scales/evaluate';
import type { Answers } from '$lib/scales/types';

async function ownedPatient(user: NonNullable<App.Locals['user']>, id: string | null) {
	if (!id) throw error(400, 'Choose a patient first.');
	const p = await prisma.patient.findFirst({
		where: { AND: [{ id }, patientScopeFor(user)] },
		select: { id: true, name: true, displayCode: true, status: true, therapistId: true, affectedSide: true }
	});
	if (!p) throw error(404, 'Patient not found');
	// Creating assessments is primary-therapist-only.
	if (!isOwnerTherapist(user, p.therapistId)) throw error(403, 'Only the primary therapist can enter assessments for this patient.');
	return p;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireRole(locals.user, 'THERAPIST');
	const patient = await ownedPatient(user, url.searchParams.get('patient'));

	const scaleId = url.searchParams.get('scale');
	const scale = scaleId && isOffered(scaleId) ? getScale(scaleId) : null;

	// Examiners: staff at the same location, chosen from a dropdown (never typed).
	const examiners = await prisma.user.findMany({
		where: { isActive: true, role: 'THERAPIST', locationId: user.locationId },
		select: { id: true, name: true },
		orderBy: { name: 'asc' }
	});

	return {
		patient,
		scales: listScales(),
		scale,
		// the first assessment of a scale for this patient is their Baseline; nothing else needs a label
		isBaseline: scale ? (await prisma.assessment.count({ where: { patientId: patient.id, scaleId: scale.id } })) === 0 : false,
		primary: scale ? primaryScoreId(scale, patient.affectedSide) : null,
		examiners: examiners.some((e) => e.id === user.id) ? examiners : [{ id: user.id, name: user.name }, ...examiners]
	};
};

const schema = z.object({
	scaleId: z.string().min(1),
	answers: z.string().min(2).max(200_000),
	examinerId: z.string().optional(),
	assessmentDate: z
		.string()
		.min(1)
		.transform((v) => new Date(v))
		.refine((d) => !Number.isNaN(d.getTime()), 'Invalid date.'),
});

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const user = requireRole(locals.user, 'THERAPIST');
		const patient = await ownedPatient(user, url.searchParams.get('patient'));

		const fd = await request.formData();
		const parsed = schema.safeParse(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		const def = getScale(parsed.data.scaleId);
		if (!def || !isOffered(def.id)) return fail(400, { error: 'Unknown assessment scale.' });

		let answers: Answers;
		try {
			const raw = JSON.parse(parsed.data.answers);
			if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error();
			answers = raw as Answers;
		} catch {
			return fail(400, { error: 'Answers could not be read.' });
		}

		const problems = validateAnswers(def, answers);
		if (problems.length) {
			const first = problems[0];
			const label = allItems(def).find((i) => i.id === first.id)?.label ?? first.id;
			return fail(400, { error: `${label}: ${first.message}`, itemId: first.id });
		}
		if (!Object.keys(answers).length) return fail(400, { error: 'Answer at least one item.' });

		// The examiner must be an active therapist at the same location (or the user).
		let administeredById = user.id;
		if (parsed.data.examinerId && parsed.data.examinerId !== user.id) {
			const ex = await prisma.user.findFirst({
				where: { id: parsed.data.examinerId, isActive: true, role: 'THERAPIST', locationId: user.locationId },
				select: { id: true }
			});
			if (!ex) return fail(400, { error: 'Choose an examiner from the list.' });
			administeredById = ex.id;
		}

		const day = parsed.data.assessmentDate;
		const assessmentDate = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
		if (assessmentDate.getTime() > Date.now() + 24 * 3600_000) return fail(400, { error: 'The assessment date cannot be in the future.' });

		// REDCap parity: the scale's own date item carries the assessment date.
		for (const it of allItems(def)) if (it.type === 'date') answers[it.id] = assessmentDate.toISOString().slice(0, 10);

		// Scores are always recomputed from the definition — never trusted from the client.
		const primary = primaryScoreId(def, patient.affectedSide);
		const score = primary ? computeScores(def, answers)[primary] : null;
		const max = primary ? maxScore(def, primary) : null;

		const uploads = await Promise.all(
			fd
				.getAll('scans')
				.filter((f): f is File => f instanceof File && f.size > 0)
				.map(checkUpload)
		);
		const badUpload = uploads.find((u) => !u.ok);
		if (badUpload && !badUpload.ok) return fail(400, { error: badUpload.error });

		// No timepoint is chosen: a patient's first assessment of a scale is its Baseline, later ones carry no label (they are dated).
		const priorOfThisScale = await prisma.assessment.count({ where: { patientId: patient.id, scaleId: def.id } });

		const assessment = await prisma.$transaction(async (tx) => {
			const a = await tx.assessment.create({
				data: {
					patientId: patient.id,
					scaleId: def.id,
					scaleVersion: def.version,
					administeredById,
					assessmentDate,
					label: priorOfThisScale === 0 ? 'Baseline' : null,
					answers,
					scoreItem: primary,
					score,
					maxScore: max
				}
			});
			for (const u of uploads) {
				if (!u.ok) continue;
				await tx.patientDocument.create({
					data: {
						patientId: patient.id,
						assessmentId: a.id,
						name: u.name,
						docType: u.docType,
						mimeType: u.mimeType,
						sizeKb: u.sizeKb,
						data: u.data,
						uploadedById: user.id
					}
				});
			}
			return a;
		});

		await auditAs(user)({
			action: 'Assessment Created',
			entityType: 'Assessment',
			entityId: assessment.id,
			newValue: `${def.id}${score != null ? ` ${score}${max != null ? `/${max}` : ''}` : ''}${uploads.length ? ` · ${uploads.length} scan(s)` : ''}`
		});

		throw redirect(303, `/patients/${patient.id}?tab=assessments`);
	}
};
