// Reads and checks the device goals a therapist types into a plan form (server side).
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { byTimepoint, type RoboticAssessmentView } from '$lib/roboticAssessment';
import { formatValue, goalUnit, isGoalTarget, latestMeasured, limbOf } from '$lib/planGoals';

type RoboticRow = Prisma.RoboticAssessmentGetPayload<{ include: { results: true } }>;

/** The database rows of a patient's robotic assessments as the plain views the pages and the goal logic use. */
export function toRoboticViews(rows: RoboticRow[]): RoboticAssessmentView[] {
	return rows.map((a) => ({
		id: a.id,
		device: a.deviceTypeId,
		limb: a.limb,
		timepoint: a.timepoint,
		assessedAt: a.assessedAt.toISOString(),
		lockedAt: a.lockedAt?.toISOString() ?? null,
		mechanisms: a.mechanisms as RoboticAssessmentView['mechanisms'],
		results: a.results.map((r) => ({ mechanism: r.mechanism, task: r.task, status: r.status, unit: r.unit, romMin: r.romMin, romMax: r.romMax, romRange: r.romRange, attempts: r.attempts, comment: r.comment, extra: r.extra as Record<string, unknown> | null }))
	}));
}

const draftSchema = z.object({
	deviceTypeId: z.string().min(1),
	mechanism: z.string().min(1),
	task: z.string().min(1),
	target: z.coerce.number().finite()
});
export type GoalDraft = z.infer<typeof draftSchema>;

/** The form field "deviceGoals" is a JSON list; a missing or empty field means no device goals. */
export function parseGoalDrafts(raw: FormDataEntryValue | null): { drafts: GoalDraft[] } | { error: string } {
	const text = typeof raw === 'string' ? raw.trim() : '';
	if (!text) return { drafts: [] };
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return { error: 'The device goals could not be read.' };
	}
	const parsed = z.array(draftSchema).max(24).safeParse(json);
	return parsed.success ? { drafts: parsed.data } : { error: 'The device goals could not be read.' };
}

export interface GoalRow {
	deviceTypeId: string;
	mechanism: string;
	task: string;
	unit: string | null;
	limb: string | null;
	baselineValue: number | null;
	baselineTimepoint: string | null;
	targetValue: number;
}

interface KeptGoal {
	deviceTypeId: string;
	mechanism: string;
	task: string;
	limb: string | null;
	baselineValue: number | null;
	baselineTimepoint: string | null;
}

const key = (g: { deviceTypeId: string; mechanism: string; task: string }) => `${g.deviceTypeId}|${g.mechanism}|${g.task}`;

/**
 * Turns what was typed into the goals to store. The baseline is the patient's latest measurement of that mechanism and task
 * (a goal that already existed keeps the baseline it was set with, so changing only the target does not move the starting
 * point). A target must be above the baseline: the goal is to increase the range. A goal may be set before the device has
 * assessed the patient: then it has no baseline yet and the first assessment becomes it.
 */
export async function prepareGoals(opts: {
	patientId: string;
	planDeviceIds: string[];
	trainingSide: string | null;
	affectedSide: string | null;
	drafts: GoalDraft[];
	existing?: KeptGoal[];
}): Promise<{ goals: GoalRow[] } | { error: string }> {
	if (!opts.drafts.length) return { goals: [] };

	const views = toRoboticViews(await prisma.roboticAssessment.findMany({ where: { patientId: opts.patientId }, include: { results: true } }));
	const kept = new Map((opts.existing ?? []).map((g) => [key(g), g]));
	const seen = new Set<string>();
	const goals: GoalRow[] = [];

	for (const d of opts.drafts) {
		const label = `${d.deviceTypeId} ${d.mechanism}${d.task === 'ROM' ? '' : ' ' + d.task}`;
		if (!opts.planDeviceIds.includes(d.deviceTypeId)) return { error: `${label}: ${d.deviceTypeId} is not one of the plan's devices.` };
		if (!isGoalTarget(d.deviceTypeId, d.mechanism, d.task)) return { error: `${label} cannot be a goal.` };
		if (seen.has(key(d))) return { error: `${label} is listed twice.` };
		seen.add(key(d));
		if (!(d.target > 0 && d.target <= 1000)) return { error: `${label}: the target must be a number above 0.` };

		const unit = goalUnit(d.deviceTypeId, d.mechanism);
		const before = kept.get(key(d));
		let limb = before ? before.limb : limbOf(opts.trainingSide, opts.affectedSide);
		let baselineValue = before?.baselineValue ?? null;
		let baselineTimepoint = before?.baselineTimepoint ?? null;
		if (!before) {
			const m = latestMeasured(byTimepoint(views), { device: d.deviceTypeId, limb, mechanism: d.mechanism, task: d.task });
			if (m) {
				baselineValue = m.value;
				baselineTimepoint = m.timepoint;
				limb = limb ?? m.limb;
			}
		}
		if (baselineValue != null && d.target <= baselineValue) {
			return { error: `${label}: the target must be above the current value (${formatValue(baselineValue, unit)}).` };
		}
		goals.push({ deviceTypeId: d.deviceTypeId, mechanism: d.mechanism, task: d.task, unit, limb, baselineValue, baselineTimepoint, targetValue: d.target });
	}
	return { goals };
}
