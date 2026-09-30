import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole, requireUser } from '$lib/server/guard';
import { generateDeviceDisplayCode } from '$lib/server/displayCode';
import { logDeviceEvent } from '$lib/server/devices';
import { auditAs } from '$lib/server/audit';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals.user);
	const [devices, types] = await Promise.all([
		prisma.device.findMany({
			orderBy: { displayCode: 'asc' },
			include: {
				deviceType: { select: { id: true, name: true, category: true } },
				currentPatient: { select: { name: true, displayCode: true } }
			}
		}),
		prisma.deviceType.findMany({ select: { id: true, name: true, category: true }, orderBy: { name: 'asc' } })
	]);

	// Engineers have minimal exposure to clinical data: they see the patient code, not the name.
	const showName = user.role !== 'ENGINEER';

	return {
		canRegister: user.role === 'ENGINEER',
		types,
		devices: devices.map((d) => ({
			id: d.id,
			displayCode: d.displayCode,
			serialNumber: d.serialNumber,
			status: d.status,
			location: d.location,
			lastSyncAt: d.lastSyncAt?.toISOString() ?? null,
			type: d.deviceType,
			patient: d.currentPatient ? (showName ? d.currentPatient.name : d.currentPatient.displayCode) : null
		}))
	};
};

const schema = z.object({
	deviceTypeId: z.string().min(1, 'Choose a device type.'),
	serialNumber: z.string().trim().min(1, 'Serial number is required.').max(80),
	firmwareVersion: z.string().trim().max(40).optional(),
	location: z.string().trim().max(120).optional()
});

export const actions: Actions = {
	register: async ({ request, locals }) => {
		const user = requireRole(locals.user, 'ENGINEER');
		const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		const v = parsed.data;

		const type = await prisma.deviceType.findUnique({ where: { id: v.deviceTypeId } });
		if (!type) return fail(400, { error: 'Unknown device type.' });

		const device = await prisma.device.create({
			data: {
				displayCode: await generateDeviceDisplayCode(type.id),
				deviceTypeId: type.id,
				serialNumber: v.serialNumber,
				firmwareVersion: v.firmwareVersion || null,
				location: v.location || null,
				status: 'Available'
			}
		});
		await logDeviceEvent(device.id, 'registered', `Registered by ${user.name}.`);
		await auditAs(user)({
			action: 'Device Registered',
			entityType: 'Device',
			entityId: device.id,
			newValue: { displayCode: device.displayCode, serialNumber: device.serialNumber }
		});
		return { ok: true, message: `${device.displayCode} registered.` };
	}
};
