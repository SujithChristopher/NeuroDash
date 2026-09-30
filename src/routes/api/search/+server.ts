import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/server/db';
import { patientScopeFor } from '$lib/server/scope';

/** Global search — patients (location-scoped) and devices only, per spec §8.3. */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401);
	const q = (url.searchParams.get('q') ?? '').trim();
	if (!q) return json({ patients: [], devices: [] });
	// Prisma's `contains` passes LIKE wildcards through, so a literal % or _ must be escaped.
	const like = q.replace(/[\\%_]/g, '\\$&');

	const [patients, devices] = await Promise.all([
		// Engineers have no clinical access, so patients are never returned to them.
		locals.user.role === 'ENGINEER' ? Promise.resolve([]) : prisma.patient.findMany({
			where: {
				AND: [
					patientScopeFor(locals.user),
					{
						OR: [
							{ name: { contains: like, mode: 'insensitive' } },
							{ displayCode: { contains: like, mode: 'insensitive' } }
						]
					}
				]
			},
			select: { id: true, name: true, displayCode: true, diagnosis: true },
			take: 5
		}),
		prisma.device.findMany({
			where: {
				OR: [
					{ displayCode: { contains: like, mode: 'insensitive' } },
					{ serialNumber: { contains: like, mode: 'insensitive' } }
				]
			},
			select: { id: true, displayCode: true, serialNumber: true, deviceType: { select: { category: true } } },
			take: 5
		})
	]);

	return json({ patients, devices });
};
