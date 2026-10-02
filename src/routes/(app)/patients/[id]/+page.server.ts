import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import type { Prisma } from '@prisma/client';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { canModifyPlan, isOwnerTherapist, patientScopeFor } from '$lib/server/scope';
import { auditAs } from '$lib/server/audit';
import { notifyUser } from '$lib/server/notify';
import { accuracyPct } from '$lib/patientStats';
import { assessmentView } from '$lib/server/assessments';
import { syncPatientToLocalServer } from '$lib/server/patientFiles';
import { dataRoot } from '$lib/server/dataDir';
import { activeByCode } from '$lib/server/presence';
import { checkUpload } from '$lib/server/files';
import { PATIENT_STATUSES, PLAN_STATUSES } from '$lib/constants';

const patientInclude = {
	therapist: { select: { id: true, name: true, locationId: true } },
	therapyPlans: {
		orderBy: { createdAt: 'desc' },
		include: {
			dayLog: { orderBy: { dayNumber: 'asc' } },
			devices: { include: { deviceType: { select: { id: true, name: true } } } },
			revisions: {
				orderBy: { modifiedAt: 'desc' },
				include: { modifiedBy: { select: { name: true } } }
			},
			createdBy: { select: { name: true } }
		}
	},
	assessments: {
		orderBy: { assessmentDate: 'asc' },
		include: {
			administeredBy: { select: { name: true } },
			documents: { select: { id: true, name: true, docType: true, sizeKb: true } }
		}
	},
	therapySessions: {
		orderBy: [{ sessionDate: 'desc' }, { startTime: 'desc' }],
		include: {
			device: { select: { id: true, displayCode: true, deviceType: { select: { id: true, name: true, category: true, colorSeries: true } } } },
			trials: { select: { id: true, mechanism: true, gameId: true, gameCode: true, stars: true } }
		}
	},
	// Never pull `data` (the file bytes) into page loads — downloads go through /api/documents/[id].
	documents: {
		orderBy: { uploadDate: 'desc' },
		select: {
			id: true,
			name: true,
			docType: true,
			sizeKb: true,
			uploadDate: true,
			assessmentId: true,
			uploadedBy: { select: { name: true } }
		}
	},
	notes: { orderBy: { noteDate: 'desc' }, include: { author: { select: { name: true } } } },
	trainingDevices: {
		orderBy: { allocatedAt: 'asc' },
		include: { deviceType: { select: { id: true, name: true, category: true } }, allocatedBy: { select: { name: true } } }
	},
	deviceConfigs: { orderBy: [{ device: 'asc' }, { startDate: 'desc' }] }
} satisfies Prisma.PatientInclude;

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = requireRole(locals.user, 'THERAPIST', 'CONSULTANT', 'ADMIN');
	const p = await prisma.patient.findFirst({
		where: { AND: [{ id: params.id }, patientScopeFor(user)] },
		include: patientInclude
	});
	if (!p) throw error(404, 'Patient not found');

	const deviceTypes =
		user.role === 'ADMIN' || user.role === 'ENGINEER'
			? []
			: await prisma.deviceType.findMany({
					select: { id: true, name: true, category: true },
					orderBy: { name: 'asc' }
				});

	const [uploads, allDeviceTypes] = await Promise.all([
		prisma.ingestedFile.findMany({
			where: { patientCode: { equals: p.displayCode, mode: 'insensitive' } },
			orderBy: { ingestedAt: 'desc' },
			take: 20
		}),
		prisma.deviceType.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
	]);

	const owner = isOwnerTherapist(user, p.therapist.id);
	const active = (await activeByCode()).get(p.displayCode);

	return {
		liveSession: active ? { device: active.device, secondsAgo: active.secondsAgo } : null,
		perms: {
			isOwner: owner,
			// Status changes are the primary therapist's. Consultants are read-only apart from adding notes.
			canManage: owner,
			canModifyPlan: canModifyPlan(user, p.therapist),
		},
		deviceTypes,
		allDeviceTypes,
		folder: { enabled: dataRoot() !== null, path: dataRoot() ? `${p.displayCode}/` : null },
		trainingDevices: p.trainingDevices.map((d) => ({
			id: d.id,
			deviceTypeId: d.deviceTypeId,
			name: d.deviceType.name,
			category: d.deviceType.category,
			allocatedAt: d.allocatedAt.toISOString(),
			by: d.allocatedBy?.name ?? '—'
		})),
		// Devices taken out of the plan keep their recorded sessions: they stay visible here, marked as no longer in the plan.
		formerDevices: [
			...new Map(
				p.therapySessions
					.filter((x) => !p.trainingDevices.some((t) => t.deviceTypeId === x.device.deviceType.id))
					.map((x) => [x.device.deviceType.id, { deviceTypeId: x.device.deviceType.id, name: x.device.deviceType.name, category: x.device.deviceType.category }])
			).values()
		],
		deviceConfigs: p.deviceConfigs.map((c) => ({
			id: c.id,
			device: c.device,
			startDate: c.startDate.toISOString(),
			endDate: c.endDate?.toISOString() ?? null,
			totalTime: c.totalTime,
			ml: c.ml,
			ap: c.ap,
			mlap: c.mlap,
			foreArmLength: c.foreArmLength,
			upperArmLength: c.upperArmLength,
			trainingSide: c.trainingSide,
			location: c.location,
			group: c.groupName
		})),
		uploads: uploads.map((u) => ({ id: u.id, path: u.path, kind: u.kind, device: u.device, rows: u.rows, status: u.status, message: u.message, at: u.ingestedAt.toISOString() })),
		patient: {
			id: p.id,
			displayCode: p.displayCode,
			name: p.name,
			dob: p.dob?.toISOString() ?? null,
			gender: p.gender,
			contactPhone: p.contactPhone,
			emergencyContact: p.emergencyContact,
			registrationDate: p.registrationDate.toISOString(),
			diagnosis: p.diagnosis,
			affectedSide: p.affectedSide,
			strokeDate: p.strokeDate?.toISOString() ?? null,
			mobilityStatus: p.mobilityStatus,
			therapyGoals: p.therapyGoals,
			initialObservations: p.initialObservations,
			clinicalInfo: p.clinicalInfo,
			status: p.status,
			therapist: { id: p.therapist.id, name: p.therapist.name }
		},
		plans: p.therapyPlans.map((pl) => ({
			id: pl.id,
			name: pl.name,
			trainingSide: pl.trainingSide,
			status: pl.status,
			startDate: pl.startDate.toISOString(),
			durationDays: pl.durationDays,
			dailyTargetMinutes: pl.dailyTargetMinutes,
			targetSessions: pl.targetSessions,
			goals: pl.goals,
			notes: pl.notes,
			createdAt: pl.createdAt.toISOString(),
			createdBy: pl.createdBy.name,
			devices: pl.devices.map((d) => d.deviceType),
			dayLog: pl.dayLog.map((d) => ({
				dayNumber: d.dayNumber,
				logDate: d.logDate.toISOString(),
				status: d.status,
				targetMinutes: d.targetMinutes,
				actualMinutes: d.actualMinutes
			})),
			revisions: pl.revisions.map((r) => ({
				id: r.id,
				field: r.fieldChanged,
				previous: r.previousValue,
				next: r.newValue,
				by: r.modifiedBy.name,
				role: r.modifiedByRole,
				at: r.modifiedAt.toISOString(),
				reason: r.reason
			}))
		})),
		assessments: p.assessments.map(assessmentView),
		sessions: p.therapySessions.map((s) => ({
			id: s.id,
			sessionNumber: s.sessionNumber,
			date: s.sessionDate.toISOString(),
			startTime: s.startTime.toISOString(),
			endTime: s.endTime?.toISOString() ?? null,
			durationMinutes: s.durationMinutes == null ? null : Number(s.durationMinutes),
			totalTargets: s.totalTargets,
			totalHits: s.totalHits,
			totalStars: s.totalStars,
			sourceDevice: s.sourceDevice,
			accuracyPct: accuracyPct(s.totalTargets, s.totalHits),
			device: {
				id: s.device.id,
				displayCode: s.device.displayCode,
				category: s.device.deviceType.category,
				typeId: s.device.deviceType.id,
				typeName: s.device.deviceType.name,
				colorSeries: s.device.deviceType.colorSeries
			},
			trials: s.trials
		})),
		documents: p.documents.map((d) => ({
			id: d.id,
			name: d.name,
			docType: d.docType,
			sizeKb: d.sizeKb,
			uploadDate: d.uploadDate.toISOString(),
			fromAssessment: d.assessmentId != null,
			by: d.uploadedBy?.name ?? '—'
		})),
		notes: p.notes.map((n) => ({ id: n.id, author: n.author.name, date: n.noteDate.toISOString(), text: n.text }))
	};
};

