import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { dataRoot, ingestIntervalSeconds } from '$lib/server/dataDir';
import { laptopStatus } from '$lib/server/laptops';
import { readPresence } from '$lib/server/presence';
import { lastIngest, recentIngestedFiles, runIngest } from '$lib/server/ingest';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireRole(locals.user, 'ENGINEER', 'ADMIN');

	const [files, counts, laptops, sessionTotals] = await Promise.all([
		recentIngestedFiles(100),
		prisma.ingestedFile.groupBy({ by: ['status'], _count: { _all: true } }),
		laptopStatus(),
		prisma.therapySession.aggregate({ where: { sourceKey: { not: null } }, _count: { _all: true }, _sum: { totalStars: true } })
	]);
	const n = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
	const last = lastIngest();
	const training = (await readPresence()).filter((e) => e.active).sort((a, b) => a.secondsAgo - b.secondsAgo);

	return {
		canSync: user.role === 'ENGINEER', // Admin is view-only for device records
		configured: dataRoot() !== null,
		root: dataRoot(),
		intervalSeconds: ingestIntervalSeconds(),
		registryVersion: laptops.registryVersion,
		laptops: laptops.laptops,
		training: training.map((e) => ({ code: e.code, device: e.device, secondsAgo: e.secondsAgo })),
		totals: { ok: n('ok'), unmatched: n('unmatched'), error: n('error'), sessions: sessionTotals._count._all, stars: sessionTotals._sum.totalStars ?? 0 },
		lastRun: last ? { at: last.finishedAt, scanned: last.scanned, ingested: last.ingested, unchanged: last.unchanged, sessions: last.sessions, trials: last.trials, error: last.error ?? null } : null,
		files: files.map((f) => ({ id: f.id, path: f.path, kind: f.kind, patientCode: f.patientCode, device: f.device, rows: f.rows, status: f.status, message: f.message, at: f.ingestedAt.toISOString() }))
	};
};

export const actions: Actions = {
	sync: async ({ locals }) => {
		requireRole(locals.user, 'ENGINEER');
		const r = await runIngest();
		if (r.error) return fail(400, { error: r.error });
		const parts = [`${r.scanned} file${r.scanned === 1 ? '' : 's'} checked`, `${r.ingested} imported`, `${r.unchanged} unchanged`];
		if (r.unmatched) parts.push(`${r.unmatched} unmatched`);
		if (r.errors) parts.push(`${r.errors} with errors`);
		return { ok: true, message: `Sync finished: ${parts.join(', ')}.` };
	}
};
