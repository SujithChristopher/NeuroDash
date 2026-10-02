import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { auditAs } from '$lib/server/audit';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals.user, 'ADMIN');
	const [locations, engineers] = await Promise.all([
		prisma.location.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { users: true } } } }),
		prisma.user.findMany({ where: { role: 'ENGINEER', isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
	]);
	return { engineers, locations: locations.map((l) => ({ id: l.id, name: l.name, staff: l._count.users, engineerId: l.engineerId })) };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const admin = requireRole(locals.user, 'ADMIN');
		const parsed = z
			.object({ name: z.string().trim().min(1, 'Enter a location name.').max(120) })
			.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		if (await prisma.location.findUnique({ where: { name: parsed.data.name } })) {
			return fail(409, { error: 'A location with that name already exists.' });
		}
		const loc = await prisma.location.create({ data: { name: parsed.data.name } });
		await auditAs(admin)({
			action: 'Location Created',
			entityType: 'Location',
			entityId: loc.id,
			newValue: { name: loc.name }
		});
		return { ok: true };
	},

	// The engineer responsible for the devices at a centre ('' clears it).
	setEngineer: async ({ request, locals }) => {
		const admin = requireRole(locals.user, 'ADMIN');
		const fd = await request.formData();
		const id = String(fd.get('id') ?? '');
		const engineerId = String(fd.get('engineerId') ?? '');
		const loc = await prisma.location.findUnique({ where: { id }, include: { engineer: { select: { name: true } } } });
		if (!loc) return fail(404, { error: 'Location not found.' });
		let engineerName: string | null = null;
		if (engineerId) {
			const eng = await prisma.user.findFirst({ where: { id: engineerId, role: 'ENGINEER', isActive: true } });
			if (!eng) return fail(400, { error: 'Choose an active engineer.' });
			engineerName = eng.name;
		}
		await prisma.location.update({ where: { id }, data: { engineerId: engineerId || null } });
		await auditAs(admin)({
			action: 'Centre Engineer Set',
			entityType: 'Location',
			entityId: id,
			previousValue: loc.engineer?.name ?? 'None',
			newValue: engineerName ?? 'None'
		});
		return { ok: true };
	},

	delete: async ({ request, locals }) => {
		const admin = requireRole(locals.user, 'ADMIN');
		const id = String((await request.formData()).get('id') ?? '');
		const loc = await prisma.location.findUnique({
			where: { id },
			include: { _count: { select: { users: true } } }
		});
		if (!loc) return fail(404, { error: 'Location not found.' });
		// Block delete while any user is still assigned to it (spec §7.9 — 409).
		if (loc._count.users > 0) {
			return fail(409, {
				error: `${loc.name} still has ${loc._count.users} assigned user${loc._count.users === 1 ? '' : 's'}. Reassign them first.`
			});
		}
		await prisma.location.delete({ where: { id } });
		await auditAs(admin)({
			action: 'Location Deleted',
			entityType: 'Location',
			entityId: id,
			previousValue: { name: loc.name }
		});
		return { ok: true };
	}
};
