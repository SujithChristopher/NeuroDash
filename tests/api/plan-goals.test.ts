import { beforeAll, describe, expect, it } from 'vitest';
import { createPatient, createUser, db, downtownId, pageData, signInAll, uniq, type Sessions } from './helpers';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});

/** A robotic assessment with a PLUTO FPS AROM range and (optionally) a MARS ML reach, as the importer stores them. */
async function assess(patientId: string, timepoint: string, opts: { pluto?: number | null; mars?: number; limb?: string }) {
	const limb = opts.limb ?? 'left'; // createPatient registers a Left-affected patient: the plan trains the left side
	if (opts.pluto !== undefined) {
		await db().roboticAssessment.create({
			data: {
				patientId,
				deviceTypeId: 'PLUTO',
				limb,
				timepoint,
				assessedAt: new Date(),
				mechanisms: [],
				fingerprint: uniq('fp'),
				sourcePath: 'test',
				results: { create: [{ mechanism: 'FPS', task: 'AROM', status: opts.pluto == null ? 'Skipped' : 'Complete', unit: 'deg', romRange: opts.pluto }] }
			}
		});
	}
	if (opts.mars !== undefined) {
		await db().roboticAssessment.create({
			data: {
				patientId,
				deviceTypeId: 'MARS',
				limb,
				timepoint,
				assessedAt: new Date(),
				mechanisms: [],
				fingerprint: uniq('fp'),
				sourcePath: 'test',
				results: { create: [{ mechanism: 'ML', task: 'ROM', status: 'Complete', unit: 'cm', romRange: opts.mars, extra: { mlCm: opts.mars, apCm: 10 } }] }
			}
		});
	}
}

const goal = (deviceTypeId: string, mechanism: string, task: string, target: number | string) => ({ deviceTypeId, mechanism, task, target });
const planFields = (goals: unknown[] | string | null, over: Record<string, string | string[]> = {}) => ({
	trainingSide: 'Left',
	startDate: '2026-12-01',
	durationDays: '10',
	dailyTargetMinutes: '30',
	deviceTypeIds: ['PLUTO', 'MARS'],
	goals: 'Improve grasp for self-feeding',
	...(goals === null ? {} : { deviceGoals: typeof goals === 'string' ? goals : JSON.stringify(goals) }),
	...over
});
const create = (id: string, fields: ReturnType<typeof planFields>, who = s.priya) => who.action(`/patients/${id}?/createPlan`, fields);
const goalsOf = (planId: string) => db().planGoal.findMany({ where: { planId }, orderBy: [{ deviceTypeId: 'asc' }, { mechanism: 'asc' }, { task: 'asc' }] });
const planOf = (patientId: string) => db().therapyPlan.findFirstOrThrow({ where: { patientId } });

