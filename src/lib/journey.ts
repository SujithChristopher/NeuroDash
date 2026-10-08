// The session journey: a winding path with one node per day the patient actually trained, numbered 1, 2, 3 in order (several
// sessions on one day are one node; days without training are not shown). Assessments appear as small flags between the nodes,
// at the point in the journey where they happened. Pure (no clock, no DOM): the steps and the path geometry are unit-tested.
import { levelFor, type AttendanceLevel } from './attendance';

export interface JourneySession {
	id: string;
	/** ISO date or date-time; the calendar day (UTC) the session belongs to */
	date: string;
	startTime: string;
	durationMinutes: number | null;
	totalTargets: number;
	totalHits: number;
	device: { typeName: string };
}

export interface JourneyMilestone {
	kind: 'clinical' | 'robotic';
	label: string;
	date: string;
}

export interface SessionStep {
	type: 'session';
	/** 1, 2, 3 ...: the n-th day the patient trained */
	n: number;
	date: string;
	minutes: number;
	/** Sessions recorded that day (all devices) */
	sessions: number;
	accuracy: number | null;
	/** 1 to 4: how much of the daily target was trained (a day with a session never shows as "none") */
	level: Exclude<AttendanceLevel, 0>;
	byDevice: { name: string; minutes: number }[];
	/** The last session of the day, to open its detail */
	sessionId: string;
}

export interface MilestoneStep {
	type: 'milestone';
	date: string;
	items: { kind: JourneyMilestone['kind']; label: string }[];
	caption: string;
}

export type JourneyStep = SessionStep | MilestoneStep;

const day = (iso: string) => iso.slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The steps in order: a node for every training day, and a flag for the assessments of each date, placed before the first training
 * day on or after that date (an assessment on the same day as a session came first), or at the end when nothing was trained since.
 */
export function buildJourney(input: { sessions: JourneySession[]; milestones: JourneyMilestone[]; targetMinutes: number }): JourneyStep[] {
	const byDay = new Map<string, JourneySession[]>();
	for (const s of [...input.sessions].sort((a, b) => a.startTime.localeCompare(b.startTime))) {
		const k = day(s.date);
		byDay.set(k, [...(byDay.get(k) ?? []), s]);
	}

	const sessionSteps: SessionStep[] = [...byDay.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([date, list], i) => {
			const minutes = list.reduce((n, s) => n + (s.durationMinutes ?? 0), 0);
			const targets = list.reduce((n, s) => n + s.totalTargets, 0);
			const hits = list.reduce((n, s) => n + s.totalHits, 0);
			const dev = new Map<string, number>();
			for (const s of list) dev.set(s.device.typeName, (dev.get(s.device.typeName) ?? 0) + (s.durationMinutes ?? 0));
			return {
				type: 'session' as const,
				n: i + 1,
				date,
				minutes: round1(minutes),
				sessions: list.length,
				accuracy: targets ? Math.round((hits / targets) * 100) : null,
				level: Math.max(1, levelFor(minutes, input.targetMinutes)) as SessionStep['level'],
				byDevice: [...dev.entries()].map(([name, m]) => ({ name, minutes: round1(m) })).sort((a, b) => b.minutes - a.minutes),
				sessionId: list[list.length - 1].id
			};
		});

	const flags = new Map<string, MilestoneStep>();
	for (const m of [...input.milestones].sort((a, b) => a.date.localeCompare(b.date))) {
		const k = day(m.date);
		const f = flags.get(k) ?? { type: 'milestone' as const, date: k, items: [], caption: '' };
		f.items.push({ kind: m.kind, label: m.label });
		flags.set(k, f);
	}
	for (const f of flags.values()) f.caption = f.items.length === 1 ? f.items[0].label : `${f.items.length} assessments`;

	const steps: JourneyStep[] = [];
	const pending = [...flags.values()].sort((a, b) => a.date.localeCompare(b.date));
	for (const s of sessionSteps) {
		while (pending.length && pending[0].date <= s.date) steps.push(pending.shift()!);
		steps.push(s);
	}
	steps.push(...pending);
	return steps;
}

// ---------------------------------------------------------------------------------------------------------------- geometry

export interface Point {
	x: number;
	y: number;
}

export interface PathLayout {
	points: Point[];
	/** SVG path through every point, smooth, with a wide turn at the end of each row */
	d: string;
	height: number;
}

/** A smooth curve through the points (Catmull-Rom turned into cubic Béziers). */
export function smoothPath(pts: Point[]): string {
	if (!pts.length) return '';
	if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
	let d = `M${r(pts[0].x)},${r(pts[0].y)}`;
	for (let i = 0; i < pts.length - 1; i++) {
		const p0 = pts[i - 1] ?? pts[i];
		const p1 = pts[i];
		const p2 = pts[i + 1];
		const p3 = pts[i + 2] ?? p2;
		const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
		const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
		d += ` C${r(c1.x)},${r(c1.y)} ${r(c2.x)},${r(c2.y)} ${r(p2.x)},${r(p2.y)}`;
	}
	return d;
}
const r = (n: number) => Math.round(n * 10) / 10;

/**
 * Lays `count` steps out as a snake: rows alternate left to right and right to left, joined by a wide turn, with a gentle wave so
 * the path winds. `perRow` steps per row; `width` is the drawing width in pixels.
 */
export function layoutPath(count: number, opts: { width: number; perRow: number; rowHeight?: number; padX?: number; maxGap?: number }): PathLayout {
	const rowHeight = opts.rowHeight ?? 104;
	// room for the wide turn at each end of a row (the bulge) plus the node and the road around it
	const padX = opts.padX ?? 96;
	const perRow = Math.max(2, opts.perRow);
	const gap = Math.min(opts.maxGap ?? 120, (opts.width - 2 * padX) / (perRow - 1));
	const rows = Math.max(1, Math.ceil(count / perRow));
	// A short last row (or a single row) keeps the same spacing instead of stretching, and the whole snake is centred
	const span = gap * (perRow - 1);
	const left = (opts.width - span) / 2;
	const top = 46;

	const points: Point[] = [];
	const path: Point[] = [];
	for (let i = 0; i < count; i++) {
		const row = Math.floor(i / perRow);
		const col = i % perRow;
		const x = row % 2 === 0 ? left + col * gap : left + span - col * gap;
		const y = top + row * rowHeight + (col % 2 === 0 ? 7 : -7);
		const p = { x, y };
		points.push(p);
		path.push(p);
		// the turn: leave the end of the row on its outer side, then come back to the start of the next row
		const endOfRow = col === perRow - 1 && i < count - 1;
		if (endOfRow) {
			const dir = row % 2 === 0 ? 1 : -1;
			const bulge = Math.min(54, gap * 0.8);
			path.push({ x: x + dir * bulge, y: y + rowHeight * 0.3 }, { x: x + dir * bulge, y: y + rowHeight * 0.7 });
		}
	}
	return { points, d: smoothPath(path), height: top + (rows - 1) * rowHeight + 54 };
}

/** How many steps fit in a row for a drawing this wide */
export const perRowFor = (width: number) => (width < 420 ? 3 : width < 640 ? 5 : width < 860 ? 7 : 9);
