import { prisma } from './db';
import { patientScopeFor } from './scope';
import { computePatientStats, accuracyPct } from '$lib/patientStats';
import { adherenceVerdict, detectIntent, findMentionedPatient } from '$lib/aiIntents';
import { deviceUsage } from './devices';
import { getScale } from '$lib/scales/registry';
import { utcDay } from '$lib/utils';

type User = NonNullable<App.Locals['user']>;

export interface AiAnswer {
	text: string;
	tags: ('observed' | 'calculated' | 'interpretation')[];
	facts: { label: string; value: string }[];
	links: { label: string; href: string }[];
}

const SUGGESTIONS = [
	'Which patients have low adherence?',
	'Which device has the highest utilization?',
	'Show unresolved device issues',
	'Has <patient name> improved since baseline?',
	'How many hours did <patient name> train this week?',
	'Is <patient name> following the plan?'
];

const FALLBACK: AiAnswer = {
	text:
		'I can answer questions about adherence, device utilization, open device issues, and individual patients’ progress, ' +
		'training time and plan adherence. I don’t have an answer for that — try rephrasing with one of those in mind.',
	tags: [],
	facts: SUGGESTIONS.map((s) => ({ label: 'Try', value: s })),
	links: []
};

export async function askAssistant(user: User, question: string): Promise<AiAnswer> {
	const isEngineer = user.role === 'ENGINEER';

	// Engineers get device-scoped answers only; patient records are out of their scope.
	const patients = isEngineer
		? []
		: await prisma.patient.findMany({
				where: patientScopeFor(user),
				select: { id: true, name: true, displayCode: true }
			});
	const mentioned = findMentionedPatient(question, patients);
	const intent = detectIntent(question, !!mentioned);

	if (isEngineer && intent !== 'device-ranking' && intent !== 'open-issues') {
		return {
			text: 'As an engineer I can answer device questions: utilization rankings and unresolved device issues.',
			tags: [],
			facts: [
				{ label: 'Try', value: 'Which device has the highest utilization?' },
				{ label: 'Try', value: 'Show unresolved device issues' }
			],
			links: []
		};
	}

	switch (intent) {
		case 'low-adherence':
			return lowAdherence(user);
		case 'device-ranking':
			return deviceRanking();
		case 'open-issues':
			return openIssues();
		case 'fallback':
			return FALLBACK;
		default:
			return patientAnswer(user, mentioned!.id, intent);
	}
}

async function lowAdherence(user: User): Promise<AiAnswer> {
	const patients = await prisma.patient.findMany({
		where: { ...patientScopeFor(user), status: 'Active' },
		include: { therapyPlans: { include: { dayLog: true } } }
	});
	const rows = patients
		.map((p) => ({ p, st: computePatientStats(p, []) }))
		.filter((r) => r.st.plan && r.st.adherence < 70)
		.sort((a, b) => a.st.adherence - b.st.adherence);

	if (!rows.length) {
		return { text: 'No active patients in your scope are below 70% plan adherence.', tags: ['calculated'], facts: [], links: [] };
	}
	return {
		text: `${rows.length} active patient${rows.length === 1 ? ' is' : 's are'} below 70% plan adherence.`,
		tags: ['calculated'],
		facts: rows.map((r) => ({ label: `${r.p.name} (${r.p.displayCode})`, value: `${r.st.adherence}%` })),
		links: rows.slice(0, 3).map((r) => ({ label: `View ${r.p.name}`, href: `/patients/${r.p.id}?tab=plan` }))
	};
}

async function deviceRanking(): Promise<AiAnswer> {
	const [devices, usage] = await Promise.all([
		prisma.device.findMany({ select: { id: true, displayCode: true } }),
		deviceUsage()
	]);
	const ranked = devices
		.map((d) => ({ d, n: usage.get(d.id)?.sessions ?? 0, min: usage.get(d.id)?.totalMin ?? 0 }))
		.sort((a, b) => b.n - a.n)
		.slice(0, 5);
	if (!ranked.length || ranked[0].n === 0) {
		return { text: 'No device sessions have been recorded yet, so there is nothing to rank.', tags: ['observed'], facts: [], links: [] };
	}
	return {
		text: `${ranked[0].d.displayCode} is the most-used device, with ${ranked[0].n} sessions.`,
		tags: ['observed'],
		facts: ranked.map((r) => ({ label: r.d.displayCode, value: `${r.n} sessions · ${(r.min / 60).toFixed(1)}h` })),
		links: [{ label: 'Open device usage', href: '/device-usage' }]
	};
}

async function openIssues(): Promise<AiAnswer> {
	const issues = await prisma.deviceIssue.findMany({
		where: { status: { notIn: ['Cleared', 'Resolved'] } },
		orderBy: { openedAt: 'desc' },
		include: { device: { select: { displayCode: true } } }
	});
	if (!issues.length) return { text: 'There are no unresolved device issues.', tags: ['observed'], facts: [], links: [] };
	return {
		text: `There ${issues.length === 1 ? 'is 1 unresolved device issue' : `are ${issues.length} unresolved device issues`}.`,
		tags: ['observed'],
		facts: issues.slice(0, 8).map((i) => ({
			label: `${i.device.displayCode} · ${i.severity}`,
			value: `${i.status} — ${i.description}`
		})),
		links: [{ label: 'Open issue queue', href: '/device-issues' }]
	};
}