describe('device goals when a plan is created', () => {
	it('stores the overall goal and the typed targets, each with its baseline from the latest robotic assessment', async () => {
		const id = await createPatient(s.priya, uniq('gl').slice(0, 20), false);
		await assess(id, 'A0', { pluto: 50, mars: 40 });
		await assess(id, 'A1', { pluto: 58 }); // the latest PLUTO value is the baseline
		const r = await create(id, planFields([goal('PLUTO', 'FPS', 'AROM', 85), goal('MARS', 'ML', 'ROM', '52.5')]));
		expect(r.type).toBe('redirect');

		const plan = await planOf(id);
		expect(plan.goals).toEqual(['Improve grasp for self-feeding']);
		const [mars, pluto] = await goalsOf(plan.id);
		expect(pluto).toMatchObject({ deviceTypeId: 'PLUTO', mechanism: 'FPS', task: 'AROM', unit: 'deg', limb: 'left', baselineValue: 58, baselineTimepoint: 'A1', targetValue: 85 });
		expect(mars).toMatchObject({ deviceTypeId: 'MARS', mechanism: 'ML', task: 'ROM', unit: 'cm', baselineValue: 40, baselineTimepoint: 'A0', targetValue: 52.5 });
	});

	it('shows them on the patient page', async () => {
		const id = await createPatient(s.priya, uniq('gp').slice(0, 20), false);
		await assess(id, 'A0', { pluto: 50 });
		await create(id, planFields([goal('PLUTO', 'FPS', 'AROM', 80)]));
		const page = await pageData(s.priya, `/patients/${id}`);
		expect(page.plans[0].deviceGoals).toHaveLength(1);
		expect(page.plans[0].deviceGoals[0]).toMatchObject({ mechanism: 'FPS', baselineValue: 50, targetValue: 80 });
		expect((await pageData(s.vikram, `/patients/${id}`)).plans[0].deviceGoals).toHaveLength(1); // the consultant sees them too
	});

	it('accepts a goal for a mechanism that was never assessed: the first assessment will be its baseline', async () => {
		const id = await createPatient(s.priya, uniq('gn').slice(0, 20));
		expect((await create(id, planFields([goal('PLUTO', 'FPS', 'AROM', 70)]))).type).toBe('redirect');
		expect(await goalsOf((await planOf(id)).id)).toEqual([expect.objectContaining({ baselineValue: null, baselineTimepoint: null, targetValue: 70 })]);
	});

	it('needs no device goals at all', async () => {
		const id = await createPatient(s.priya);
		expect((await create(id, planFields(null))).type).toBe('redirect');
		expect(await goalsOf((await planOf(id)).id)).toEqual([]);
		expect((await create(await createPatient(s.priya), planFields('[]'))).type).toBe('redirect');
	});

	it('refuses a target that is not above the current value, and creates no plan', async () => {
		const id = await createPatient(s.priya, uniq('gb').slice(0, 20), false);
		await assess(id, 'A0', { pluto: 60 });
		for (const target of [60, 45]) {
			const r = await create(id, planFields([goal('PLUTO', 'FPS', 'AROM', target)]));
			expect(r.type).toBe('failure');
			expect(JSON.stringify(r.data)).toContain('must be above the current value (60°)');
		}
		expect(await db().therapyPlan.count({ where: { patientId: id } })).toBe(0);
	});

	it('refuses goals that make no sense', async () => {
		const id = await createPatient(s.priya);
		const bad: [string, unknown[] | string][] = [
			['a device that is not in the plan', [goal('ATOBOT', 'FPS', 'AROM', 70)]],
			['a mechanism the device does not have', [goal('MARS', 'FPS', 'ROM', 70)]],
			['a task without a range', [goal('PLUTO', 'FPS', 'DISC', 70)]],
			['a task of the wrong device', [goal('MARS', 'ML', 'AROM', 70)]],
			['the same goal twice', [goal('PLUTO', 'FPS', 'AROM', 70), goal('PLUTO', 'FPS', 'AROM', 80)]],
			['a target that is not a number', [goal('PLUTO', 'FPS', 'AROM', 'lots')]],
			['a zero target', [goal('PLUTO', 'FPS', 'AROM', 0)]],
			['a huge target', [goal('PLUTO', 'FPS', 'AROM', 99999)]],
			['text that is not JSON', 'not json'],
			['the wrong shape', '{"a":1}']
		];
		for (const [why, goals] of bad) {
			const r = await create(id, planFields(goals, { deviceTypeIds: ['PLUTO', 'MARS'] }));
			expect(r.type, why).toBe('failure');
			expect(r.status, why).toBe(400);
		}
		expect(await db().therapyPlan.count({ where: { patientId: id } })).toBe(0);
	});

	it('only the primary therapist may create it: others get 403, another centre 404', async () => {
		const id = await createPatient(s.priya);
		const goals = [goal('PLUTO', 'FPS', 'AROM', 70)];
		for (const who of ['vikram', 'arjun', 'admin'] as const) expect((await create(id, planFields(goals), s[who])).status, who).toBe(403);
		expect((await create(id, planFields(goals), s.rohan)).status).toBe(404);
		expect(await db().planGoal.count({ where: { plan: { patientId: id } } })).toBe(0);
	});
});

