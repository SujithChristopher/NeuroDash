import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { patientScopeFor } from '$lib/server/scope';
import { auditAs } from '$lib/server/audit';
import { notifyRole, notifyUser } from '$lib/server/notify';
import { logDeviceEvent } from '$lib/server/devices';
import { REQUEST_CLEARED as CLEARED, REQUEST_PENDING as PENDING } from '$lib/constants';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireRole(locals.user, 'THERAPIST', 'ENGINEER');
	const isEngineer = user.role === 'ENGINEER';

	const requests = await prisma.deviceRequest.findMany({
		where: isEngineer ? {} : { therapistId: user.id },
		orderBy: { requestedAt: 'desc' },
		include: {
			patient: { select: { id: true, name: true, displayCode: true } },
			therapist: { select: { name: true } },
			deviceType: { select: { id: true, name: true, category: true } },
			engineer: { select: { name: true } }
		}
	});

	const [patients, deviceTypes, available] = await Promise.all([
		isEngineer
			? Promise.resolve([])
			: prisma.patient.findMany({
					where: patientScopeFor(user),
					select: { id: true, name: true, displayCode: true },
					orderBy: { name: 'asc' }
				}),
		prisma.deviceType.findMany({ select: { id: true, name: true, category: true }, orderBy: { name: 'asc' } }),
		isEngineer
			? prisma.device.findMany({
					where: { status: 'Available' },
					select: { id: true, displayCode: true, deviceTypeId: true },
					orderBy: { displayCode: 'asc' }
				})
			: Promise.resolve([])
	]);

	return {
		isEngineer,
		patients,
		deviceTypes,
		available,
		requests: requests.map((r) => ({
			id: r.id,
			patient: isEngineer ? { id: r.patient.id, name: r.patient.displayCode, displayCode: r.patient.displayCode } : r.patient,
			therapist: r.therapist.name,
			deviceType: r.deviceType,
			requestedAt: r.requestedAt.toISOString(),
			status: r.status,
			engineer: r.engineer?.name ?? null,
			notes: r.notes
		}))
	};
};

const requestSchema = z.object({
	patientId: z.string().min(1, 'Choose a patient.'),
	deviceTypeId: z.string().min(1, 'Choose a device type.'),
	notes: z.string().trim().max(1000).optional()
});

async function loadRequest(id: string, status: string) {
	const req = await prisma.deviceRequest.findUnique({
		where: { id },
		include: { patient: true, deviceType: true }
	});
	if (!req) throw error(404, 'Request not found');
	if (req.status !== status) throw error(409, `Request is "${req.status}", not "${status}".`);
	return req;
}

export const actions: Actions = {
	request: async ({ request, locals }) => {
		const user = requireRole(locals.user, 'THERAPIST');
		const parsed = requestSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		const patient = await prisma.patient.findFirst({
			where: { AND: [{ id: parsed.data.patientId }, patientScopeFor(user)] }
		});
		if (!patient) return fail(404, { error: 'Patient not found.' });
		const type = await prisma.deviceType.findUnique({ where: { id: parsed.data.deviceTypeId } });
		if (!type) return fail(400, { error: 'Unknown device type.' });

		const req = await prisma.deviceRequest.create({
			data: {
				patientId: patient.id,
				therapistId: user.id,
				deviceTypeId: type.id,
				notes: parsed.data.notes || null
			}
		});
		await notifyRole('ENGINEER', {
			notifType: 'request',
			tone: 'info',
			icon: 'box',
			title: 'New device request',
			description: `${user.name} requested a ${type.name} unit for ${patient.name}.`,
			link: { page: 'device-requests' }
		});
		await auditAs(user)({
			action: 'Device Requested',
			entityType: 'Device Request',
			entityId: req.id,
			newValue: { patient: patient.displayCode, deviceType: type.id }
		});
		return { ok: true, message: 'Device request sent to engineering for review.' };
	},

	clear: async ({ request, locals }) => {
		const user = requireRole(locals.user, 'ENGINEER');
		const req = await loadRequest(String((await request.formData()).get('id')), PENDING);
		await prisma.deviceRequest.update({
			where: { id: req.id },
			data: { status: CLEARED, engineerId: user.id, clearedAt: new Date() }
		});
		await notifyUser(req.therapistId, {
			notifType: 'device',
			tone: 'good',
			icon: 'check',
			title: 'Device cleared for use',
			description: `Your requested ${req.deviceType.name} has been cleared by ${user.name} and is being assigned to ${req.patient.name}.`,
			link: { page: 'device-requests' }
		});
		await auditAs(user)({
			action: 'Device Cleared',
			entityType: 'Device Request',
			entityId: req.id,
			previousValue: PENDING,
			newValue: CLEARED
		});
		return { ok: true, message: 'Request cleared — ready to assign a unit.' };
	},

	decline: async ({ request, locals }) => {
		const user = requireRole(locals.user, 'ENGINEER');
		const req = await loadRequest(String((await request.formData()).get('id')), PENDING);
		await prisma.deviceRequest.update({
			where: { id: req.id },
			data: { status: 'Declined', engineerId: user.id }
		});
		await notifyUser(req.therapistId, {
			notifType: 'device',
			tone: 'warning',
			icon: 'x',
			title: 'Device request declined',
			description: `Your ${req.deviceType.name} request for ${req.patient.name} was declined by ${user.name}.`,
			link: { page: 'device-requests' }
		});
		await auditAs(user)({
			action: 'Device Request Declined',
			entityType: 'Device Request',
			entityId: req.id,
			previousValue: PENDING,
			newValue: 'Declined'
		});
		return { ok: true, message: 'Request declined.' };
	},

	assign: async ({ request, locals }) => {
		// A therapist can never assign a device: the assignment is only ever created here, by an engineer.
		const user = requireRole(locals.user, 'ENGINEER');
		const fd = await request.formData();
		const req = await loadRequest(String(fd.get('id')), CLEARED);
		const deviceId = String(fd.get('deviceId') ?? '');

		const device = await prisma.device.findUnique({ where: { id: deviceId } });
		if (!device || device.deviceTypeId !== req.deviceTypeId) return fail(400, { error: 'Choose a unit of the requested type.' });
		if (device.status !== 'Available') return fail(409, { error: `${device.displayCode} is not available.` });

		await prisma.$transaction([
			prisma.device.update({ where: { id: device.id }, data: { status: 'In Use', currentPatientId: req.patientId } }),
			prisma.deviceAssignment.create({
				data: {
					deviceId: device.id,
					patientId: req.patientId,
					assignedDate: new Date(),
					status: 'In Use',
					assignedById: user.id
				}
			}),
			prisma.deviceRequest.update({ where: { id: req.id }, data: { status: 'Assigned' } })
		]);
		await logDeviceEvent(device.id, 'assigned', `Assigned to patient ${req.patient.displayCode} by ${user.name}.`);
		await notifyUser(req.therapistId, {
			notifType: 'device',
			tone: 'good',
			icon: 'link',
			title: 'Device assigned',
			description: `${device.displayCode} has been assigned to ${req.patient.name}.`,
			link: { page: `patients/${req.patientId}?tab=devices` }
		});
		await auditAs(user)({
			action: 'Device Assigned',
			entityType: 'Device',
			entityId: device.id,
			newValue: `Assigned to ${req.patient.displayCode}`
		});
		return { ok: true, message: `${device.displayCode} assigned to ${req.patient.name}.` };
	}
};