async function patientAnswer(user: User, patientId: string, intent: string): Promise<AiAnswer> {
	const p = await prisma.patient.findFirst({
		where: { AND: [{ id: patientId }, patientScopeFor(user)] },
		include: {
			therapyPlans: { include: { dayLog: true }, orderBy: { createdAt: 'desc' } },
			assessments: { orderBy: { assessmentDate: 'asc' }, select: { scaleId: true, score: true, maxScore: true } },
			therapySessions: { orderBy: { startTime: 'asc' }, include: { device: { select: { id: true, displayCode: true } } } }
		}
	});
	if (!p) return FALLBACK;

	const sessions = p.therapySessions.map((s) => ({
		durationMinutes: s.durationMinutes == null ? null : Number(s.durationMinutes),
		accuracyPct: accuracyPct(s.totalTargets, s.totalHits),
		device: { displayCode: s.device.displayCode },
		date: s.sessionDate,
		deviceId: s.device.id
	}));
	const st = computePatientStats(p, sessions);
	const link = { label: `View ${p.name}`, href: `/patients/${p.id}` };

	if (intent === 'patient-improvement') {
		// Compare within the most recently used scored scale.
		const scored = p.assessments.filter((x) => x.score != null && x.maxScore != null);
		const scale = scored[scored.length - 1]?.scaleId;
		const a = scored.filter((x) => x.scaleId === scale);
		if (a.length < 2) {
			return {
				text: `${p.name} has ${a.length} assessment${a.length === 1 ? '' : 's'} on record — at least two are needed to compare baseline with latest.`,
				tags: ['observed'],
				facts: [],
				links: [{ label: 'Assessments', href: `/patients/${p.id}?tab=assessments` }]
			};
		}
		const first = a[0];
		const last = a[a.length - 1];
		const change = Math.round((last.score! - first.score!) * 100) / 100;
		const primary = topDevice(sessions);
		return {
			text: `${p.name} has ${change >= 0 ? 'shown improvement' : 'declined'} in ${getScale(last.scaleId)?.title ?? last.scaleId} score.`,
			tags: ['calculated', 'interpretation'],
			facts: [
				{ label: 'Baseline', value: `${first.score}/${first.maxScore}` },
				{ label: 'Latest', value: `${last.score}/${last.maxScore}` },
				{ label: 'Change', value: `${change >= 0 ? '+' : ''}${change} points` },
				{ label: 'Therapy adherence', value: st.plan ? `${st.adherence}%` : '—' },
				{ label: 'Sessions completed', value: String(st.sessionsCount) },
				{ label: 'Total therapy time', value: `${(st.totalMin / 60).toFixed(1)}h` },
				...(primary ? [{ label: 'Primary device usage', value: `${primary.code} — ${primary.n} sessions` }] : [])
			],
			links: [link, { label: 'Assessments', href: `/patients/${p.id}?tab=assessments` }]
		};
	}

	if (intent === 'patient-devices') {
		const counts = new Map<string, number>();
		for (const s of sessions) counts.set(s.device.displayCode, (counts.get(s.device.displayCode) ?? 0) + 1);
		const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
		if (!ranked.length) return { text: `${p.name} has no recorded device sessions yet.`, tags: ['observed'], facts: [], links: [link] };
		return {
			text: `${p.name} uses ${ranked[0][0]} the most (${ranked[0][1]} sessions).`,
			tags: ['observed'],
			facts: ranked.map(([code, n]) => ({ label: code, value: `${n} sessions` })),
			links: [{ label: 'Devices', href: `/patients/${p.id}?tab=devices` }]
		};
	}

	if (intent === 'patient-hours') {
		const since = utcDay();
		since.setUTCDate(since.getUTCDate() - 6);
		const week = sessions.filter((s) => s.date >= since);
		const min = week.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
		return {
			text: `In the last 7 days ${p.name} completed ${week.length} session${week.length === 1 ? '' : 's'} totalling ${(min / 60).toFixed(1)} hours.`,
			tags: ['calculated'],
			facts: [
				{ label: 'Sessions (7d)', value: String(week.length) },
				{ label: 'Minutes (7d)', value: String(Math.round(min)) }
			],
			links: [{ label: 'Sessions', href: `/patients/${p.id}?tab=sessions` }]
		};
	}

	if (intent === 'patient-adherence') {
		if (!st.plan) return { text: `${p.name} has no therapy plan yet, so adherence cannot be calculated.`, tags: ['observed'], facts: [], links: [link] };
		return {
			text: `${p.name} is ${adherenceVerdict(st.adherence)} on “${st.plan.name}” (${st.adherence}% adherence).`,
			tags: ['calculated', 'interpretation'],
			facts: [
				{ label: 'Adherence', value: `${st.adherence}%` },
				{ label: 'Plan day', value: `${st.currentDay} / ${st.plan.durationDays}` },
				{ label: 'Completed days', value: String(st.completedDays) }
			],
			links: [{ label: 'Therapy plan', href: `/patients/${p.id}?tab=plan` }]
		};
	}

	return {
		text: `Here is a summary for ${p.name}.`,
		tags: ['observed'],
		facts: [
			{ label: 'Status', value: p.status },
			{ label: 'Sessions', value: String(st.sessionsCount) },
			{ label: 'Assessments', value: String(p.assessments.length) }
		],
		links: [link]
	};
}

function topDevice(sessions: { device: { displayCode: string } }[]) {
	const counts = new Map<string, number>();
	for (const s of sessions) counts.set(s.device.displayCode, (counts.get(s.device.displayCode) ?? 0) + 1);
	const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
	return top ? { code: top[0], n: top[1] } : null;
}

export const AI_SUGGESTIONS = SUGGESTIONS;
