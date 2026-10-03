// What the therapist's overview shows: today's schedule (who trains, and how far along they are) and a to-do list.
import { prisma } from './db';
import { patientScopeFor } from './scope';
import { activeByCode } from './presence';
import { buildSchedule, type ScheduleInput, type ScheduleRow } from '$lib/schedule';
import { utcDay } from '$lib/utils';

type User = NonNullable<App.Locals['user']>;

export interface TodoItem {
	key: string;
	icon: string;
	tone: string;
	/** The patient ID the item is about */
	title: string;
	sub: string;
	href: string;
	action?: { label: string; href: string };
}

const DAY = 86400_000;

export async function loadOverview(user: User, now = new Date()): Promise<{ schedule: ScheduleRow[]; todos: TodoItem[] }> {
	const today = utcDay();
	const therapist = user.role === 'THERAPIST';

	// A therapist's schedule is their own patients; a consultant sees the whole centre.
	const patients = await prisma.patient.findMany({
		where: { AND: [therapist ? { therapistId: user.id } : patientScopeFor(user), { status: { in: ['Active', 'Ongoing'] } }] },
		orderBy: { displayCode: 'asc' },
		select: {
			id: true,
			displayCode: true,
			status: true,
			createdAt: true,
			_count: { select: { assessments: true } },
			therapyPlans: {
				where: { status: 'Active' },
				orderBy: { createdAt: 'desc' },
				take: 1,
				include: {
					devices: { include: { deviceType: { select: { name: true } } } }
				}
			},
			therapySessions: { where: { sessionDate: today }, select: { id: true, durationMinutes: true, totalTargets: true, totalHits: true, startTime: true } }
		}
	});

	const inSession = await activeByCode();

	// ---- schedule: patients whose active plan covers today
	const inputs: ScheduleInput[] = [];
	for (const p of patients) {
		const plan = p.therapyPlans[0];
		if (!plan) continue;
		const lastDay = new Date(plan.startDate.getTime() + (plan.durationDays - 1) * DAY);
		if (today < plan.startDate || today > lastDay) continue;
		inputs.push({
			patientId: p.id,
			code: p.displayCode,
			devices: plan.devices.map((d) => d.deviceType.name),
			plannedMinutes: plan.dailyTargetMinutes,
			sessionsToday: p.therapySessions.map((s) => ({
				id: s.id,
				minutes: s.durationMinutes == null ? null : Number(s.durationMinutes),
				targets: s.totalTargets,
				hits: s.totalHits,
				startTime: s.startTime.toISOString()
			})),
			inSession: inSession.has(p.displayCode)
		});
	}
	const schedule = buildSchedule(inputs);

	// ---- to-do (therapists only: consultants are read-only): patients who still need a plan or a first assessment
	const todos: TodoItem[] = [];
	if (therapist) {
		for (const p of patients) {
			const profile = `/patients/${p.id}`;
			if (!p.therapyPlans[0] && p.status === 'Active') {
				todos.push({ key: `plan-${p.id}`, icon: 'edit', tone: 'accent', title: p.displayCode, sub: 'Therapy plan needed · New patient', href: `${profile}?tab=plan`, action: { label: 'Create plan', href: `${profile}?tab=plan` } });
			}
			if (p._count.assessments === 0) {
				const days = Math.max(0, Math.floor((now.getTime() - p.createdAt.getTime()) / DAY));
				todos.push({ key: `base-${p.id}`, icon: 'clipboard', tone: 'info', title: p.displayCode, sub: `Assessment needed · registered ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}`, href: `/assessments/new?patient=${p.id}`, action: { label: 'New assessment', href: `/assessments/new?patient=${p.id}` } });
			}
		}
	}
	return { schedule, todos };
}
