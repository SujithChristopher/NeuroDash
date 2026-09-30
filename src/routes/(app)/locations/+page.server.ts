import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { auditAs } from '$lib/server/audit';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals.user, 'ADMIN');
	const locations = await prisma.location.findMany({
		orderBy: { name: 'asc' },
		include: { _count: { select: { users: true } } }
	});
	return { locations: locations.map((l) => ({ id: l.id, name: l.name, staff: l._count.users })) };
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
