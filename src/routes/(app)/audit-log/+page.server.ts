import type { PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireRole(locals.user, 'ADMIN');

	const action = url.searchParams.get('action') ?? 'all';
	const role = url.searchParams.get('role') ?? 'all';

	const [rows, actions] = await Promise.all([
		prisma.auditLog.findMany({
			where: {
				...(action !== 'all' ? { action } : {}),
				...(role !== 'all' ? { actorRole: role } : {})
			},
			include: { actorUser: { select: { name: true } } },
			orderBy: { occurredAt: 'desc' },
			take: 100
		}),
		prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } })
	]);

	const show = (v: unknown) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

	return {
		action,
		role,
		actions: actions.map((a) => a.action),
		rows: rows.map((r) => ({
			id: r.id,
			at: r.occurredAt.toISOString(),
			user: r.actorUser?.name ?? (r.actorRole === 'SYSTEM' ? 'System' : '—'),
			role: r.actorRole,
			action: r.action,
			entityType: r.entityType,
			entityId: r.entityId,
			previous: show(r.previousValue),
			next: show(r.newValue),
			notes: r.notes
		}))
	};
};
