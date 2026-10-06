// Therapy-plan attendance as a calendar heatmap: one square per plan day, in week columns (Monday first), shaded by how much of
// that day's target was trained. Pure (no clock, no database): "today" is passed in as a UTC day (YYYY-MM-DD).

export interface AttendanceDay {
	dayNumber: number;
	logDate: string | Date;
	targetMinutes: number;
	actualMinutes: number;
}

/** 0 = nothing trained, 1..4 = a quarter, half, most, all of the target ("target met"). */
export type AttendanceLevel = 0 | 1 | 2 | 3 | 4;

export interface AttendanceCell {
	date: string;
	dayNumber: number;
	/** null while the day is still to come */
	level: AttendanceLevel | null;
	minutes: number;
	target: number;
	today: boolean;
}

export interface Attendance {
	/** Each week is Monday to Sunday; a null cell is outside the plan (before its start or after its end) */
	weeks: (AttendanceCell | null)[][];
	/** Month name above the first week of each month, otherwise null (same length as weeks) */
	months: (string | null)[];
	/** Training days in the 7 days up to and including today, out of the plan days in that window */
	last7: { trained: number; planned: number };
	/** Minutes trained as a percentage of the minutes planned for the days so far; null before the plan starts */
	sinceStartPct: number | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86400_000;
const key = (d: string | Date) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);
const t = (k: string) => Date.parse(k + 'T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** 0 = Monday ... 6 = Sunday */
const weekday = (k: string) => (new Date(t(k)).getUTCDay() + 6) % 7;

export function levelFor(minutes: number, target: number): AttendanceLevel {
	if (minutes <= 0) return 0;
	const r = target > 0 ? minutes / target : 1;
	return r >= 1 ? 4 : r >= 0.67 ? 3 : r >= 0.34 ? 2 : 1;
}

export function buildAttendance(dayLog: AttendanceDay[], today: string): Attendance {
	const days = [...dayLog].map((d) => ({ ...d, date: key(d.logDate) })).sort((a, b) => a.date.localeCompare(b.date));
	if (!days.length) return { weeks: [], months: [], last7: { trained: 0, planned: 0 }, sinceStartPct: null };

	const byDate = new Map(days.map((d) => [d.date, d]));
	const first = days[0].date;
	const last = days[days.length - 1].date;
	// Whole weeks, from the Monday on or before the first day to the Sunday on or after the last
	const gridStart = t(first) - weekday(first) * DAY;
	const gridEnd = t(last) + (6 - weekday(last)) * DAY;

	const weeks: (AttendanceCell | null)[][] = [];
	const months: (string | null)[] = [];
	let prevMonth = -1;
	for (let ws = gridStart; ws <= gridEnd; ws += 7 * DAY) {
		const week: (AttendanceCell | null)[] = [];
		for (let i = 0; i < 7; i++) {
			const date = iso(ws + i * DAY);
			const d = byDate.get(date);
			week.push(
				d
					? {
							date,
							dayNumber: d.dayNumber,
							level: date > today ? null : levelFor(d.actualMinutes, d.targetMinutes),
							minutes: d.actualMinutes,
							target: d.targetMinutes,
							today: date === today
						}
					: null
			);
		}
		// Label a week with the month of its first plan day, once per month
		const firstIn = week.find((c) => c);
		const month = firstIn ? new Date(t(firstIn.date)).getUTCMonth() : -1;
		months.push(month !== prevMonth && month >= 0 ? MONTHS[month] : null);
		if (month >= 0) prevMonth = month;
		weeks.push(week);
	}

	const sinceStart = days.filter((d) => d.date <= today);
	const planned = sinceStart.reduce((n, d) => n + d.targetMinutes, 0);
	const done = sinceStart.reduce((n, d) => n + d.actualMinutes, 0);
	const windowStart = iso(t(today) - 6 * DAY);
	const inWindow = sinceStart.filter((d) => d.date >= windowStart);

	return {
		weeks,
		months,
		last7: { trained: inWindow.filter((d) => d.actualMinutes > 0).length, planned: inWindow.length },
		sinceStartPct: planned > 0 ? Math.round((done / planned) * 100) : null
	};
}
