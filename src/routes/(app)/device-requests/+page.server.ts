import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { auditAs } from '$lib/server/audit';
import { notifyRole, notifyUser } from '$lib/server/notify';
import { logDeviceEvent } from '$lib/server/devices';
import { REQUEST_CLEARED as CLEARED, REQUEST_PENDING as PENDING } from '$lib/constants';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireRole(locals.user, 'THERAPIST', 'ENGINEER');
	const isEngineer = user.role === 'ENGINEER';

	const requests = await prisma.deviceRequest.findMany({
		// A centre's requests are visible to its therapists; engineers see every centre's.
		where: isEngineer ? {} : { locationId: user.locationId ?? 'no-centre' },
		orderBy: { requestedAt: 'desc' },
		include: {
			location: { select: { id: true, name: true } },
			therapist: { select: { name: true } },
			deviceType: { select: { id: true, name: true, category: true } },
			engineer: { select: { name: true } }
		}
	});

	const [deviceTypes, available, centre] = await Promise.all([
		prisma.deviceType.findMany({ select: { id: true, name: true, category: true }, orderBy: { name: 'asc' } }),
		// Units in stock (not yet set up at any centre).
		isEngineer
			? prisma.device.findMany({
					where: { status: 'Available', locationId: null },
					select: { id: true, displayCode: true, deviceTypeId: true },
					orderBy: { displayCode: 'asc' }
				})
			: Promise.resolve([]),
		user.locationId ? prisma.location.findUnique({ where: { id: user.locationId }, select: { name: true } }) : Promise.resolve(null)
	]);

	return {
		isEngineer,
		centre: centre?.name ?? null,
		deviceTypes,
		available,
		requests: requests.map((r) => ({
			id: r.id,
			location: r.location,
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
	deviceTypeId: z.string().min(1, 'Choose a device type.'),
	notes: z.string().trim().max(1000).optional()
});

async function loadRequest(id: string, status: string) {
	const req = await prisma.deviceRequest.findUnique({
		where: { id },
		include: { location: true, deviceType: true }
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

		// Requests are for the therapist's centre, not for one patient.
		if (!user.locationId) return fail(400, { error: 'Your account is not assigned to a centre.' });
		const centre = await prisma.location.findUnique({ where: { id: user.locationId } });
		if (!centre) return fail(400, { error: 'Your centre was not found.' });
		const type = await prisma.deviceType.findUnique({ where: { id: parsed.data.deviceTypeId } });
		if (!type) return fail(400, { error: 'Unknown device type.' });

		const req = await prisma.deviceRequest.create({
			data: {
				locationId: centre.id,
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
			description: `${user.name} requested a ${type.name} unit for ${centre.name}.`,
			link: { page: 'device-requests' }
		});
		await auditAs(user)({
			action: 'Device Requested',
			entityType: 'Device Request',
			entityId: req.id,
			newValue: { centre: centre.name, deviceType: type.id }
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
			description: `Your requested ${req.deviceType.name} has been cleared by ${user.name} and will be set up at ${req.location.name}.`,
			link: { page: 'device-requests' }
		});
		await auditAs(user)({
			action: 'Device Cleared',
			entityType: 'Device Request',
			entityId: req.id,
			previousValue: PENDING,
			newValue: CLEARED
		});
		return { ok: true, message: 'Request cleared — ready to set up a unit.' };
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
			description: `Your ${req.deviceType.name} request for ${req.location.name} was declined by ${user.name}.`,
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
		// A therapist can never set a device up: that only happens here, by an engineer.
		const user = requireRole(locals.user, 'ENGINEER');
		const fd = await request.formData();
		const req = await loadRequest(String(fd.get('id')), CLEARED);
		const deviceId = String(fd.get('deviceId') ?? '');

		const device = await prisma.device.findUnique({ where: { id: deviceId } });
		if (!device || device.deviceTypeId !== req.deviceTypeId) return fail(400, { error: 'Choose a unit of the requested type.' });
		if (device.status !== 'Available' || device.locationId) return fail(409, { error: `${device.displayCode} is not available.` });

		await prisma.$transaction([
			prisma.device.update({ where: { id: device.id }, data: { locationId: req.locationId } }),
			prisma.deviceRequest.update({ where: { id: req.id }, data: { status: 'Assigned' } })
		]);
		await logDeviceEvent(device.id, 'assigned', `Set up at ${req.location.name} by ${user.name}.`);
		await notifyUser(req.therapistId, {
			notifType: 'device',
			tone: 'good',
			icon: 'link',
			title: 'Device set up',
			description: `${device.displayCode} has been set up at ${req.location.name}.`,
			link: { page: 'devices' }
		});
		await auditAs(user)({
			action: 'Device Set Up',
			entityType: 'Device',
			entityId: device.id,
			newValue: `Set up at ${req.location.name}`
		});
		return { ok: true, message: `${device.displayCode} set up at ${req.location.name}.` };
	}
};
