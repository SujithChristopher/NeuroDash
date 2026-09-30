// Chart series derived from the patient payload. Pure, so it is unit-testable.
import { fmtDateShort } from '$lib/utils';
import type { DayLogLite } from '$lib/patientStats';

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'];

interface A {
	typeId: string;
	typeName: string;
	label: string | null;
	date: string;
	percentage: number | null;
}

/** One line per assessment type, score as a percentage; x-axis labels come from the longest series. */
export function assessmentSeries(assessments: A[]) {
	const groups = new Map<string, A[]>();
	// Only scales with a headline score can be charted.
	for (const a of assessments.filter((x) => x.percentage !== null)) groups.set(a.typeId, [...(groups.get(a.typeId) ?? []), a]);
	const list = [...groups.values()];
	const longest = list.reduce<A[]>((m, g) => (g.length > m.length ? g : m), []);
	return {
		labels: longest.map((a) => a.label ?? fmtDateShort(a.date)),
		datasets: list.map((g, i) => ({
			label: g[0].typeName,
			data: g.map((a) => a.percentage as number),
			color: SERIES[i % SERIES.length]
		}))
	};
}

export function activitySeries(dayLog: DayLogLite[]) {
	const elapsed = dayLog.filter((d) => d.status !== 'upcoming');
	return {
		labels: elapsed.map((d) => 'D' + d.dayNumber),
		actual: elapsed.map((d) => d.actualMinutes),
		target: elapsed.map((d) => d.targetMinutes)
	};
}

interface S {
	date: string;
	totalTargets: number;
	totalHits: number;
	totalStars: number;
}

/** Accuracy/stars per calendar day (UTC) over the elapsed plan days. */
export function daySeries(dayLog: DayLogLite[], sessions: S[]) {
	const byDay = new Map<string, { targets: number; hits: number; stars: number }>();
	for (const s of sessions) {
		const k = s.date.slice(0, 10);
		const v = byDay.get(k) ?? { targets: 0, hits: 0, stars: 0 };
		v.targets += s.totalTargets;
		v.hits += s.totalHits;
		v.stars += s.totalStars;
		byDay.set(k, v);
	}
	return dayLog
		.filter((d) => d.status !== 'upcoming')
		.map((d) => {
			const v = byDay.get(new Date(d.logDate).toISOString().slice(0, 10));
			return {
				day: d.dayNumber,
				accuracy: v && v.targets ? Math.round((v.hits / v.targets) * 100) : null,
				stars: v?.stars ?? 0
			};
		});
}
