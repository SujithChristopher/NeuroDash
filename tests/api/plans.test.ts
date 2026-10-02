import { beforeAll, describe, expect, it } from 'vitest';
import { createPatient, createUser, db, downtownId, northId, signInAll, uniq, type Sessions } from './helpers';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});

const planFields = (over: Record<string, string | string[]> = {}) => ({
	trainingSide: 'Left',
	name: 'Test plan',
	startDate: '2026-10-01',
	durationDays: '10',
	dailyTargetMinutes: '60',
	targetSessions: '8',
	goals: 'Goal A; Goal B',
	notes: 'Initial',
	deviceTypeIds: ['PLUTO', 'MARS'],
	...over
});

describe('creating a therapy plan', () => {
	it('creates one day-log row per day, multi-device, and activates the patient', async () => {
		const id = await createPatient(s.priya);
		const r = await s.priya.action(`/patients/${id}?/createPlan`, planFields());
		expect(r.type).toBe('redirect');
		expect(r.location).toContain('tab=plan');

		const plan = await db().therapyPlan.findFirstOrThrow({
			where: { patientId: id },
			include: { dayLog: { orderBy: { dayNumber: 'asc' } }, devices: true }
		});
		expect(plan.dayLog).toHaveLength(10);
		expect(plan.dayLog.every((d) => d.status === 'upcoming' && d.targetMinutes === 60 && d.actualMinutes === 0)).toBe(true);
		expect(plan.dayLog.map((d) => d.dayNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(plan.dayLog[0].logDate.toISOString().slice(0, 10)).toBe('2026-10-01');
		expect(plan.dayLog[9].logDate.toISOString().slice(0, 10)).toBe('2026-10-10');
		expect(plan.devices.map((d) => d.deviceTypeId).sort()).toEqual(['MARS', 'PLUTO']);
		expect(plan.trainingSide).toBe('Left');
		expect((await db().patient.findUniqueOrThrow({ where: { id } })).status).toBe('Active');
	});

	it('requires at least one real device type', async () => {
		const id = await createPatient(s.priya);
		expect((await s.priya.action(`/patients/${id}?/createPlan`, planFields({ deviceTypeIds: [] }))).type).toBe('failure');
		expect((await s.priya.action(`/patients/${id}?/createPlan`, planFields({ deviceTypeIds: ['NOPE'] }))).type).toBe('failure');
		expect(await db().therapyPlan.count({ where: { patientId: id } })).toBe(0);
	});

	it('validates duration and targets', async () => {
		const id = await createPatient(s.priya);
		const cases: Record<string, string>[] = [{ durationDays: '0' }, { durationDays: '400' }, { durationDays: 'abc' }, { dailyTargetMinutes: '0' }, { trainingSide: '' }, { startDate: 'nope' }];
		for (const bad of cases) {
			expect((await s.priya.action(`/patients/${id}?/createPlan`, planFields(bad))).type, JSON.stringify(bad)).toBe('failure');
		}
		expect(await db().therapyPlan.count({ where: { patientId: id } })).toBe(0);
	});

	it('only the primary therapist may create a plan — not a covering colleague, consultant, admin or other location', async () => {
		const id = await createPatient(s.priya);
		const colleague = await createUser(s.admin, { role: 'THERAPIST', locationId: await downtownId() });
		expect((await colleague.client.action(`/patients/${id}?/createPlan`, planFields())).status).toBe(403);
		expect((await s.vikram.action(`/patients/${id}?/createPlan`, planFields())).status).toBe(403);
		expect((await s.admin.action(`/patients/${id}?/createPlan`, planFields())).status).toBe(403);
		expect((await s.rohan.action(`/patients/${id}?/createPlan`, planFields())).status).toBe(404);
		expect(await db().therapyPlan.count({ where: { patientId: id } })).toBe(0);
	});
});

describe('editing a therapy plan', () => {
	let id: string;
	let planId: string;
	beforeAll(async () => {
		id = await createPatient(s.priya);
		await s.priya.action(`/patients/${id}?/createPlan`, planFields());
		planId = (await db().therapyPlan.findFirstOrThrow({ where: { patientId: id } })).id;
	});

	const edit = (client: typeof s.priya, over: Record<string, string> = {}) =>
		client.action(`/patients/${id}?/editPlan`, { planId, status: 'Active', trainingSide: 'Left', deviceTypeIds: ['PLUTO', 'MARS'], dailyTargetMinutes: '60', targetSessions: '8', notes: 'Initial', reason: 'Because', ...over });

	it('requires a reason for every change', async () => {
		expect((await edit(s.priya, { dailyTargetMinutes: '70', reason: '   ' })).type).toBe('failure');
		expect((await edit(s.priya, { dailyTargetMinutes: '70', reason: '' })).type).toBe('failure');
		expect((await db().therapyPlan.findUniqueOrThrow({ where: { id: planId } })).dailyTargetMinutes).toBe(60);
	});

	it('rejects an edit that changes nothing', async () => {
		const r = await edit(s.priya);
		expect(r.type).toBe('failure');
		expect(String(r.data?.editError)).toMatch(/nothing/i);
	});

	it('rejects invalid values and unknown statuses', async () => {
		expect((await edit(s.priya, { dailyTargetMinutes: '0' })).type).toBe('failure');
		expect((await edit(s.priya, { dailyTargetMinutes: '601' })).type).toBe('failure');
		expect((await edit(s.priya, { status: 'Exploded' })).type).toBe('failure');
	});

	it('records a revision per changed field (old → new, who, role, reason) and updates only upcoming days', async () => {
		// Mark day 1 as done so we can prove elapsed days keep their original target.
		await db().planDayLog.updateMany({ where: { planId, dayNumber: 1 }, data: { status: 'done', actualMinutes: 60 } });

		const r = await edit(s.priya, { dailyTargetMinutes: '75', targetSessions: '9', reason: 'Tolerating load well' });
		expect(r.type).toBe('success');

		const revs = await db().planRevision.findMany({ where: { planId }, orderBy: { fieldChanged: 'asc' } });
		expect(revs.map((x) => [x.fieldChanged, x.previousValue, x.newValue])).toEqual([
			['Daily Target Duration (min)', '60', '75'],
			['Target Sessions', '8', '9']
		]);
		expect(revs.every((x) => x.modifiedByRole === 'THERAPIST' && x.reason === 'Tolerating load well')).toBe(true);

		const days = await db().planDayLog.findMany({ where: { planId }, orderBy: { dayNumber: 'asc' } });
		expect(days[0].targetMinutes).toBe(60); // elapsed day untouched
		expect(days.slice(1).every((d) => d.targetMinutes === 75)).toBe(true);
	});

	it('does not notify the primary therapist about their own edit', async () => {
		const before = await db().notification.count({ where: { notifType: 'plan', targetUser: { email: 'priya.nair@neurodash.care' } } });
		await edit(s.priya, { notes: `Own edit ${uniq()}`, reason: 'Clarify' });
		const after = await db().notification.count({ where: { notifType: 'plan', targetUser: { email: 'priya.nair@neurodash.care' } } });
		expect(after).toBe(before);
	});

	it('a covering therapist at the same location may edit, and the primary therapist is notified', async () => {
		const coverName = uniq('Covering ');
		const colleague = await createUser(s.admin, { role: 'THERAPIST', locationId: await downtownId(), name: coverName });
		const r = await edit(colleague.client, { status: 'Paused', reason: 'Cover while away' });
		expect(r.type).toBe('success');

		const rev = await db().planRevision.findFirstOrThrow({ where: { planId, fieldChanged: 'Plan Status' } });
		expect(rev.modifiedByRole).toBe('THERAPIST');
		expect((await db().planRevision.findMany({ where: { planId }, include: { modifiedBy: true } })).some((x) => x.modifiedBy.email === colleague.email)).toBe(true);

		const note = await db().notification.findFirstOrThrow({
			where: { notifType: 'plan', targetUser: { email: 'priya.nair@neurodash.care' }, description: { contains: coverName } }
		});
		expect(note.title).toMatch(/edited by another therapist/i);
		expect(note.description).toContain('Plan Status');
		expect((note.link as { page: string }).page).toBe(`patients/${id}?tab=plan`);
	});

	it('the consultant (read-only), admin, engineer and other locations cannot edit', async () => {
		expect((await edit(s.vikram, { notes: 'x' })).status).toBe(403);
		expect((await edit(s.admin, { notes: 'x' })).status).toBe(403);
		expect((await edit(s.arjun, { notes: 'x' })).status).toBe(403);
		expect((await edit(s.rohan, { notes: 'x' })).status).toBe(404);
		expect((await db().therapyPlan.findUniqueOrThrow({ where: { id: planId } })).notes).not.toBe('x');
	});

	it('a therapist at a different location cannot cover (their own location has no claim)', async () => {
		const north = await createUser(s.admin, { role: 'THERAPIST', locationId: await northId() });
		expect((await edit(north.client, { notes: 'y' })).status).toBe(404);
	});

	it('cannot edit a plan that belongs to another patient', async () => {
		const other = await createPatient(s.priya);
		const r = await s.priya.action(`/patients/${other}?/editPlan`, { planId, status: 'Active', trainingSide: 'Left', deviceTypeIds: ['PLUTO', 'MARS'], dailyTargetMinutes: '61', targetSessions: '8', reason: 'x' });
		expect(r.status).toBe(404);
	});
});