/** Loads the patient within the caller's scope or throws 404 — every action starts here. */
async function scopedPatient(user: NonNullable<App.Locals['user']>, id: string) {
	const p = await prisma.patient.findFirst({
		where: { AND: [{ id }, patientScopeFor(user)] },
		include: { therapist: { select: { id: true, name: true, locationId: true } } }
	});
	if (!p) throw error(404, 'Patient not found');
	return p;
}

const dateStr = z
	.string()
	.min(1)
	.transform((v) => new Date(v))
	.refine((d) => !Number.isNaN(d.getTime()), 'Invalid date.');

const createPlanSchema = z.object({
	name: z.string().trim().max(160).optional(),
	trainingSide: z.enum(['Left', 'Right', 'Both'], { message: 'Select the affected side to train.' }),
	startDate: dateStr,
	durationDays: z.coerce.number().int().min(1).max(365),
	dailyTargetMinutes: z.coerce.number().int().min(1).max(600),
	targetSessions: z.coerce.number().int().min(1).max(1000).optional(),
	goals: z.string().optional(),
	notes: z.string().trim().max(4000).optional()
});

const editPlanSchema = z.object({
	planId: z.string().min(1),
	status: z.enum(PLAN_STATUSES),
	trainingSide: z.enum(['Left', 'Right', 'Both'], { message: 'Select the affected side to train.' }),
	dailyTargetMinutes: z.coerce.number().int().min(1).max(600),
	targetSessions: z.coerce.number().int().min(1).max(1000),
	notes: z.string().trim().max(4000).optional(),
	reason: z.string().trim().min(1, 'A reason is required for every plan change.').max(1000)
});

