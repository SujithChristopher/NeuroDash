import type { PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { patientScopeFor } from '$lib/server/scope';
import { deviceUsage } from '$lib/server/devices';
import { inflowSeries, parseRange } from '$lib/server/analytics';
import { accuracyPct, computePatientStats } from '$lib/patientStats';
import { getScale } from '$lib/scales/registry';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireRole(locals.user, 'THERAPIST', 'CONSULTANT', 'ADMIN');
	const view = ['patient', 'device', 'inflow'].includes(url.searchParams.get('view') ?? '')
		? (url.searchParams.get('view') as 'patient' | 'device' | 'inflow')
		: 'patient';
	const range = parseRange(url.searchParams.get('range'));
	const patientId = url.searchParams.get('patient');

	const patients = await prisma.patient.findMany({
		where: patientScopeFor(user),
		select: { id: true, name: true, displayCode: true },
		orderBy: { name: 'asc' }
	});

	let patientReport = null;
	if (view === 'patient' && patientId) {
		const p = await prisma.patient.findFirst({
			where: { AND: [{ id: patientId }, patientScopeFor(user)] },
			include: {
				therapist: { select: { name: true } },
				therapyPlans: { include: { dayLog: true }, orderBy: { createdAt: 'desc' } },
				assessments: {
					orderBy: { assessmentDate: 'asc' },
					select: { scaleId: true, score: true, maxScore: true }
				},
				therapySessions: {
					orderBy: { startTime: 'asc' },
					include: { device: { select: { displayCode: true } } }
				}
			}
		});
		if (p) {
			const sessions = p.therapySessions.map((s) => ({
				id: s.id,
				date: s.sessionDate.toISOString().slice(0, 10),
				device: { displayCode: s.device.displayCode },
				durationMinutes: s.durationMinutes == null ? null : Number(s.durationMinutes),
				accuracyPct: accuracyPct(s.totalTargets, s.totalHits),
				targets: s.totalTargets,
				hits: s.totalHits,
				stars: s.totalStars
			}));
			const st = computePatientStats(p, sessions);
			// Baseline → latest across scored assessments of the most recently used scored scale.
			const scored = p.assessments.filter((a) => a.score != null && a.maxScore);
			const scale = scored[scored.length - 1]?.scaleId;
			const series = scored.filter((a) => a.scaleId === scale);
			const first = series[0];
			const last = series[series.length - 1];
			patientReport = {
				patient: { id: p.id, name: p.name, displayCode: p.displayCode, status: p.status, therapist: p.therapist.name },
				plan: st.plan ? { name: st.plan.name, status: st.plan.status, durationDays: st.plan.durationDays } : null,
				currentDay: st.currentDay,
				adherence: st.adherence,
				completionPct: st.completionPct,
				sessionsCount: st.sessionsCount,
				totalMin: Math.round(st.totalMin),
				devicesUsed: st.devicesUsed,
				avgAccuracy: st.avgAccuracy,
				assessment:
					first && last
						? {
								type: getScale(last.scaleId)?.title ?? last.scaleId,
								baseline: Math.round((first.score! / first.maxScore!) * 100),
								latest: Math.round((last.score! / last.maxScore!) * 100),
								baselineScore: `${first.score}/${first.maxScore}`,
								latestScore: `${last.score}/${last.maxScore}`,
								count: series.length
							}
						: null,
				sessions
			};
		}
	}

	let deviceRows: {
		id: string;
		displayCode: string;
		category: string;
		sessions: number;
		totalMin: number;
		avgAccuracy: number;
		totalStars: number;
	}[] = [];
	if (view === 'device') {
		const [devices, usage] = await Promise.all([
			prisma.device.findMany({
				select: { id: true, displayCode: true, deviceType: { select: { category: true } } },
				orderBy: { displayCode: 'asc' }
			}),
			deviceUsage()
		]);
		deviceRows = devices
			.map((d) => {
				const u = usage.get(d.id);
				return {
					id: d.id,
					displayCode: d.displayCode,
					category: d.deviceType.category,
					sessions: u?.sessions ?? 0,
					totalMin: Math.round(u?.totalMin ?? 0),
					avgAccuracy: u?.avgAccuracy ?? 0,
					totalStars: u?.totalStars ?? 0
				};
			})
			.sort((a, b) => b.totalMin - a.totalMin);
	}

	const inflow = view === 'inflow' ? await inflowSeries(user, range) : null;

	return { view, range, patientId, patients, patientReport, deviceRows, inflow };
};
