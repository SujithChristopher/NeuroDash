import { describe, expect, it } from 'vitest';
import { buildScaleChanges, type ScaleAssessment } from './scaleChanges';

const d = (s: string) => new Date(s + 'T00:00:00Z');
const a = (patientId: string, date: string, score: number, scaleId = 'fma', max = 100): ScaleAssessment => ({ scaleId, title: scaleId.toUpperCase(), patientId, date: d(date), score, maxScore: max });

describe('buildScaleChanges', () => {
	it('lines patients up by their own Day 1, whatever calendar date they started on', () => {
		const [fma] = buildScaleChanges([
			a('p1', '2026-01-01', 20), a('p1', '2026-01-08', 30), a('p1', '2026-01-29', 50),
			a('p2', '2026-06-10', 40), a('p2', '2026-06-17', 50), a('p2', '2026-07-09', 70)
		]);
		expect(fma.patients).toBe(2);
		expect(fma.points).toEqual([
			{ label: 'Day 1', meanPct: 30, n: 2 },
			{ label: 'Day 14', meanPct: 40, n: 2 }, // each patient's 8th day
			{ label: 'Day 30', meanPct: 60, n: 2 } // day 29 and day 30
		]);
	});

	it('puts day 2-7 in the Day 7 window, 8-14 in Day 14, 15-21 in Day 21 and 22-30 in Day 30; later ones are ignored', () => {
		const [s] = buildScaleChanges([
			a('p', '2026-03-01', 10), // day 1
			a('p', '2026-03-07', 20), // day 7
			a('p', '2026-03-14', 30), // day 14
			a('p', '2026-03-21', 40), // day 21
			a('p', '2026-03-30', 50), // day 30
			a('p', '2026-04-05', 99) // day 36: outside the 30 days
		]);
		expect(s.points.map((p) => [p.label, p.meanPct])).toEqual([['Day 1', 10], ['Day 7', 20], ['Day 14', 30], ['Day 21', 40], ['Day 30', 50]]);
	});

	it('averages patients per window and counts them; windows nobody was assessed in are left out', () => {
		const [s] = buildScaleChanges([a('p1', '2026-03-01', 20), a('p2', '2026-03-05', 40), a('p1', '2026-03-29', 60), a('p2', '2026-04-02', 80)]);
		expect(s.points).toEqual([
			{ label: 'Day 1', meanPct: 30, n: 2 },
			{ label: 'Day 30', meanPct: 70, n: 2 }
		]);
	});

	it('uses a patient\'s latest assessment when several fall in one window', () => {
		const [s] = buildScaleChanges([a('p', '2026-03-01', 10), a('p', '2026-03-03', 20), a('p', '2026-03-05', 35)]);
		expect(s.points.find((p) => p.label === 'Day 7')).toEqual({ label: 'Day 7', meanPct: 35, n: 1 });
	});

	it('reports the change only for patients assessed at the start and again later, from their own first and latest score', () => {
		const [s] = buildScaleChanges([
			a('p1', '2026-03-01', 20), a('p1', '2026-03-29', 60), // +40
			a('p2', '2026-03-01', 40), a('p2', '2026-03-29', 60), // +20
			a('p3', '2026-03-01', 90) // only one assessment: not in the change
		]);
		expect(s.patients).toBe(3);
		expect(s.change).toEqual({ patients: 2, fromPct: 30, toPct: 60, pctPoints: 30 });
	});

	it('has no change while nobody has been assessed twice', () => {
		expect(buildScaleChanges([a('p1', '2026-03-01', 20), a('p2', '2026-03-01', 30)])[0].change).toBeNull();
	});

	it('scores as a percentage of each scale\'s own maximum and keeps scales apart, most-assessed first', () => {
		const out = buildScaleChanges([a('p', '2026-03-01', 33, 'fma', 66), a('p', '2026-03-01', 19, 'arat', 57), a('q', '2026-03-01', 10, 'arat', 57), a('q', '2026-03-01', 0, 'zero', 0)]);
		expect(out.map((x) => x.scaleId)).toEqual(['arat', 'fma']); // the scale with a zero maximum is skipped
		expect(out.find((x) => x.scaleId === 'fma')!.points[0].meanPct).toBe(50);
		expect(out.find((x) => x.scaleId === 'arat')!.points[0].meanPct).toBeCloseTo(25.4, 1);
	});
});
