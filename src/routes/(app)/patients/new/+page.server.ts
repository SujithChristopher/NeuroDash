import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { dataRoot } from '$lib/server/dataDir';
import { auditAs } from '$lib/server/audit';
import { createPatientFolder } from '$lib/server/patientFiles';
import { PATIENT_ID_PATTERN } from '$lib/ingest/parse';
import { isReservedPatientId } from '$lib/ingest/patientJson';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals.user, 'THERAPIST'); // Consultant/Engineer/Admin cannot create patients
	return { folderEnabled: dataRoot() !== null };
};

const requiredDate = z
	.string()
	.min(1, 'Please enter the date of birth.')
	.transform((v) => new Date(v))
	.refine((d) => !Number.isNaN(d.getTime()) && d.getTime() <= Date.now(), 'Invalid date of birth.');

const optionalDate = z
	.string()
	.optional()
	.transform((v) => (v ? new Date(v) : null))
	.refine((d) => d === null || !Number.isNaN(d.getTime()), 'Invalid date.');

// Deliberately small: the hospital Patient ID is the only identifier (no name or contact details are collected).
const schema = z.object({
	// The ID the training devices use. It becomes the patient's folder name on the local server.
	patientId: z.string().trim().min(1, 'Please enter the Patient ID.'),
	dob: requiredDate,
	gender: z.enum(['Female', 'Male', 'Other']),
	affectedSide: z.enum(['Left', 'Right', 'Bilateral']),
	strokeDate: optionalDate
});

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const user = requireRole(locals.user, 'THERAPIST');
		const fd = await request.formData();
		const parsed = schema.safeParse(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		const v = parsed.data;

		// The therapist types the Patient ID: it must match what is entered on the training laptops.
		if (!PATIENT_ID_PATTERN.test(v.patientId)) return fail(400, { error: 'Patient ID may only use letters, digits, - and _ (up to 40 characters).' });
		if (isReservedPatientId(v.patientId)) return fail(400, { error: `"${v.patientId}" is reserved for the local server. Choose another Patient ID.` });
		if (await prisma.patient.findFirst({ where: { displayCode: { equals: v.patientId, mode: 'insensitive' } }, select: { id: true } })) {
			return fail(409, { error: `Patient ID "${v.patientId}" is already in use.` });
		}

		const patient = await prisma.patient.create({
			data: {
				displayCode: v.patientId,
				name: v.patientId, // the hospital ID is the only label
				dob: v.dob,
				gender: v.gender,
				therapistId: user.id, // creator becomes the primary therapist
				affectedSide: v.affectedSide,
				strokeDate: v.strokeDate,
				therapyGoals: [],
				status: 'Active'
			}
		});

		await auditAs(user)({
			action: 'Patient Created',
			entityType: 'Patient',
			entityId: patient.id,
			newValue: { displayCode: patient.displayCode }
		});

		// Create <data dir>/<patient ID>/ for the laptops. The patient is added to patients.json when a plan with devices is created.
		await createPatientFolder(patient.displayCode);

		throw redirect(303, `/patients/${patient.id}`);
	}
};
