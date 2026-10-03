import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPatient, createUser, db, downtownId, pageData, signInAll, uniq, type Client, type Sessions } from './helpers';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

type Row = { code: string; status: string; minutes: number | null; accuracy: number | null; plannedMinutes: number; devices: string[] };
type Todo = { title: string; sub: string; action?: { label: string; href: string } };
const overview = async (c: Client) => (await pageData(c, '/')) as { schedule: Row[]; todos: Todo[] };
const row = async (c: Client, code: string) => (await overview(c)).schedule.find((r) => r.code === code);
const priyaId = async () => (await db().user.findFirstOrThrow({ where: { email: 'priya.nair@neurodash.care' } })).id;

/** A patient with a plan that covers today. */
async function patientWithPlan(over: Record<string, string | string[]> = {}, who: Client = s.priya) {
	const code = uniq('sch').slice(0, 20);
	const id = await createPatient(who, code);
	const r = await who.action(`/patients/${id}?/createPlan`, { trainingSide: 'Left', startDate: today(), durationDays: '10', dailyTargetMinutes: '40', deviceTypeIds: ['MARS'], ...over });
	expect(r.type).toBe('redirect');
	return { id, code };
}
const train = async (patientId: string, minutes = 20, targets = 10, hits = 8) =>
	db().therapySession.create({
		data: { patientId, deviceId: (await db().device.findFirstOrThrow({ where: { deviceTypeId: 'MARS' } })).id, sourceDevice: 'MARS', sessionDate: new Date(today() + 'T00:00:00Z'), startTime: new Date(), durationMinutes: minutes, totalTargets: targets, totalHits: hits }
	});

describe('sessions today', () => {
	it('lists patients whose active plan covers today, with devices and planned minutes, not started yet', async () => {
		const { code } = await patientWithPlan({ deviceTypeIds: ['MARS', 'PLUTO'] });
		const r = await row(s.priya, code);
		expect(r).toMatchObject({ status: 'waiting', plannedMinutes: 40, minutes: null, accuracy: null });
		expect(r!.devices.sort()).toEqual(['Mars', 'Pluto']);
	});

	it('is done, with minutes and accuracy, once something was trained today', async () => {
		const { id, code } = await patientWithPlan();
		await train(id, 20, 10, 8);
		await train(id, 17, 30, 27);
		expect(await row(s.priya, code)).toMatchObject({ status: 'done', minutes: 37, accuracy: 88 });
	});

	it('is in progress while the patient is uploading (presence)', async () => {
		const { id, code } = await patientWithPlan();
		await train(id);
		const file = path.join(process.env.TEST_DATA_DIR!, 'presence.json');
		const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
		fs.writeFileSync(file, JSON.stringify({ [code]: { device: 'MARS01', last_upload: local } }));
		try {
			expect((await row(s.priya, code))!.status).toBe('in_progress');
		} finally {
			fs.rmSync(file, { force: true });
		}
		expect((await row(s.priya, code))!.status).toBe('done');
	});

	it('leaves out plans that do not cover today, paused plans and patients with no plan', async () => {
		const past = await patientWithPlan({ startDate: daysAgo(30), durationDays: '10' });
		const future = await patientWithPlan({ startDate: daysAgo(-5) });
		const paused = await patientWithPlan();
		const plan = await db().therapyPlan.findFirstOrThrow({ where: { patientId: paused.id } });
		await s.priya.action(`/patients/${paused.id}?/editPlan`, { planId: plan.id, status: 'Paused', trainingSide: 'Left', deviceTypeIds: ['MARS'], dailyTargetMinutes: '40', targetSessions: '5', reason: 'x' });
		const noPlan = uniq('np').slice(0, 20);
		await createPatient(s.priya, noPlan);
		const codes = (await overview(s.priya)).schedule.map((r) => r.code);
		for (const c of [past.code, future.code, paused.code, noPlan]) expect(codes, c).not.toContain(c);
	});

	it('puts those training now first, then those still to come, then those done', async () => {
		const waiting = await patientWithPlan();
		const done = await patientWithPlan();
		await train(done.id);
		const codes = (await overview(s.priya)).schedule.map((r) => r.code);
		expect(codes.indexOf(waiting.code)).toBeLessThan(codes.indexOf(done.code));
	});

	it('is the therapist’s own patients; a consultant sees the whole centre; another centre sees neither', async () => {
		const { code } = await patientWithPlan();
		expect(await row(s.priya, code)).toBeTruthy();
		expect(await row(s.vikram, code)).toBeTruthy(); // consultant at the same centre
		expect(await row(s.rohan, code)).toBeUndefined();
		const colleague = await createUser(s.admin, { role: 'THERAPIST', locationId: await downtownId() });
		expect((await overview(colleague.client)).schedule.some((r) => r.code === code)).toBe(false); // their own list, not Priya's
	});
});

describe('the to-do list', () => {
	it('asks for a plan and a first assessment for a new patient, each with a button', async () => {
		const code = uniq('todo').slice(0, 20);
		const id = await createPatient(s.priya, code);
		const mine = (await overview(s.priya)).todos.filter((t) => t.title === code);
		expect(mine.map((t) => t.action?.label).sort()).toEqual(['Create plan', 'New assessment']);
		expect(mine.find((t) => t.action?.label === 'Create plan')!.action!.href).toBe(`/patients/${id}?tab=plan`);
		expect(mine.find((t) => t.action?.label === 'New assessment')!.action!.href).toBe(`/assessments/new?patient=${id}`);
	});

	it('stops asking once the plan and an assessment exist', async () => {
		const { id, code } = await patientWithPlan();
		await db().assessment.create({ data: { patientId: id, scaleId: 'fma', assessmentDate: new Date(today() + 'T00:00:00Z'), answers: {}, administeredById: await priyaId() } });
		expect((await overview(s.priya)).todos.filter((t) => t.title === code)).toEqual([]);
	});

	it('has nothing about devices or attendance', async () => {
		const { id, code } = await patientWithPlan({ startDate: daysAgo(6), durationDays: '14' });
		const plan = await db().therapyPlan.findFirstOrThrow({ where: { patientId: id } });
		await db().planDayLog.updateMany({ where: { planId: plan.id, logDate: { lt: new Date(today() + 'T00:00:00Z') } }, data: { status: 'missed' } });
		const subs = (await overview(s.priya)).todos.filter((t) => t.title === code).map((t) => t.sub).join('|');
		expect(subs).not.toMatch(/device|unit|missed|attendance/i);
	});

	it('is only for therapists: a consultant gets notifications, not patient tasks', async () => {
		const code = uniq('cons').slice(0, 20);
		await createPatient(s.priya, code);
		expect((await overview(s.vikram)).todos.some((t) => t.title === code)).toBe(false);
	});
});
