import { describe, expect, it } from 'vitest';
import { buildJourney, layoutPath, perRowFor, smoothPath, type JourneySession } from './journey';

const s = (id: string, date: string, minutes: number | null, device = 'Mars', over: Partial<JourneySession> = {}): JourneySession => ({
	id,
	date: `${date}T00:00:00.000Z`,
	startTime: `${date}T10:00:00.000Z`,
	durationMinutes: minutes,
	totalTargets: 10,
	totalHits: 8,
	device: { typeName: device },
	...over
});

describe('buildJourney: one node per day trained', () => {
	const sessions = [s('a', '2026-09-01', 20), s('b', '2026-09-01', 25, 'Pluto', { startTime: '2026-09-01T15:00:00.000Z' }), s('c', '2026-09-05', 60), s('d', '2026-09-20', 10)];
	const steps = buildJourney({ sessions, milestones: [], targetMinutes: 60 });

	it('numbers the training days 1, 2, 3 whatever the gaps, and shows no empty days', () => {
		expect(steps.map((x) => x.type === 'session' && [x.n, x.date])).toEqual([[1, '2026-09-01'], [2, '2026-09-05'], [3, '2026-09-20']]);
	});
	it('counts several sessions on a day as one node, adding their minutes and devices', () => {
		const first = steps[0];
		if (first.type !== 'session') throw new Error('expected a session');
		expect(first).toMatchObject({ minutes: 45, sessions: 2, accuracy: 80, sessionId: 'b' }); // the latest session opens the detail
		expect(first.byDevice).toEqual([{ name: 'Pluto', minutes: 25 }, { name: 'Mars', minutes: 20 }]);
	});
	it('shades by the share of the daily target, and a day that was trained never shows as none', () => {
		expect(steps.map((x) => x.type === 'session' && x.level)).toEqual([3, 4, 1]);
		const noMinutes = buildJourney({ sessions: [s('z', '2026-09-01', null)], milestones: [], targetMinutes: 60 })[0];
		expect(noMinutes.type === 'session' && noMinutes.level).toBe(1);
	});
	it('is empty without sessions', () => {
		expect(buildJourney({ sessions: [], milestones: [], targetMinutes: 60 })).toEqual([]);
	});
});

describe('buildJourney: assessments as flags', () => {
	const sessions = [s('a', '2026-09-02', 30), s('b', '2026-09-10', 30), s('c', '2026-09-20', 30)];
	const flag = (kind: 'clinical' | 'robotic', label: string, date: string) => ({ kind, label, date: `${date}T00:00:00.000Z` });

	it('puts a flag before the first training day on or after its date', () => {
		const steps = buildJourney({ sessions, milestones: [flag('clinical', 'FMA', '2026-09-01'), flag('clinical', 'FMA', '2026-09-10')], targetMinutes: 60 });
		expect(steps.map((x) => (x.type === 'session' ? x.n : x.caption))).toEqual(['FMA', 1, 'FMA', 2, 3]);
	});
	it('puts an assessment after the last session at the end', () => {
		const steps = buildJourney({ sessions, milestones: [flag('robotic', 'PLUTO A1', '2026-10-01')], targetMinutes: 60 });
		expect(steps.map((x) => (x.type === 'session' ? x.n : x.caption))).toEqual([1, 2, 3, 'PLUTO A1']);
	});
	it('groups the assessments of one date into one flag', () => {
		const steps = buildJourney({ sessions, milestones: [flag('clinical', 'FMA', '2026-09-01'), flag('robotic', 'PLUTO A0', '2026-09-01'), flag('robotic', 'MARS A0', '2026-09-01')], targetMinutes: 60 });
		const f = steps[0];
		expect(f.type === 'milestone' && f.caption).toBe('3 assessments');
		expect(f.type === 'milestone' && f.items.map((i) => i.label)).toEqual(['FMA', 'PLUTO A0', 'MARS A0']);
	});
	it('shows the flags even before any session', () => {
		const steps = buildJourney({ sessions: [], milestones: [flag('clinical', 'FMA', '2026-09-01')], targetMinutes: 60 });
		expect(steps).toHaveLength(1);
	});
});

describe('layoutPath', () => {
	const layout = layoutPath(10, { width: 600, perRow: 4 });

	it('lays the steps out as a snake: rows alternate direction', () => {
		const x = layout.points.map((p) => p.x);
		expect(x[0]).toBeLessThan(x[3]); // first row runs left to right
		expect(x[4]).toBeGreaterThan(x[7]); // second row runs right to left, starting on the right
		expect(Math.abs(x[3] - x[4])).toBeLessThan(1); // and starts where the first row ended
		expect(Math.abs(x[7] - x[8])).toBeLessThan(1);
	});
	it('goes down one row at a time and is as tall as its rows', () => {
		const rows = [0, 1, 2].map((r) => layout.points[r * 4].y);
		expect(rows[1]).toBeGreaterThan(rows[0]);
		expect(rows[2]).toBeGreaterThan(rows[1]);
		expect(layout.height).toBeGreaterThan(rows[2]);
	});
	it('keeps every step, and the turns between rows, inside the drawing', () => {
		for (const p of layout.points) {
			expect(p.x).toBeGreaterThan(0);
			expect(p.x).toBeLessThan(600);
		}
		const xs = [...layout.d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
		expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
		expect(Math.max(...xs)).toBeLessThanOrEqual(600);
	});
	it('draws one smooth path through all of them', () => {
		expect(layout.d.startsWith('M')).toBe(true);
		expect((layout.d.match(/C/g) ?? []).length).toBeGreaterThanOrEqual(9);
	});
	it('does not stretch a short journey across the whole width', () => {
		const few = layoutPath(3, { width: 900, perRow: 9 });
		expect(few.points[2].x - few.points[0].x).toBeLessThan(300);
		expect(layoutPath(0, { width: 600, perRow: 4 }).d).toBe('');
	});
	it('a single point is just a move', () => {
		expect(smoothPath([{ x: 5, y: 6 }])).toBe('M5,6');
	});
	it('fits fewer steps in a row on a narrow screen', () => {
		expect(perRowFor(360)).toBeLessThan(perRowFor(700));
		expect(perRowFor(700)).toBeLessThan(perRowFor(1000));
	});
});
