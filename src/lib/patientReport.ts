// The patient report: devices used (time, movements / mechanisms), and how each assessment scale changed.
// Pure and serialisable. The same object is rendered live, printed, and stored as a snapshot, so it holds only plain data.
import { computePatientStats, type PlanLite } from './patientStats';

export interface ReportInput {
	patient: {
		displayCode: string;
		status: string;
		gender: string | null;
		dob: Date | null;
		affectedSide: string | null;
		strokeDate: Date | null;
		therapistName: string;
	};
	plan:
		| (PlanLite & {
				trainingSide: string | null;
				startDate: Date;
				devices: { id: string; name: string }[];
		  })
		| null;
	sessions: {
		date: Date;
		durationMinutes: number | null;
		device: { typeId: string; typeName: string; colorSeries: string | null };
		trials: { mechanism: string | null; durationSec: number | null }[];
	}[];
	assessments: { scaleId: string; title: string; date: Date; label: string | null; score: number | null; maxScore: number | null }[];
	now: Date;
	/** Limits the report to this period (inclusive, YYYY-MM-DD); omit for everything */
	period?: ReportPeriod;
}

export interface ReportPeriod {
	from: string | null;
	to: string | null;
}

export interface ReportDevice {
	typeId: string;
	name: string;
	colorSeries: string | null;
	sessions: number;
	minutes: number;
	firstDay: string | null;
	lastDay: string | null;
	/** Movements (MARS) or mechanisms (PLUTO) trained on this device, most-used first */
	movements: { code: string; trials: number; minutes: number }[];
}

export interface ReportScale {
	scaleId: string;
	title: string;
	points: { label: string; date: string; score: number; max: number; pct: number }[];
	/** Null with fewer than two scored assessments: there is no change to report yet. */
	change: { fromPct: number; toPct: number; pctPoints: number; fromScore: number; toScore: number; max: number; direction: 'improved' | 'declined' | 'unchanged' } | null;
}

export interface PatientReportData {
	generatedAt: string;
	/** The period the report covers; null = all time */
	period: ReportPeriod | null;
	patient: { displayCode: string; status: string; gender: string | null; age: number | null; affectedSide: string | null; strokeDate: string | null; therapist: string };
	plan: { status: string; trainingSide: string | null; startDate: string; durationDays: number; dailyTargetMinutes: number; devices: string[]; currentDay: number; completionPct: number; adherence: number } | null;
	totals: { sessions: number; minutes: number; devices: number };
	devices: ReportDevice[];
	scales: ReportScale[];
}

/** Free-text notes the therapist adds to a report. Saved with the snapshot. */
export interface ReportNotes {
	summary: string;
	devices: string;
	/** keyed by scale id */
	scales: Record<string, string>;
}

export const emptyNotes = (): ReportNotes => ({ summary: '', devices: '', scales: {} });

const day = (d: Date) => d.toISOString().slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;

function ageAt(dob: Date | null, now: Date) {
	if (!dob) return null;
	let a = now.getUTCFullYear() - dob.getUTCFullYear();
	if (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) a--;
	return a;
}

