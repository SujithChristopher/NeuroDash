import { describe, expect, it } from 'vitest';
import { countTrials, deviceDaily, deviceTotals, devicesOf, durationByDay, type TrainingSession } from './series';

const mk = (date: string, typeId: string, minutes: number | null, over: Partial<TrainingSession> = {}): TrainingSession => ({
	date: `${date}T00:00:00.000Z`,
	durationMinutes: minutes,
	totalTargets: 10,
	totalHits: 8,
	totalStars: 2,
	device: { typeId, typeName: typeId, colorSeries: typeId === 'MARS' ? 'series-2' : typeId === 'PLUTO' ? 'series-1' : null },
	trials: [{ gameId: null, gameCode: 'SS', mechanism: 'ML' }],
	...over
});

const sessions = [mk('2026-08-04', 'MARS', 20), mk('2026-08-04', 'PLUTO', 10), mk('2026-08-04', 'MARS', 5), mk('2026-08-07', 'PLUTO', 15), mk('2026-08-07', 'PLUTO', null)];

describe('devicesOf', () => {
	it('lists each device once, most-used first, with a stable colour', () => {
		const d = devicesOf(sessions);
		expect(d.map((x) => x.typeId)).toEqual(['MARS', 'PLUTO']); 
		expect(d.find((x) => x.typeId === 'MARS')!.color).toBe('var(--series-2)');
		expect(d.find((x) => x.typeId === 'PLUTO')!.color).toBe('var(--series-1)');
	});
	it('derives a stable colour for an unknown device type', () => {
		const a = devicesOf([mk('2026-08-04', 'NEWDEV', 1)])[0].color;
		expect(a).toMatch(/^var\(--series-\d+\)$/);
		expect(devicesOf([mk('2026-08-05', 'NEWDEV', 9)])[0].color).toBe(a);
	});
});

describe('durationByDay', () => {
	it('gives one dataset per device with a zero for days without it, across every calendar day', () => {
		const r = durationByDay(sessions, devicesOf(sessions));
		expect(r.days).toEqual(['2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']);
		const by = Object.fromEntries(r.datasets.map((d) => [d.label, d.data]));
		expect(by.MARS).toEqual([25, 0, 0, 0]);
		expect(by.PLUTO).toEqual([10, 0, 0, 15]);
	});
	it('keeps only the most recent days when asked', () => {
		const r = durationByDay(sessions, devicesOf(sessions), 2);
		expect(r.days).toEqual(['2026-08-06', '2026-08-07']);
	});
	it('is empty without sessions', () => {
		expect(durationByDay([], []).days).toEqual([]);
	});
});

describe('per-device numbers never mix devices', () => {
	it('deviceDaily sums a device per day and omits days it did not train', () => {
		expect(deviceDaily(sessions, 'MARS')).toEqual([{ label: expect.any(String), accuracy: 80, stars: 4, minutes: 25 }]);
		expect(deviceDaily(sessions, 'PLUTO').map((x) => x.minutes)).toEqual([10, 15]);
	});
	it('deviceTotals', () => {
		expect(deviceTotals(sessions, 'MARS')).toEqual({ sessions: 2, minutes: 25, stars: 4, trials: 2, accuracy: 80 });
		expect(deviceTotals(sessions, 'NOARK')).toEqual({ sessions: 0, minutes: 0, stars: 0, trials: 0, accuracy: null });
	});
	it('countTrials counts one device only, most common first', () => {
		const s = [
			mk('2026-08-04', 'MARS', 1, { trials: [{ gameId: null, gameCode: 'SS', mechanism: 'ML' }, { gameId: null, gameCode: 'SS', mechanism: 'ML' }, { gameId: null, gameCode: 'FR', mechanism: 'AP' }] }),
			mk('2026-08-04', 'PLUTO', 1, { trials: [{ gameId: null, gameCode: 'SS', mechanism: null }] })
		];
		expect(countTrials(s, 'MARS', (t) => t.gameCode)).toEqual([['SS', 2], ['FR', 1]]);
		expect(countTrials(s, 'PLUTO', (t) => t.mechanism)).toEqual([]);
	});
});

describe('scaleTrends', () => {
	const a = (typeId: string, date: string, pct: number | null, label: string | null = null) => ({ typeId, typeName: typeId.toUpperCase(), label, date, percentage: pct });
	it('gives each scale its own series and axis, skipping unscored ones', async () => {
		const { scaleTrends } = await import('./series');
		const t = scaleTrends([a('fma', '2026-08-01', 40, 'Baseline'), a('arat', '2026-08-02', 10), a('fma', '2026-08-10', 55, 'Day 7'), a('bbt', '2026-08-03', null)]);
		expect(t.map((x) => x.typeId)).toEqual(['fma', 'arat']);
		expect(t[0]).toMatchObject({ count: 2, labels: ['Baseline', 'Day 7'], data: [40, 55] });
		expect(t[1].count).toBe(1);
		expect(t[0].color).not.toBe(t[1].color);
	});
});
