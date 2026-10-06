import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPatient, db, pageData, signInAll, uniq, type Sessions } from './helpers';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});
const ROOT = () => process.env.TEST_DATA_DIR!;
const entry = (code: string) => (JSON.parse(fs.readFileSync(path.join(ROOT(), 'patients.json'), 'utf8')).patients as Record<string, unknown>[]).find((p) => p.user_id === code);
const plan = (id: string, over: Record<string, string | string[]> = {}) =>
	s.priya.action(`/patients/${id}?/createPlan`, { trainingSide: 'Right', startDate: '2026-09-28', durationDays: '5', dailyTargetMinutes: '30', deviceTypeIds: ['MARS'], ...over });

describe('patient status: Inactive → Active', () => {
	const status = async (id: string) => (await db().patient.findUniqueOrThrow({ where: { id } })).status;

	it('a new patient is Inactive, and the plan makes them Active', async () => {
		const id = await createPatient(s.priya);
		expect(await status(id)).toBe('Inactive');
		await plan(id);
		expect(await status(id)).toBe('Active');
	});

	it('stays Active when a session is trained (there is no Ongoing any more)', async () => {
		const code = uniq('act').slice(0, 20);
		const id = await createPatient(s.priya, code);
		await plan(id);
		const header =
			'SessionNumber,DateTime,TrialNumberDay,TrialNumberSession,TrialStartTime,TrialStopTime,TrialRawDataFile,Movement,TrainingPlaneAngle,GameName,ReachSpeed,GameParameter,GameDuration,SuccessRate,MoveTime,CurrentTargets,CurrentHits,CurrentMisses,CummulativeTargets,CummulativeHits,CummulativeMisses,currentStar,CummulativeStars,RawDataFileName';
		const row = '1,2026-09-28 10:56:02,1,1,2026-09-28 10:57:24,2026-09-28 10:58:25,x,ML,-90,SS,0.025,18.7,60,100,60,10,10,0,10,10,0,1,1,raw.csv';
		const dir = path.join(ROOT(), code, 'MARS01');
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'sessions.csv'), `:Location: x
:Device: MARS
:User: ${code}
${header}
${row}
`);
		await s.arjun.action('/data-sync?/sync');
		expect(await db().therapySession.count({ where: { patientId: id } })).toBe(1);
		expect(await status(id)).toBe('Active');
	});

	it('only Inactive, Active, Paused, Completed and Discontinued exist', async () => {
		const id = await createPatient(s.priya);
		await plan(id);
		for (const ok of ['Paused', 'Completed', 'Discontinued', 'Active']) expect((await s.priya.action(`/patients/${id}?/setStatus`, { status: ok })).type, ok).toBe('success');
		for (const bad of ['Ongoing', 'New', 'Assessment Pending']) expect((await s.priya.action(`/patients/${id}?/setStatus`, { status: bad })).type, bad).toBe('failure');
	});
});

describe('creating a therapy plan', () => {
	it('needs the affected side to train and at least one device', async () => {
		const id = await createPatient(s.priya);
		expect((await plan(id, { trainingSide: '' })).type).toBe('failure');
		expect((await plan(id, { trainingSide: 'Middle' })).type).toBe('failure');
		expect((await plan(id, { deviceTypeIds: [] })).type).toBe('failure');
		expect(await db().therapyPlan.count({ where: { patientId: id } })).toBe(0);
	});

	it('needs no name; stores the side; adds the patient to patients.json with those devices and that side', async () => {
		const code = uniq('side').slice(0, 20);
		const id = await createPatient(s.priya, code);
		expect(entry(code)).toBeUndefined(); // registering alone does not add the patient to patients.json
		expect(fs.statSync(path.join(ROOT(), code)).isDirectory()).toBe(true); // but the folder exists
		expect((await plan(id, { trainingSide: 'Right', deviceTypeIds: ['MARS', 'PLUTO'] })).type).toBe('redirect');
		const p = await db().therapyPlan.findFirstOrThrow({ where: { patientId: id } });
		expect(p.trainingSide).toBe('Right');
		expect(entry(code)).toMatchObject({ user_id: code, status: 'active', side: 'right', devices: ['MARS', 'PLUTO'] });
	});
});

describe('patient inflow: new, old and overall', () => {
	it('splits registrations from returning patients and adds them up', async () => {
		const d = (await pageData(s.admin, '/analytics?range=month')).inflow;
		for (const k of ['newValues', 'oldValues', 'overallValues']) expect(d[k]).toHaveLength(d.labels.length);
		expect(d.overallValues).toEqual(d.newValues.map((v: number, i: number) => v + d.oldValues[i]));
		expect(d.newValues.at(-1)).toBeGreaterThan(0); // patients registered today
	});

	it('counts a patient who registered earlier and trained today as old, not new', async () => {
		const id = await createPatient(s.priya);
		await db().patient.update({ where: { id }, data: { registrationDate: new Date(Date.now() - 5 * 86400_000) } });
		const device = await db().device.findFirstOrThrow();
		const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
		const before = (await pageData(s.admin, '/analytics?range=week')).inflow;
		await db().therapySession.create({ data: { patientId: id, deviceId: device.id, sessionDate: today, startTime: new Date(), sessionNumber: 1, totalTargets: 1, totalHits: 1, totalMisses: 0, totalStars: 1 } });
		const after = (await pageData(s.admin, '/analytics?range=week')).inflow;
		expect(after.oldValues.at(-1)).toBe(before.oldValues.at(-1) + 1);
		expect(after.newValues.at(-1)).toBe(before.newValues.at(-1));
	});

	it('the overview no longer carries therapy hours, session totals or assessment counts', async () => {
		const p = (await pageData(s.priya, '/')).program;
		for (const gone of ['therapyHours', 'totalSessions', 'assessments']) expect(p, gone).not.toHaveProperty(gone);
	});
});

describe('the patient list for a therapist', () => {
	it('has a section for the rest of the location below their own patients', async () => {
		const mine = uniq('Mine');
		await createPatient(s.priya, mine);
		const html = await (await s.priya.get('/patients')).text();
		expect(html).toContain('Other patients at your location');
		const rows = (await pageData(s.priya, '/patients')).patients as { displayCode: string }[];
		expect(rows.some((r) => r.displayCode === mine)).toBe(true);
	});
});

describe('the daily timeline has no partial state', () => {
	it('no plan day is stored as partial', async () => {
		expect(await db().planDayLog.count({ where: { status: 'partial' } })).toBe(0);
	});
});
