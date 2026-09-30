import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { generatePatientDisplayCode } from '$lib/server/displayCode';
import { auditAs } from '$lib/server/audit';
import { checkUpload } from '$lib/server/files';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals.user, 'THERAPIST'); // Consultant/Engineer/Admin cannot create patients
	return {};
};

const optionalDate = z
	.string()
	.optional()
	.transform((v) => (v ? new Date(v) : null))
	.refine((d) => d === null || !Number.isNaN(d.getTime()), 'Invalid date.');

const schema = z.object({
	name: z.string().trim().min(1, 'Please enter the patient’s full name.').max(120),
	dob: optionalDate,
	gender: z.string().trim().max(40).optional(),
	contactPhone: z.string().trim().max(60).optional(),
	emergencyContact: z.string().trim().max(200).optional(),
	clinicalInfo: z.string().trim().max(2000).optional(),
	notes: z.string().trim().max(4000).optional(),
	diagnosis: z.string().trim().max(200).optional(),
	affectedSide: z.string().trim().max(40).optional(),
	strokeDate: optionalDate,
	mobilityStatus: z.string().trim().max(120).optional(),
	therapyGoals: z.string().optional(),
	initialObservations: z.string().trim().max(4000).optional()
});

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const user = requireRole(locals.user, 'THERAPIST');
		const fd = await request.formData();
		const parsed = schema.safeParse(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		const v = parsed.data;

		const goals = (v.therapyGoals ?? '')
			.split(';')
			.map((s) => s.trim())
			.filter(Boolean);

		const uploads = await Promise.all(
			fd
				.getAll('documents')
				.filter((f): f is File => f instanceof File && f.size > 0)
				.map(checkUpload)
		);
		const badUpload = uploads.find((u) => !u.ok);
		if (badUpload && !badUpload.ok) return fail(400, { error: badUpload.error });

		const patient = await prisma.patient.create({
			data: {
				displayCode: await generatePatientDisplayCode(),
				name: v.name,
				dob: v.dob,
				gender: v.gender || null,
				contactPhone: v.contactPhone || null,
				emergencyContact: v.emergencyContact || null,
				therapistId: user.id, // creator becomes the primary therapist
				diagnosis: v.diagnosis || null,
				affectedSide: v.affectedSide || null,
				strokeDate: v.strokeDate,
				mobilityStatus: v.mobilityStatus || null,
				therapyGoals: goals.length ? goals : ['To be determined at initial assessment'],
				initialObservations: v.initialObservations || null,
				clinicalInfo: v.clinicalInfo || null,
				status: 'Assessment Pending',
				documents: {
					create: uploads.flatMap((u) =>
						u.ok
							? [{ name: u.name, docType: u.docType, mimeType: u.mimeType, sizeKb: u.sizeKb, data: u.data, uploadedById: user.id }]
							: []
					)
				},
				...(v.notes ? { notes: { create: { authorId: user.id, text: v.notes } } } : {})
			}
		});

		await auditAs(user)({
			action: 'Patient Created',
			entityType: 'Patient',
			entityId: patient.id,
			newValue: { name: patient.name, displayCode: patient.displayCode }
		});

		throw redirect(303, `/patients/${patient.id}`);
	}
};
