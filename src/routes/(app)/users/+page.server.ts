import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { hashPassword } from '$lib/server/auth';
import { generateTempPassword } from '$lib/server/tempPassword';
import { generateUserDisplayCode } from '$lib/server/displayCode';
import { auditAs } from '$lib/server/audit';
import { initials } from '$lib/utils';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals.user, 'ADMIN');

	const [users, locations, patientCounts, issueCounts] = await Promise.all([
		prisma.user.findMany({
			include: { location: true },
			orderBy: [{ role: 'asc' }, { name: 'asc' }]
		}),
		prisma.location.findMany({ orderBy: { name: 'asc' } }),
		prisma.patient.groupBy({ by: ['therapistId'], _count: true }),
		prisma.deviceIssue.groupBy({
			by: ['engineerId'],
			where: { status: { notIn: ['Resolved', 'Cleared'] }, engineerId: { not: null } },
			_count: true
		})
	]);

	const patientsBy = new Map(patientCounts.map((c) => [c.therapistId, c._count]));
	const issuesBy = new Map(issueCounts.map((c) => [c.engineerId, c._count]));

	return {
		locations: locations.map((l) => ({ id: l.id, name: l.name })),
		users: users.map((u) => ({
			id: u.id,
			displayCode: u.displayCode,
			name: u.name,
			role: u.role,
			title: u.title,
			email: u.email,
			initials: u.initials,
			location: u.location?.name ?? null,
			mustResetPassword: u.mustResetPassword,
			patients: patientsBy.get(u.id) ?? 0,
			openIssues: issuesBy.get(u.id) ?? 0
		}))
	};
};

const TITLE_PREFIX = /^(dr|mr|ms|mrs|prof)\.?\s+/i;

const createSchema = z
	.object({
		name: z.string().trim().min(1, 'Name is required.').max(120),
		email: z.string().trim().toLowerCase().email('Enter a valid email.').max(254),
		role: z.enum(['THERAPIST', 'CONSULTANT', 'ENGINEER']), // never another Admin
		title: z.string().trim().max(120).optional(),
		locationId: z.string().optional()
	})
	.refine((v) => v.role === 'ENGINEER' || !!v.locationId, {
		message: 'Location is required for therapists and consultants.',
		path: ['locationId']
	});

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const admin = requireRole(locals.user, 'ADMIN');
		const parsed = createSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { createError: parsed.error.issues[0].message });
		const v = parsed.data;

		if (await prisma.user.findUnique({ where: { email: v.email } })) {
			return fail(400, { createError: 'An account with that email already exists.' });
		}
		if (v.role !== 'ENGINEER') {
			const loc = await prisma.location.findUnique({ where: { id: v.locationId! } });
			if (!loc) return fail(400, { createError: 'Selected location does not exist.' });
		}

		const tempPassword = generateTempPassword();
		const user = await prisma.user.create({
			data: {
				displayCode: await generateUserDisplayCode(v.role),
				name: v.name,
				email: v.email,
				role: v.role,
				title: v.title || null,
				initials: initials(v.name.replace(TITLE_PREFIX, '')),
				passwordHash: await hashPassword(tempPassword),
				mustResetPassword: true,
				locationId: v.role === 'ENGINEER' ? null : v.locationId
			}
		});
		await auditAs(admin)({
			action: 'User Created',
			entityType: 'User',
			entityId: user.id,
			newValue: { name: user.name, role: user.role, email: user.email }
		});

		// Shown once, never stored in plaintext, never retrievable again.
		return { tempPassword, tempFor: user.name, tempEmail: user.email, created: true };
	},

	resetPassword: async ({ request, locals }) => {
		const admin = requireRole(locals.user, 'ADMIN');
		const id = String((await request.formData()).get('id') ?? '');
		const user = await prisma.user.findUnique({ where: { id } });
		if (!user) return fail(404, { createError: 'User not found.' });

		const tempPassword = generateTempPassword();
		await prisma.user.update({
			where: { id },
			data: { passwordHash: await hashPassword(tempPassword), mustResetPassword: true }
		});
		await prisma.session.deleteMany({ where: { userId: id } });
		await auditAs(admin)({
			action: 'Password Reset',
			entityType: 'User',
			entityId: id,
			notes: `Temporary password issued for ${user.name}`
		});
		return { tempPassword, tempFor: user.name, tempEmail: user.email };
	}
};