export const actions: Actions = {
	setStatus: async ({ request, locals, params }) => {
		const user = requireRole(locals.user, 'THERAPIST');
		const p = await scopedPatient(user, params.id);
		if (!isOwnerTherapist(user, p.therapist.id)) throw error(403, 'Only the primary therapist can change status.');

		const status = String((await request.formData()).get('status') ?? '');
		if (!(PATIENT_STATUSES as readonly string[]).includes(status)) return fail(400, { error: 'Invalid status.' });
		if (status === p.status) return { ok: true };

		await prisma.patient.update({ where: { id: p.id }, data: { status } });
		await auditAs(user)({
			action: 'Patient Status Changed',
			entityType: 'Patient',
			entityId: p.id,
			previousValue: p.status,
			newValue: status
		});
		await syncPatientToLocalServer(p.id);
		return { ok: true, message: `Status set to ${status}.` };
	},

	addNote: async ({ request, locals, params }) => {
		const user = requireRole(locals.user, 'THERAPIST', 'CONSULTANT', 'ADMIN');
		const p = await scopedPatient(user, params.id);
		const text = String((await request.formData()).get('text') ?? '').trim();
		if (!text) return fail(400, { noteError: 'Write a note first.' });
		if (text.length > 4000) return fail(400, { noteError: 'Notes are limited to 4000 characters.' });

		const note = await prisma.patientNote.create({ data: { patientId: p.id, authorId: user.id, text } });
		await auditAs(user)({ action: 'Note Added', entityType: 'Patient Note', entityId: note.id });
		return { ok: true, message: 'Note added.' };
	},

	addDocument: async ({ request, locals, params }) => {
		const user = requireRole(locals.user, 'THERAPIST');
		const p = await scopedPatient(user, params.id);
		if (!isOwnerTherapist(user, p.therapist.id)) throw error(403, 'Only the primary therapist can upload documents.');

		const files = (await request.formData())
			.getAll('document')
			.filter((f): f is File => f instanceof File && f.size > 0);
		if (!files.length) return fail(400, { docError: 'Choose a file to upload.' });

		const checked = await Promise.all(files.map(checkUpload));
		const bad = checked.find((c) => !c.ok);
		if (bad && !bad.ok) return fail(400, { docError: bad.error });

		for (const c of checked) {
			if (!c.ok) continue;
			const doc = await prisma.patientDocument.create({
				data: {
					patientId: p.id,
					name: c.name,
					docType: c.docType,
					mimeType: c.mimeType,
					sizeKb: c.sizeKb,
					data: c.data,
					uploadedById: user.id
				}
			});
			await auditAs(user)({ action: 'Document Uploaded', entityType: 'Patient Document', entityId: doc.id, newValue: doc.name });
		}
		return { ok: true, message: 'Document uploaded.' };
	},

	createPlan: async ({ request, locals, params }) => {
		const user = requireRole(locals.user, 'THERAPIST');
		const p = await scopedPatient(user, params.id);
		// Creation stays owner-only; editing uses the wider canModifyPlan.
		if (!isOwnerTherapist(user, p.therapist.id)) throw error(403, 'Only the primary therapist can create plans.');

		// One plan per patient: change it with "Modify plan" (devices, side, targets) instead of creating another.
		if (await prisma.therapyPlan.count({ where: { patientId: p.id } })) return fail(409, { planError: 'This patient already has a plan. Modify it instead.' });

		const fd = await request.formData();
		const parsed = createPlanSchema.safeParse(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')));
		if (!parsed.success) return fail(400, { planError: parsed.error.issues[0].message });
		const v = parsed.data;

		const deviceTypeIds = [...new Set(fd.getAll('deviceTypeIds').map(String))];
		if (!deviceTypeIds.length) return fail(400, { planError: 'Select at least one device.' });
		const valid = await prisma.deviceType.count({ where: { id: { in: deviceTypeIds } } });
		if (valid !== deviceTypeIds.length) return fail(400, { planError: 'Unknown device selected.' });

		const goals = (v.goals ?? '').split(';').map((s) => s.trim()).filter(Boolean);
		const start = new Date(Date.UTC(v.startDate.getUTCFullYear(), v.startDate.getUTCMonth(), v.startDate.getUTCDate()));

		const plan = await prisma.$transaction(async (tx) => {
			const created = await tx.therapyPlan.create({
				data: {
					patientId: p.id,
					name: v.name || 'Training plan',
					trainingSide: v.trainingSide,
					startDate: start,
					durationDays: v.durationDays,
					dailyTargetMinutes: v.dailyTargetMinutes,
					targetSessions: v.targetSessions ?? null,
					goals,
					notes: v.notes || null,
					status: 'Active',
					createdById: user.id,
					devices: { create: deviceTypeIds.map((deviceTypeId) => ({ deviceTypeId })) }
				}
			});
			await tx.planDayLog.createMany({
				data: Array.from({ length: v.durationDays }, (_, i) => {
					const d = new Date(start);
					d.setUTCDate(d.getUTCDate() + i);
					return {
						planId: created.id,
						dayNumber: i + 1,
						logDate: d,
						status: 'upcoming',
						targetMinutes: v.dailyTargetMinutes
					};
				})
			});
			return created;
		});

		// A plan's devices are always among the patient's allocated training devices.
		await prisma.patientDevice.createMany({
			data: deviceTypeIds.map((deviceTypeId) => ({ patientId: p.id, deviceTypeId, allocatedById: user.id })),
			skipDuplicates: true
		});
		await syncPatientToLocalServer(p.id);
		await auditAs(user)({ action: 'Plan Created', entityType: 'Therapy Plan', entityId: plan.id, newValue: plan.name });
		throw redirect(303, `/patients/${p.id}?tab=plan`);
	},

	editPlan: async ({ request, locals, params }) => {
		const user = requireRole(locals.user, 'THERAPIST');
		const p = await scopedPatient(user, params.id);
		if (!canModifyPlan(user, p.therapist)) throw error(403, 'You cannot edit this plan.');

		const fd = await request.formData();
		const parsed = editPlanSchema.safeParse(Object.fromEntries(fd));
		if (!parsed.success) return fail(400, { editError: parsed.error.issues[0].message });
		const v = parsed.data;

		const plan = await prisma.therapyPlan.findFirst({ where: { id: v.planId, patientId: p.id }, include: { devices: { select: { deviceTypeId: true } } } });
		if (!plan) throw error(404, 'Plan not found');

		// The plan's devices are the patient's training devices: adding or removing one here updates the table and patients.json.
		const deviceTypeIds = [...new Set(fd.getAll('deviceTypeIds').map(String))].sort();
		if (!deviceTypeIds.length) return fail(400, { editError: 'Select at least one device.' });
		if ((await prisma.deviceType.count({ where: { id: { in: deviceTypeIds } } })) !== deviceTypeIds.length) return fail(400, { editError: 'Unknown device selected.' });
		const hadDevices = plan.devices.map((d) => d.deviceTypeId).sort();

		const next = { status: v.status, trainingSide: v.trainingSide, dailyTargetMinutes: v.dailyTargetMinutes, targetSessions: v.targetSessions, notes: v.notes || null };
		const changes: { field: string; previous: string | null; next: string | null }[] = [];
		const diff = (field: string, a: unknown, b: unknown) => {
			if ((a ?? null) !== (b ?? null)) changes.push({ field, previous: a == null ? null : String(a), next: b == null ? null : String(b) });
		};
		diff('Plan Status', plan.status, next.status);
		diff('Side trained', plan.trainingSide, next.trainingSide);
		diff('Devices', hadDevices.join(', '), deviceTypeIds.join(', '));
		diff('Daily Target Duration (min)', plan.dailyTargetMinutes, next.dailyTargetMinutes);
		diff('Target Sessions', plan.targetSessions, next.targetSessions);
		diff('Notes', plan.notes, next.notes);
		if (!changes.length) return fail(400, { editError: 'Nothing was changed.' });

		// The plan is the patient's only plan, so its status is the patient's status: pausing, completing or discontinuing
		// the plan does the same to the patient (and so to patients.json); reactivating resumes them.
		let patientStatus: string | null = null;

		await prisma.$transaction(async (tx) => {
			if (next.status !== plan.status) {
				const trained = await tx.therapySession.count({ where: { patientId: p.id } });
				const wanted = next.status === 'Active' ? (trained > 0 ? 'Ongoing' : 'Active') : next.status;
				if (wanted !== p.status) {
					await tx.patient.update({ where: { id: p.id }, data: { status: wanted } });
					patientStatus = wanted;
				}
			}
			await tx.therapyPlan.update({ where: { id: plan.id }, data: next });
			await tx.planDevice.deleteMany({ where: { planId: plan.id, deviceTypeId: { notIn: deviceTypeIds } } });
			await tx.planDevice.createMany({ data: deviceTypeIds.map((deviceTypeId) => ({ planId: plan.id, deviceTypeId })), skipDuplicates: true });
			await tx.patientDevice.deleteMany({ where: { patientId: p.id, deviceTypeId: { notIn: deviceTypeIds } } });
			await tx.patientDevice.createMany({ data: deviceTypeIds.map((deviceTypeId) => ({ patientId: p.id, deviceTypeId, allocatedById: user.id })), skipDuplicates: true });
			if (next.dailyTargetMinutes !== plan.dailyTargetMinutes) {
				await tx.planDayLog.updateMany({
					where: { planId: plan.id, status: 'upcoming' },
					data: { targetMinutes: next.dailyTargetMinutes }
				});
			}
			await tx.planRevision.createMany({
				data: changes.map((c) => ({
					planId: plan.id,
					fieldChanged: c.field,
					previousValue: c.previous,
					newValue: c.next,
					modifiedById: user.id,
					modifiedByRole: user.role,
					reason: v.reason
				}))
			});
		});

		await auditAs(user)({
			action: 'Plan Modified',
			entityType: 'Therapy Plan',
			entityId: plan.id,
			previousValue: Object.fromEntries(changes.map((c) => [c.field, c.previous])),
			newValue: Object.fromEntries(changes.map((c) => [c.field, c.next])),
			notes: v.reason
		});

		if (patientStatus) {
			await auditAs(user)({ action: 'Patient Status Changed', entityType: 'Patient', entityId: p.id, previousValue: p.status, newValue: patientStatus, notes: `Followed the plan status (${plan.status} to ${next.status}).` });
		}
		await syncPatientToLocalServer(p.id); // patients.json: devices, side and status for the laptops

		if (!isOwnerTherapist(user, p.therapist.id)) {
			await notifyUser(p.therapist.id, {
				notifType: 'plan',
				tone: 'info',
				icon: 'edit',
				title: "Your patient's plan was edited by another therapist",
				description: `${user.name} (${user.role.toLowerCase()}) edited the therapy plan for ${p.name}: ${changes.map((c) => c.field).join(', ')}.`,
				link: { page: `patients/${p.id}?tab=plan` }
			});
		}
		return { ok: true, message: 'Plan modification saved and recorded in plan history.' };
	}
};
