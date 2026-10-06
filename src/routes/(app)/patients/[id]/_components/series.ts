// Chart series derived from the patient payload. Pure, so it is unit-testable.
import { fmtDateShort } from '$lib/utils';

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

/** One chartable series per assessment type (score as a percentage), each with its own x-axis, so scales can be compared one graph at a time. */
export function scaleTrends(assessments: A[]) {
	const groups = new Map<string, A[]>();
	for (const a of assessments.filter((x) => x.percentage !== null)) groups.set(a.typeId, [...(groups.get(a.typeId) ?? []), a]);
	return [...groups.entries()].map(([typeId, g], i) => ({
		typeId,
		typeName: g[0].typeName,
		count: g.length,
		color: SERIES[i % SERIES.length],
		labels: g.map((a) => a.label ?? fmtDateShort(a.date)),
		data: g.map((a) => a.percentage as number)
	}));
}

// ---------------------------------------------------------------- per-device training data

export interface DeviceMeta {
	typeId: string;
	name: string;
	/** CSS colour reference such as "var(--series-2)": the same device keeps the same colour in every chart. */
	color: string;
}

export interface TrainingSession {
	date: string; // ISO; the calendar day (UTC) the session belongs to
	durationMinutes: number | null;
	totalTargets: number;
	totalHits: number;
	totalStars: number;
	device: { typeId: string; typeName: string; colorSeries: string | null };
	trials: { gameId: string | null; gameCode: string | null; mechanism: string | null }[];
}

const FALLBACK = ['series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6', 'series-7', 'series-8', 'series-9', 'series-10'];

