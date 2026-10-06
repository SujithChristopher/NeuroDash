// Shared by the patient page: names, ordering and the trend series of robotic assessments (PLUTO range of motion, MARS reach range).
// Pure and serialisable.

export type Ability = 'Active' | 'Passive' | 'None';

export interface RoboticResultView {
	mechanism: string;
	task: string;
	status: string;
	unit: string | null;
	romMin: number | null;
	romMax: number | null;
	romRange: number | null;
	attempts: number;
	comment: string | null;
	extra: Record<string, unknown> | null;
}

export interface RoboticAssessmentView {
	id: string;
	device: string;
	limb: string;
	timepoint: string;
	assessedAt: string;
	lockedAt: string | null;
	mechanisms: { code: string; status: string; ability: Ability }[];
	results: RoboticResultView[];
}

export const PLUTO_MECHANISMS = ['FPS', 'WFE', 'WURD', 'HOC'] as const;
export const PLUTO_TASKS = ['AROM', 'PROM', 'APROM'] as const;
export const MARS_MOVEMENTS = ['ML', 'AP', 'MLAP'] as const;

export const ROBOTIC_NAMES: Record<string, string> = {
	FPS: 'Forearm pronation / supination',
	WFE: 'Wrist flexion / extension',
	WURD: 'Wrist ulnar / radial deviation',
	HOC: 'Hand open / close',
	ML: 'Medio-lateral reach (sideways)',
	AP: 'Antero-posterior reach (forwards)',
	MLAP: 'Combined ML + AP reach',
	ARMWEIGHT: 'Arm weight support',
	DISCRETE: 'Discrete reaching'
};

export const TASK_NAMES: Record<string, string> = {
	AROM: 'Active range (AROM)',
	PROM: 'Passive range (PROM)',
	APROM: 'Assisted range (APROM)',
	DISC: 'Discrete reaching',
	ROM: 'Reach range',
	CHECK: 'Targets reached'
};

/** "A0" < "A1" < "A2" < "A10": by letter, then by number */
export function compareTimepoints(a: string, b: string): number {
	const pa = /^([A-Za-z]*)(\d*)$/.exec(a);
	const pb = /^([A-Za-z]*)(\d*)$/.exec(b);
	if (!pa || !pb) return a.localeCompare(b);
	return pa[1].localeCompare(pb[1]) || Number(pa[2] || 0) - Number(pb[2] || 0);
}

export const byTimepoint = <T extends { timepoint: string }>(list: T[]) => [...list].sort((x, y) => compareTimepoints(x.timepoint, y.timepoint));

const find = (a: RoboticAssessmentView, mechanism: string, task: string) => a.results.find((r) => r.mechanism === mechanism && r.task === task);

export interface RomPoint {
	timepoint: string;
	date: string;
	range: number;
	min: number | null;
	max: number | null;
	unit: string | null;
}

/** One PLUTO mechanism and task across timepoints (only timepoints where it was completed with a range), oldest first. */
export function romTrend(list: RoboticAssessmentView[], opts: { limb: string; mechanism: string; task: string }): RomPoint[] {
	return byTimepoint(list.filter((a) => a.device === 'PLUTO' && a.limb === opts.limb))
		.map((a) => ({ a, r: find(a, opts.mechanism, opts.task) }))
		.filter((x): x is { a: RoboticAssessmentView; r: RoboticResultView } => !!x.r && x.r.status === 'Complete' && x.r.romRange != null)
		.map(({ a, r }) => ({ timepoint: a.timepoint, date: a.assessedAt, range: r.romRange!, min: r.romMin, max: r.romMax, unit: r.unit }));
}

export interface ReachPoint {
	timepoint: string;
	date: string;
	mlCm: number;
	apCm: number;
}

/** One MARS movement across timepoints: the best sideways and forward reach, oldest first. */
export function reachTrend(list: RoboticAssessmentView[], opts: { limb: string; movement: string }): ReachPoint[] {
	return byTimepoint(list.filter((a) => a.device === 'MARS' && a.limb === opts.limb))
		.map((a) => ({ a, r: find(a, opts.movement, 'ROM') }))
		.filter((x): x is { a: RoboticAssessmentView; r: RoboticResultView } => !!x.r && x.r.status === 'Complete' && x.r.extra != null)
		.map(({ a, r }) => ({ timepoint: a.timepoint, date: a.assessedAt, mlCm: Number(r.extra!.mlCm), apCm: Number(r.extra!.apCm) }));
}

/** How a result changed since the previous timepoint of the same device and limb (null: no earlier value to compare with). */
export function changeSincePrevious(list: RoboticAssessmentView[], a: RoboticAssessmentView, mechanism: string, task: string): number | null {
	const now = find(a, mechanism, task);
	if (!now || now.status !== 'Complete' || now.romRange == null) return null;
	const earlier = byTimepoint(list.filter((x) => x.device === a.device && x.limb === a.limb && compareTimepoints(x.timepoint, a.timepoint) < 0));
	for (let i = earlier.length - 1; i >= 0; i--) {
		const r = find(earlier[i], mechanism, task);
		if (r && r.status === 'Complete' && r.romRange != null) return Math.round((now.romRange - r.romRange) * 10) / 10;
	}
	return null;
}

/** The mechanisms the patient can use, split into those moved actively and those only moved passively. */
export function usable(a: RoboticAssessmentView) {
	const real: readonly string[] = a.device === 'PLUTO' ? PLUTO_MECHANISMS : MARS_MOVEMENTS;
	const named = (ab: Ability) => a.mechanisms.filter((m) => m.ability === ab && real.includes(m.code)).map((m) => m.code);
	return { active: named('Active'), passive: named('Passive') };
}
