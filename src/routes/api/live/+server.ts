import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/server/db';
import { requireApiRole } from '$lib/server/guard';
import { readPresence } from '$lib/server/presence';
import { presenceSignature } from '$lib/ingest/presence';

/**
 * A cheap "has new device data arrived?" marker. Open dashboards poll this every few seconds and reload their data when
 * it changes, so uploads show up in the lists and charts without anyone refreshing. It only exposes a timestamp, a
 * count and who is training (patient IDs only), so it is the same for every signed-in user.
 */
export const GET: RequestHandler = async ({ locals }) => {
	requireApiRole(locals.user);
	// Only successfully imported files count: a file that keeps failing must not look like new data.
	const agg = await prisma.ingestedFile.aggregate({ where: { status: 'ok' }, _max: { ingestedAt: true }, _count: { _all: true } });
	const presence = presenceSignature(await readPresence());
	return json({ version: `${agg._max.ingestedAt?.toISOString() ?? '0'}:${agg._count._all}`, presence }, { headers: { 'cache-control': 'no-store' } });
};
