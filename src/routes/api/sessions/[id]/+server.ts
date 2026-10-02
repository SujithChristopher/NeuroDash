import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/server/db';
import { requireApiRole } from '$lib/server/guard';
import { patientScopeFor } from '$lib/server/scope';
import { accuracyPct } from '$lib/patientStats';

export const GET: RequestHandler = async ({ locals, params }) => {
	const user = requireApiRole(locals.user, 'THERAPIST', 'CONSULTANT', 'ADMIN');

	const s = await prisma.therapySession.findFirst({
		where: { id: params.id, patient: patientScopeFor(user) },
		include: {
			patient: { select: { id: true, name: true, displayCode: true } },
			device: { select: { id: true, displayCode: true, deviceType: { select: { category: true } } } },
			trials: { orderBy: { trialNumberSession: 'asc' }, include: { game: { select: { displayLabel: true } } } },
			notes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { name: true } } } }
		}
	});
	if (!s) throw error(404, 'Session not found');

	return json({
		id: s.id,
		sessionNumber: s.sessionNumber,
		patient: s.patient,
		device: { id: s.device.id, displayCode: s.device.displayCode, category: s.device.deviceType.category },
		startTime: s.startTime,
		endTime: s.endTime,
		durationMinutes: s.durationMinutes == null ? null : Number(s.durationMinutes),
		totalTargets: s.totalTargets,
		totalHits: s.totalHits,
		totalMisses: s.totalMisses,
		totalStars: s.totalStars,
		accuracyPct: accuracyPct(s.totalTargets, s.totalHits),
		canAddNote: user.role === 'THERAPIST' || user.role === 'CONSULTANT',
		trials: s.trials.map((t) => ({
			id: t.id,
			number: t.trialNumberSession,
			type: t.trialType,
			// Known games show their name; an unnamed device game code (e.g. "SS") is shown as-is.
			label: t.game?.displayLabel ?? t.gameCode ?? t.mechanism ?? '—',
			mechanism: t.mechanism,
			durationSec: t.durationSec,
			targets: t.targets,
			hits: t.hits,
			misses: t.misses,
			stars: t.stars,
			accuracyPct: accuracyPct(t.targets, t.hits),
			rawDataRef: t.rawDataRef
		})),
		notes: s.notes.map((n) => ({
			id: n.id,
			author: n.author.name,
			text: n.text,
			imageDataUrl: n.imageDataUrl,
			createdAt: n.createdAt
		}))
	});
};
