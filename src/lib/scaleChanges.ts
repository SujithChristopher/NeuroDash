// How each assessment scale changed across ALL patients in the first 30 days: the analytics view.
// Day 1 is each patient's first assessment of that scale, so patients who started at different times line up.
// Pure, so the grouping and the averages are unit-tested.

export interface ScaleAssessment {
	scaleId: string;
	title: string;
	patientId: string;
	date: Date;
	score: number;
	maxScore: number;
}

/** Windows of days since the patient's first assessment of the scale; the label is the last day of the window. */
export const WINDOWS = [
	{ label: 'Day 1', from: 1, to: 1 },
	{ label: 'Day 7', from: 2, to: 7 },
	{ label: 'Day 14', from: 8, to: 14 },
	{ label: 'Day 21', from: 15, to: 21 },
	{ label: 'Day 30', from: 22, to: 30 }
] as const;

export interface ScaleChange {
	scaleId: string;
	title: string;
	/** Patients with at least one assessment in the first 30 days */
	patients: number;
	/** Average score (% of the maximum) of the patients assessed in each window; windows nobody was assessed in are left out */
	points: { label: string; meanPct: number; n: number }[];
	/**
	 * Only patients assessed at the start AND later in the 30 days: the average of their own first and latest score.
	 * Null when nobody has been assessed twice yet.
	 */
	change: { patients: number; fromPct: number; toPct: number; pctPoints: number } | null;
}

const DAY = 86400_000;
const dayKey = (d: Date) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY);
const pct = (a: ScaleAssessment) => (a.score / a.maxScore) * 100;
const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildScaleChanges(rows: ScaleAssessment[]): ScaleChange[] {
	const byScale = new Map<string, { title: string; byPatient: Map<string, ScaleAssessment[]> }>();
	for (const r of rows) {
		if (!(r.maxScore > 0)) continue;
		const g = byScale.get(r.scaleId) ?? { title: r.title, byPatient: new Map() };
		g.byPatient.set(r.patientId, [...(g.byPatient.get(r.patientId) ?? []), r]);
		byScale.set(r.scaleId, g);
	}

	const out: ScaleChange[] = [];
	for (const [scaleId, g] of byScale) {
		// one value per patient per window: their latest assessment inside it
		const perWindow = WINDOWS.map(() => [] as number[]);
		const paired: { first: number; last: number }[] = [];
		let patients = 0;

		for (const list of g.byPatient.values()) {
			list.sort((a, b) => a.date.getTime() - b.date.getTime());
			const start = dayKey(list[0].date);
			const inFirst30 = list.map((a) => ({ a, day: dayKey(a.date) - start + 1 })).filter((x) => x.day >= 1 && x.day <= 30);
			if (!inFirst30.length) continue;
			patients++;
			WINDOWS.forEach((w, i) => {
				const inWindow = inFirst30.filter((x) => x.day >= w.from && x.day <= w.to);
				if (inWindow.length) perWindow[i].push(pct(inWindow[inWindow.length - 1].a));
			});
			if (inFirst30.length >= 2 && inFirst30[0].day === 1) paired.push({ first: pct(inFirst30[0].a), last: pct(inFirst30[inFirst30.length - 1].a) });
		}
		if (!patients) continue;

		const fromPct = paired.length ? round1(mean(paired.map((p) => p.first))) : 0;
		const toPct = paired.length ? round1(mean(paired.map((p) => p.last))) : 0;
		out.push({
			scaleId,
			title: g.title,
			patients,
			points: WINDOWS.flatMap((w, i) => (perWindow[i].length ? [{ label: w.label, meanPct: round1(mean(perWindow[i])), n: perWindow[i].length }] : [])),
			change: paired.length ? { patients: paired.length, fromPct, toPct, pctPoints: round1(toPct - fromPct) } : null
		});
	}
	return out.sort((a, b) => b.patients - a.patients || a.title.localeCompare(b.title));
}
