import { beforeAll, describe, expect, it } from 'vitest';
import { createPatient, db, pageData, signInAll, uniq, type Client, type Sessions } from './helpers';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});

type Change = { scaleId: string; title: string; patients: number; points: { label: string; meanPct: number; n: number }[]; change: { patients: number; fromPct: number; toPct: number; pctPoints: number } | null };
const scaleChanges = async (c: Client) => (await pageData(c, '/analytics')).scaleChanges as Change[];

const D = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)); // day 1 of a patient is 1 Jan 2026 + their start offset
async function assess(patientId: string, scaleId: string, startOffset: number, readings: [day: number, score: number][], max = 100) {
	const by = (await db().user.findFirstOrThrow({ where: { email: 'priya.nair@neurodash.care' } })).id;
	for (const [day, score] of readings) {
		await db().assessment.create({ data: { patientId, scaleId, assessmentDate: D(startOffset + day - 1), score, maxScore: max, answers: {}, administeredById: by } });
	}
}

describe('analytics: assessment change from Day 1 to Day 30, per scale', () => {
	const scale = `zz${Date.now().toString(36)}`;
	let downtownA: string, downtownB: string, north: string;

	beforeAll(async () => {
		downtownA = await createPatient(s.priya, uniq('scA').slice(0, 20));
		downtownB = await createPatient(s.priya, uniq('scB').slice(0, 20));
		north = await createPatient(s.rohan, uniq('scN').slice(0, 20));
		await assess(downtownA, scale, 0, [[1, 20], [8, 30], [29, 60]]); // 20 -> 60
		await assess(downtownB, scale, 100, [[1, 40], [30, 60]]); // started on another date: lines up by its own Day 1; 40 -> 60
		await assess(north, scale, 50, [[1, 10], [14, 30]]); // 10 -> 30
	});

	const mine = (list: Change[]) => list.find((c) => c.scaleId === scale);

	it('the admin sees every centre: windows are averaged over patients, change is first-to-latest per patient', async () => {
		const c = mine(await scaleChanges(s.admin))!;
		expect(c.patients).toBe(3);
		expect(c.points).toEqual([
			{ label: 'Day 1', meanPct: 23.3, n: 3 }, // (20 + 40 + 10) / 3
			{ label: 'Day 14', meanPct: 30, n: 2 }, // downtownA day 8 (30) and north day 14 (30)
			{ label: 'Day 30', meanPct: 60, n: 2 } // downtownA day 29 and downtownB day 30
		]);
		expect(c.change).toEqual({ patients: 3, fromPct: 23.3, toPct: 50, pctPoints: 26.7 }); // (60 + 60 + 30) / 3 = 50
	});

	it('therapists and consultants see only their own centre', async () => {
		const priya = mine(await scaleChanges(s.priya))!;
		expect(priya.patients).toBe(2);
		expect(priya.points.find((p) => p.label === 'Day 1')).toEqual({ label: 'Day 1', meanPct: 30, n: 2 });
		expect(priya.change).toMatchObject({ patients: 2, fromPct: 30, toPct: 60, pctPoints: 30 });
		expect(mine(await scaleChanges(s.vikram))!.patients).toBe(2);
		const rohan = mine(await scaleChanges(s.rohan))!;
		expect(rohan.patients).toBe(1);
		expect(rohan.change).toMatchObject({ fromPct: 10, toPct: 30 });
	});

	it('engineers have no patient data here', async () => {
		expect(await scaleChanges(s.arjun)).toEqual([]);
	});

	it('each scale is separate, with titles from the scale definitions', async () => {
		const fma = (await scaleChanges(s.admin)).find((c) => c.scaleId === 'fma');
		expect(fma?.title).toMatch(/Fugl-Meyer/);
		expect(fma!.patients).toBeGreaterThan(0);
	});

	it('ignores assessments without a score and scores after day 30', async () => {
		const p = await createPatient(s.priya, uniq('scX').slice(0, 20));
		const sc = `zy${Date.now().toString(36)}`;
		const by = (await db().user.findFirstOrThrow({ where: { email: 'priya.nair@neurodash.care' } })).id;
		await db().assessment.create({ data: { patientId: p, scaleId: sc, assessmentDate: D(0), score: null, maxScore: null, answers: {}, administeredById: by } });
		await assess(p, sc, 0, [[1, 50], [45, 90]]); // day 45 is outside the window
		const c = (await scaleChanges(s.priya)).find((x) => x.scaleId === sc)!;
		expect(c.points).toEqual([{ label: 'Day 1', meanPct: 50, n: 1 }]);
		expect(c.change).toBeNull();
	});
});