function colorFor(typeId: string, colorSeries: string | null): string {
	if (colorSeries && /^series-\d+$/.test(colorSeries)) return `var(--${colorSeries})`;
	// Unknown device type: a stable colour derived from its id.
	let h = 0;
	for (const c of typeId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return `var(--${FALLBACK[h % FALLBACK.length]})`;
}

/** The devices a patient has trained on, most-used first. */
export function devicesOf(sessions: TrainingSession[]): DeviceMeta[] {
	const m = new Map<string, DeviceMeta & { minutes: number }>();
	for (const s of sessions) {
		const cur = m.get(s.device.typeId) ?? { typeId: s.device.typeId, name: s.device.typeName, color: colorFor(s.device.typeId, s.device.colorSeries), minutes: 0 };
		cur.minutes += s.durationMinutes ?? 0;
		m.set(s.device.typeId, cur);
	}
	return [...m.values()].sort((a, b) => b.minutes - a.minutes).map(({ typeId, name, color }) => ({ typeId, name, color }));
}

const dayKey = (iso: string) => iso.slice(0, 10);
const addDay = (k: string, n: number) => {
	const d = new Date(k + 'T00:00:00Z');
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
};

/** Every calendar day from the first to the last session, so days without training show as gaps rather than vanishing. */
export function dayRange(sessions: TrainingSession[]): string[] {
	if (!sessions.length) return [];
	const keys = sessions.map((s) => dayKey(s.date)).sort();
	const out: string[] = [];
	for (let k = keys[0]; k <= keys[keys.length - 1]; k = addDay(k, 1)) out.push(k);
	return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Therapy minutes per day, one dataset per device, for a stacked bar chart. `lastDays` keeps only the most recent
 * calendar days of the range (null = everything).
 */
export function durationByDay(sessions: TrainingSession[], devices: DeviceMeta[], lastDays: number | null = null) {
	let days = dayRange(sessions);
	if (lastDays) days = days.slice(-lastDays);
	const index = new Map(days.map((d, i) => [d, i]));
	const datasets = devices.map((d) => ({ label: d.name, color: d.color, data: days.map(() => 0) }));
	const byType = new Map(devices.map((d, i) => [d.typeId, i]));
	for (const s of sessions) {
		const di = index.get(dayKey(s.date));
		const ti = byType.get(s.device.typeId);
		if (di !== undefined && ti !== undefined) datasets[ti].data[di] += s.durationMinutes ?? 0;
	}
	for (const ds of datasets) ds.data = ds.data.map(round1);
	return { days, labels: days.map((d) => fmtDateShort(d)), datasets };
}

export interface SessionDay {
	/** 1, 2, 3...: the n-th day the patient trained, however far apart the days are */
	n: number;
	date: string;
	minutes: number;
	/** Sessions recorded that day (all devices); they count as one point on the chart */
	sessions: number;
	accuracy: number | null;
	byDevice: { name: string; minutes: number }[];
}

/** One entry per day the patient trained, oldest first: all devices together, several sessions in a day count once. */
export function sessionDays(sessions: TrainingSession[]): SessionDay[] {
	const by = new Map<string, { minutes: number; sessions: number; targets: number; hits: number; dev: Map<string, number> }>();
	for (const s of sessions) {
		const k = dayKey(s.date);
		const v = by.get(k) ?? { minutes: 0, sessions: 0, targets: 0, hits: 0, dev: new Map<string, number>() };
		v.minutes += s.durationMinutes ?? 0;
		v.sessions++;
		v.targets += s.totalTargets;
		v.hits += s.totalHits;
		v.dev.set(s.device.typeName, (v.dev.get(s.device.typeName) ?? 0) + (s.durationMinutes ?? 0));
		by.set(k, v);
	}
	return [...by.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([date, v], i) => ({
			n: i + 1,
			date,
			minutes: round1(v.minutes),
			sessions: v.sessions,
			accuracy: v.targets ? Math.round((v.hits / v.targets) * 100) : null,
			byDevice: [...v.dev.entries()].map(([name, minutes]) => ({ name, minutes: round1(minutes) })).sort((a, b) => b.minutes - a.minutes)
		}));
}

/** Average number of calendar days between one training day and the next; null until there are two. */
export function avgIntervalDays(days: Pick<SessionDay, 'date'>[]): number | null {
	if (days.length < 2) return null;
	const t = (d: string) => Date.parse(d + 'T00:00:00Z');
	return round1((t(days[days.length - 1].date) - t(days[0].date)) / 86400_000 / (days.length - 1));
}

/** Per-day accuracy, stars and minutes for ONE device. Days without a session on that device are omitted. */
export function deviceDaily(sessions: TrainingSession[], typeId: string, lastDays: number | null = null) {
	const mine = sessions.filter((s) => s.device.typeId === typeId);
	const by = new Map<string, { targets: number; hits: number; stars: number; minutes: number }>();
	for (const s of mine) {
		const k = dayKey(s.date);
		const v = by.get(k) ?? { targets: 0, hits: 0, stars: 0, minutes: 0 };
		v.targets += s.totalTargets;
		v.hits += s.totalHits;
		v.stars += s.totalStars;
		v.minutes += s.durationMinutes ?? 0;
		by.set(k, v);
	}
	let rows = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	if (lastDays) {
		const all = dayRange(mine);
		const keep = new Set(all.slice(-lastDays));
		rows = rows.filter(([k]) => keep.has(k));
	}
	return rows.map(([k, v]) => ({
		label: fmtDateShort(k),
		accuracy: v.targets ? Math.round((v.hits / v.targets) * 100) : null,
		stars: v.stars,
		minutes: round1(v.minutes)
	}));
}

/** Headline numbers for one device. */
export function deviceTotals(sessions: TrainingSession[], typeId: string) {
	const mine = sessions.filter((s) => s.device.typeId === typeId);
	const targets = mine.reduce((n, s) => n + s.totalTargets, 0);
	const hits = mine.reduce((n, s) => n + s.totalHits, 0);
	return {
		sessions: mine.length,
		minutes: round1(mine.reduce((n, s) => n + (s.durationMinutes ?? 0), 0)),
		stars: mine.reduce((n, s) => n + s.totalStars, 0),
		trials: mine.reduce((n, s) => n + s.trials.length, 0),
		accuracy: targets ? Math.round((hits / targets) * 1000) / 10 : null
	};
}

/** How often each key (game, mechanism) appears among one device's trials. */
export function countTrials(sessions: TrainingSession[], typeId: string, pick: (t: TrainingSession['trials'][number]) => string | null) {
	const m = new Map<string, number>();
	for (const s of sessions) {
		if (s.device.typeId !== typeId) continue;
		for (const t of s.trials) {
			const k = pick(t);
			if (k) m.set(k, (m.get(k) ?? 0) + 1);
		}
	}
	return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