describe('changing goals when the plan is modified', () => {
	async function planWithGoals() {
		const id = await createPatient(s.priya, uniq('ge').slice(0, 20), false);
		await assess(id, 'A0', { pluto: 50, mars: 40 });
		await create(id, planFields([goal('PLUTO', 'FPS', 'AROM', 80), goal('MARS', 'ML', 'ROM', 55)]));
		return { id, plan: await planOf(id) };
	}
	const edit = (id: string, planId: string, over: Record<string, string | string[]> = {}, who = s.priya) =>
		who.action(`/patients/${id}?/editPlan`, { planId, status: 'Active', trainingSide: 'Left', dailyTargetMinutes: '30', targetSessions: '10', reason: 'Goals reviewed', deviceTypeIds: ['PLUTO', 'MARS'], ...over });

	it('changing a target keeps the baseline the goal was set with, even after new assessments', async () => {
		const { id, plan } = await planWithGoals();
		await assess(id, 'A1', { pluto: 65 }); // the patient has improved since
		const r = await edit(id, plan.id, { deviceGoals: JSON.stringify([goal('PLUTO', 'FPS', 'AROM', 90), goal('MARS', 'ML', 'ROM', 55)]) });
		expect(r.type).toBe('success');
		const pluto = (await goalsOf(plan.id)).find((g) => g.deviceTypeId === 'PLUTO')!;
		expect(pluto).toMatchObject({ targetValue: 90, baselineValue: 50, baselineTimepoint: 'A0' }); // not moved to A1's 65
	});

	it('a goal added later is measured from where the patient is by then', async () => {
		const { id, plan } = await planWithGoals();
		// the MARS assessment also measured the forward reach (AP)
		const a0 = await db().roboticAssessment.findFirstOrThrow({ where: { patientId: id, deviceTypeId: 'MARS', timepoint: 'A0' } });
		await db().roboticAssessmentResult.create({ data: { assessmentId: a0.id, mechanism: 'AP', task: 'ROM', status: 'Complete', unit: 'cm', romRange: 18, extra: { mlCm: 40, apCm: 18 } } });
		const goals = [goal('PLUTO', 'FPS', 'AROM', 80), goal('MARS', 'ML', 'ROM', 55), goal('MARS', 'AP', 'ROM', 25)];
		expect((await edit(id, plan.id, { deviceGoals: JSON.stringify(goals) })).type).toBe('success');
		const ap = (await goalsOf(plan.id)).find((g) => g.mechanism === 'AP')!;
		expect(ap).toMatchObject({ baselineValue: 18, targetValue: 25 });
	});

	it('removing a goal, and a goal whose device leaves the plan, are both gone', async () => {
		const { id, plan } = await planWithGoals();
		expect((await edit(id, plan.id, { deviceGoals: JSON.stringify([goal('MARS', 'ML', 'ROM', 55)]) })).type).toBe('success');
		expect((await goalsOf(plan.id)).map((g) => g.deviceTypeId)).toEqual(['MARS']);
		expect((await edit(id, plan.id, { deviceTypeIds: ['PLUTO'] })).type).toBe('success'); // MARS leaves, its goal with it
		expect(await goalsOf(plan.id)).toEqual([]);
	});

	it('a form that does not send the goals leaves them alone', async () => {
		const { id, plan } = await planWithGoals();
		expect((await edit(id, plan.id, { dailyTargetMinutes: '45' })).type).toBe('success');
		expect(await goalsOf(plan.id)).toHaveLength(2);
	});

	it('is recorded in the plan history, with the reason, like any other plan change', async () => {
		const { id, plan } = await planWithGoals();
		await edit(id, plan.id, { deviceGoals: JSON.stringify([goal('PLUTO', 'FPS', 'AROM', 95), goal('MARS', 'ML', 'ROM', 55)]), goals: 'A new overall aim', reason: 'Progressing faster than expected' });
		const revisions = await db().planRevision.findMany({ where: { planId: plan.id }, orderBy: { fieldChanged: 'asc' } });
		const device = revisions.find((r) => r.fieldChanged === 'Device goals')!;
		expect(device.previousValue).toContain('PLUTO FPS AROM: target 80°');
		expect(device.newValue).toContain('PLUTO FPS AROM: target 95°');
		expect(device.reason).toBe('Progressing faster than expected');
		expect(revisions.find((r) => r.fieldChanged === 'Overall goal')?.newValue).toBe('A new overall aim');
		expect((await planOf(id)).goals).toEqual(['A new overall aim']);
	});

	it('a bad target on edit changes nothing', async () => {
		const { id, plan } = await planWithGoals();
		const r = await edit(id, plan.id, { deviceGoals: JSON.stringify([goal('PLUTO', 'FPS', 'AROM', 40)]), notes: 'x' }); // below the baseline of 50
		expect(r.type).toBe('failure');
		expect((await goalsOf(plan.id)).find((g) => g.deviceTypeId === 'PLUTO')?.targetValue).toBe(80);
	});

	it('a covering therapist at the same centre may change them; consultant, engineer, admin and other centres may not', async () => {
		const { id, plan } = await planWithGoals();
		const colleague = await createUser(s.admin, { role: 'THERAPIST', locationId: await downtownId() });
		const goals = JSON.stringify([goal('PLUTO', 'FPS', 'AROM', 75), goal('MARS', 'ML', 'ROM', 55)]);
		expect((await edit(id, plan.id, { deviceGoals: goals }, colleague.client)).type).toBe('success');
		for (const who of ['vikram', 'arjun', 'admin'] as const) expect((await edit(id, plan.id, { deviceGoals: goals }, s[who])).status, who).toBe(403);
		expect((await edit(id, plan.id, { deviceGoals: goals }, s.rohan)).status).toBe(404);
	});
});

describe('goals follow the patient', () => {
	it('are removed with the plan and the patient', async () => {
		const id = await createPatient(s.priya, uniq('gd').slice(0, 20), false);
		await assess(id, 'A0', { pluto: 50 });
		await create(id, planFields([goal('PLUTO', 'FPS', 'AROM', 80)]));
		const planId = (await planOf(id)).id;
		await db().patient.delete({ where: { id } });
		expect(await db().planGoal.count({ where: { planId } })).toBe(0);
	});
});