export function buildPatientReport(input: ReportInput): PatientReportData {
	const { patient, plan, now } = input;
	const period = input.period && (input.period.from || input.period.to) ? input.period : null;
	const inPeriod = (d: Date) => {
		const k = day(d);
		return (!period?.from || k >= period.from) && (!period?.to || k <= period.to);
	};
	// Everything below, including adherence, is about the chosen period only.
	const sessions = input.sessions.filter((s) => inPeriod(s.date));
	const assessments = input.assessments.filter((a) => inPeriod(a.date));

	// ---- devices: time and movements per training device
	const byDevice = new Map<string, ReportDevice & { moves: Map<string, { trials: number; sec: number }> }>();
	for (const s of sessions) {
		const key = s.device.typeId;
		const d = byDevice.get(key) ?? { typeId: key, name: s.device.typeName, colorSeries: s.device.colorSeries, sessions: 0, minutes: 0, firstDay: null, lastDay: null, movements: [], moves: new Map() };
		d.sessions++;
		d.minutes += s.durationMinutes ?? 0;
		const k = day(s.date);
		if (!d.firstDay || k < d.firstDay) d.firstDay = k;
		if (!d.lastDay || k > d.lastDay) d.lastDay = k;
		for (const t of s.trials) {
			if (!t.mechanism) continue;
			const m = d.moves.get(t.mechanism) ?? { trials: 0, sec: 0 };
			m.trials++;
			m.sec += t.durationSec ?? 0;
			d.moves.set(t.mechanism, m);
		}
		byDevice.set(key, d);
	}
	const devices: ReportDevice[] = [...byDevice.values()]
		.map(({ moves, ...d }) => ({
			...d,
			minutes: round1(d.minutes),
			movements: [...moves.entries()].map(([code, m]) => ({ code, trials: m.trials, minutes: round1(m.sec / 60) })).sort((a, b) => b.trials - a.trials)
		}))
		.sort((a, b) => b.minutes - a.minutes);

	// ---- assessments: one entry per scale, in the order the scales were first used
	const scored = assessments
		.filter((a) => a.score != null && a.maxScore)
		.sort((a, b) => a.date.getTime() - b.date.getTime());
	const byScale = new Map<string, { title: string; rows: typeof scored }>();
	for (const a of scored) {
		const g = byScale.get(a.scaleId) ?? { title: a.title, rows: [] };
		g.rows.push(a);
		byScale.set(a.scaleId, g);
	}
	const scales: ReportScale[] = [...byScale.entries()].map(([scaleId, g]) => {
		const points = g.rows.map((a) => ({ label: a.label ?? day(a.date), date: day(a.date), score: a.score as number, max: a.maxScore as number, pct: Math.round(((a.score as number) / (a.maxScore as number)) * 100) }));
		const first = points[0];
		const last = points[points.length - 1];
		const change =
			points.length >= 2
				? {
						fromPct: first.pct,
						toPct: last.pct,
						pctPoints: last.pct - first.pct,
						fromScore: first.score,
						toScore: last.score,
						max: last.max,
						direction: (last.pct > first.pct ? 'improved' : last.pct < first.pct ? 'declined' : 'unchanged') as 'improved' | 'declined' | 'unchanged'
					}
				: null;
		return { scaleId, title: g.title, points, change };
	});

	// ---- plan
	const stats = computePatientStats({ therapyPlans: plan ? [period ? { ...plan, dayLog: plan.dayLog.filter((l) => inPeriod(new Date(l.logDate))) } : plan] : [] }, []);

	return {
		generatedAt: now.toISOString(),
		period,
		patient: {
			displayCode: patient.displayCode,
			status: patient.status,
			gender: patient.gender,
			age: ageAt(patient.dob, now),
			affectedSide: patient.affectedSide,
			strokeDate: patient.strokeDate ? day(patient.strokeDate) : null,
			therapist: patient.therapistName
		},
		plan: plan
			? {
					status: plan.status,
					trainingSide: plan.trainingSide,
					startDate: day(plan.startDate),
					durationDays: plan.durationDays,
					dailyTargetMinutes: plan.dailyTargetMinutes,
					devices: plan.devices.map((d) => d.name),
					currentDay: stats.currentDay,
					completionPct: stats.completionPct,
					adherence: stats.adherence
				}
			: null,
		totals: { sessions: sessions.length, minutes: round1(sessions.reduce((n, s) => n + (s.durationMinutes ?? 0), 0)), devices: devices.length },
		devices,
		scales
	};
}

/** Notes arrive from a form: keep only known shapes, trimmed and length-limited. */
export function cleanNotes(raw: unknown, scaleIds: string[]): ReportNotes {
	const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 4000) : '');
	const scales: Record<string, string> = {};
	const given = (o.scales && typeof o.scales === 'object' ? o.scales : {}) as Record<string, unknown>;
	for (const id of scaleIds) {
		const t = text(given[id]);
		if (t) scales[id] = t;
	}
	return { summary: text(o.summary), devices: text(o.devices), scales };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Reads ?from=&to= safely: bad dates are ignored, and a reversed range is put the right way round. */
export function parsePeriod(from: string | null | undefined, to: string | null | undefined): ReportPeriod {
	const ok = (v: string | null | undefined) => (v && ISO_DAY.test(v) && !Number.isNaN(new Date(v + 'T00:00:00Z').getTime()) ? v : null);
	let a = ok(from);
	let b = ok(to);
	if (a && b && a > b) [a, b] = [b, a];
	return { from: a, to: b };
}
