// Device goals of a therapy plan: a target range typed by the therapist for one mechanism and task of one device. The baseline is
// the patient's latest robotic result when the goal is set; every later robotic assessment shows how far along the goal is. Only
// like is compared with like: the same device, limb, mechanism and task. Pure and serialisable (server and browser).
import { compareTimepoints, MARS_MOVEMENTS, PLUTO_MECHANISMS, PLUTO_TASKS, type RoboticAssessmentView } from './roboticAssessment';

/** What a goal can be about, per device. PLUTO: a mechanism and a task; MARS: a movement (its reach range). */
export const GOAL_OPTIONS: Record<string, { mechanisms: readonly string[]; tasks: readonly string[] }> = {
	PLUTO: { mechanisms: PLUTO_MECHANISMS, tasks: PLUTO_TASKS },
	MARS: { mechanisms: MARS_MOVEMENTS, tasks: ['ROM'] }
};

export const goalDevices = () => Object.keys(GOAL_OPTIONS);

export function isGoalTarget(device: string, mechanism: string, task: string): boolean {
	const o = GOAL_OPTIONS[device];
	return !!o && o.mechanisms.includes(mechanism) && o.tasks.includes(task);
}

/** A goal row in the plan form: what the therapist typed (an empty target is ignored) */
export interface GoalDraftForm {
	deviceTypeId: string;
	mechanism: string;
	task: string;
	target: string;
}

export interface GoalLike {
	deviceTypeId: string;
	mechanism: string;
	task: string;
	/** left | right | null (null: whichever limb was assessed) */
	limb: string | null;
	baselineValue: number | null;
	baselineTimepoint: string | null;
	targetValue: number;
}

export interface Measured {
	value: number;
	unit: string | null;
	timepoint: string;
	date: string;
	limb: string;
}

/** The limb a plan trains, as the assessments name it (null when it trains both or the side is unknown). */
export function limbOf(trainingSide: string | null | undefined, affectedSide?: string | null): string | null {
	const s = (trainingSide ?? '').toLowerCase();
	if (s === 'left' || s === 'right') return s;
	if (s === 'both') return null;
	const a = (affectedSide ?? '').toLowerCase();
	return a === 'left' || a === 'right' ? a : null;
}

/** Every completed measurement of one mechanism and task on one device, oldest timepoint first. */
export function measurements(list: RoboticAssessmentView[], opts: { device: string; limb: string | null; mechanism: string; task: string }): Measured[] {
	return list
		.filter((a) => a.device === opts.device && (!opts.limb || a.limb === opts.limb))
		.sort((x, y) => compareTimepoints(x.timepoint, y.timepoint))
		.flatMap((a) => {
			const r = a.results.find((x) => x.mechanism === opts.mechanism && x.task === opts.task);
			return r && r.status === 'Complete' && r.romRange != null ? [{ value: r.romRange, unit: r.unit, timepoint: a.timepoint, date: a.assessedAt, limb: a.limb }] : [];
		});
}

/** The patient's latest value for a goal that is about to be set (null when that was never measured). */
export function latestMeasured(list: RoboticAssessmentView[], opts: { device: string; limb: string | null; mechanism: string; task: string }): Measured | null {
	const all = measurements(list, opts);
	return all.length ? all[all.length - 1] : null;
}

export type GoalState = 'no-data' | 'not-measured' | 'declined' | 'progressing' | 'achieved';

export interface GoalProgress {
	state: GoalState;
	baseline: Measured | null;
	/** The newest measurement after the baseline, null until the patient is assessed again */
	latest: Measured | null;
	target: number;
	/** latest minus baseline */
	change: number | null;
	/** How much of the way from baseline to target is done: 0 to 100 (can pass 100 only as "achieved") */
	percent: number | null;
	/** Every measurement from the baseline on, for the dots under the bar */
	points: Measured[];
}

/**
 * Where a goal stands. The baseline is the value stored when the goal was set; when there was none, the first assessment that
 * measures it becomes the baseline. "Latest" is the newest measurement after that, so it is empty until the next assessment.
 */
export function goalProgress(goal: GoalLike, list: RoboticAssessmentView[]): GoalProgress {
	const all = measurements(list, { device: goal.deviceTypeId, limb: goal.limb, mechanism: goal.mechanism, task: goal.task });
	let baseline: Measured | null = null;
	let after: Measured[] = all;

	if (goal.baselineValue != null && goal.baselineTimepoint) {
		const bt = goal.baselineTimepoint;
		baseline = all.find((m) => m.timepoint === bt) ?? { value: goal.baselineValue, unit: all[0]?.unit ?? null, timepoint: bt, date: '', limb: goal.limb ?? '' };
		after = all.filter((m) => compareTimepoints(m.timepoint, bt) > 0);
	} else if (all.length) {
		baseline = all[0];
		after = all.slice(1);
	}

	const base = {
		baseline,
		target: goal.targetValue,
		points: baseline ? [baseline, ...after] : []
	};
	if (!baseline) return { ...base, state: 'no-data', latest: null, change: null, percent: null };

	const latest = after.length ? after[after.length - 1] : null;
	if (!latest) return { ...base, state: 'not-measured', latest: null, change: null, percent: 0 };

	const change = Math.round((latest.value - baseline.value) * 10) / 10;
	const span = goal.targetValue - baseline.value;
	const percent = span > 0 ? Math.max(0, Math.min(100, Math.round(((latest.value - baseline.value) / span) * 100))) : latest.value >= goal.targetValue ? 100 : 0;
	const state: GoalState = latest.value >= goal.targetValue ? 'achieved' : latest.value < baseline.value ? 'declined' : 'progressing';
	return { ...base, state, latest, change, percent };
}

/** "49.9°" / "46.6 cm" */
export function formatValue(value: number, unit: string | null): string {
	const v = String(Math.round(value * 10) / 10);
	return unit === 'deg' ? `${v}°` : unit ? `${v} ${unit}` : v;
}

export const goalUnit = (device: string, mechanism: string): string | null => (device === 'MARS' ? 'cm' : mechanism === 'HOC' ? null : 'deg');

/** A short description for the plan history, e.g. "PLUTO FPS AROM: target 85°" */
export function describeGoal(g: { deviceTypeId: string; mechanism: string; task: string; targetValue: number; unit: string | null }): string {
	return `${g.deviceTypeId} ${g.mechanism}${g.task === 'ROM' ? '' : ' ' + g.task}: target ${formatValue(g.targetValue, g.unit)}`;
}
