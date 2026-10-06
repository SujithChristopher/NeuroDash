import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPatient, db, pageData, signInAll, uniq, type Sessions } from './helpers';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});

const ROOT = () => process.env.TEST_DATA_DIR!;
const FIX = path.resolve(__dirname, '../fixtures/assessment');
const sync = () => s.arjun.action('/data-sync?/sync');
const codeOf = async (id: string) => (await db().patient.findUniqueOrThrow({ where: { id } })).displayCode;

/** Lays a package where the server's s2.py leaves it: <patient>/_assessments/<DEVICE>_<limb>_<TP>/ with .fingerprint last. */
function drop(code: string, device: 'PLUTO' | 'MARS', fingerprint = 'a'.repeat(64), opts: { limb?: string; tp?: string; withFingerprint?: boolean; files?: 'pluto' | 'mars' } = {}) {
	const { limb = 'right', tp = 'A0', withFingerprint = true, files = device === 'PLUTO' ? 'pluto' : 'mars' } = opts;
	const dir = path.join(ROOT(), code, '_assessments', `${device}_${limb}_${tp}`);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.cpSync(path.join(FIX, files), dir, { recursive: true });
	fs.copyFileSync(path.join(FIX, 'A0.locked'), path.join(dir, 'A0.locked'));
	if (withFingerprint) fs.writeFileSync(path.join(dir, '.fingerprint'), fingerprint);
	return dir;
}
const rows = (patientId: string) => db().roboticAssessment.findMany({ where: { patientId }, include: { results: true }, orderBy: [{ timepoint: 'asc' }, { deviceTypeId: 'asc' }] });

describe('a PLUTO assessment uploaded by a laptop', () => {
	it('is stored with its mechanisms and every task, and shown on the patient page', async () => {
		const id = await createPatient(s.priya, uniq('rp').slice(0, 20), false);
		drop(await codeOf(id), 'PLUTO');
		const r = await sync();
		expect(r.type).toBe('success');

		const [a] = await rows(id);
		expect(a).toMatchObject({ deviceTypeId: 'PLUTO', limb: 'right', timepoint: 'A0' });
		expect(a.lockedAt?.toISOString()).toBe('2026-07-07T12:30:55.000Z');
		expect((a.mechanisms as { code: string; ability: string }[]).map((m) => [m.code, m.ability])).toEqual([['FPS', 'Active'], ['WFE', 'Passive'], ['WURD', 'Active'], ['HOC', 'Passive']]);
		const fpsArom = a.results.find((x) => x.mechanism === 'FPS' && x.task === 'AROM')!;
		expect(fpsArom).toMatchObject({ status: 'Complete', unit: 'deg', attempts: 3 });
		expect(fpsArom.romRange).toBeCloseTo(68.88, 2);
		expect(a.results.find((x) => x.mechanism === 'WFE' && x.task === 'AROM')!.status).toBe('Skipped');

		const page = await pageData(s.priya, `/patients/${id}`);
		expect(page.roboticAssessments).toHaveLength(1);
		expect(page.roboticAssessments[0]).toMatchObject({ device: 'PLUTO', timepoint: 'A0', limb: 'right' });
		expect(page.hasAssessment).toBe(true);
	});

	it('is stored once: scanning again changes nothing, and a new fingerprint replaces the results', async () => {
		const id = await createPatient(s.priya, uniq('rq').slice(0, 20), false);
		const code = await codeOf(id);
		const dir = drop(code, 'PLUTO', '1'.repeat(64));
		await sync();
		const first = (await rows(id))[0];
		await sync();
		expect(await db().roboticAssessment.count({ where: { patientId: id } })).toBe(1);
		expect((await rows(id))[0].importedAt.getTime()).toBe(first.importedAt.getTime()); // not touched again

		// the device re-sent the timepoint with a different FPS AROM
		const details = path.join(dir, 'ai37220_right_A0_details.json');
		fs.writeFileSync(details, fs.readFileSync(details, 'utf8').replaceAll('-19.18124771118164', '-9.18124771118164'));
		fs.writeFileSync(path.join(dir, '.fingerprint'), '2'.repeat(64));
		await sync();
		const [again] = await rows(id);
		expect(again.id).toBe(first.id); // updated in place
		expect(again.results.find((x) => x.mechanism === 'FPS' && x.task === 'AROM')!.romRange).toBeCloseTo(78.88, 2);
		expect(again.results.length).toBe(first.results.length);
		expect(again.fingerprint).toBe('2'.repeat(64));
	});

	it('waits for the fingerprint: a package still being unpacked is ignored', async () => {
		const id = await createPatient(s.priya, uniq('rw').slice(0, 20), false);
		drop(await codeOf(id), 'PLUTO', undefined, { withFingerprint: false });
		await sync();
		expect(await db().roboticAssessment.count({ where: { patientId: id } })).toBe(0);
	});

	it('is kept as unmatched until the patient exists, then stored', async () => {
		const code = uniq('late').slice(0, 20);
		drop(code, 'PLUTO');
		await sync();
		const file = await db().ingestedFile.findUniqueOrThrow({ where: { path: `${code}/_assessments/PLUTO_right_A0` } });
		expect(file).toMatchObject({ status: 'unmatched', kind: 'assessment' });
		const id = await createPatient(s.priya, code, false);
		await sync();
		expect(await db().roboticAssessment.count({ where: { patientId: id } })).toBe(1);
	});

	it('is refused when the files are not those of the device that sent them', async () => {
		const id = await createPatient(s.priya, uniq('rx').slice(0, 20), false);
		drop(await codeOf(id), 'MARS', undefined, { files: 'pluto' });
		await sync();
		expect(await db().roboticAssessment.count({ where: { patientId: id } })).toBe(0);
		expect((await db().ingestedFile.findFirstOrThrow({ where: { patientCode: await codeOf(id), kind: 'assessment' } })).status).toBe('error');
	});
});

describe('a MARS assessment', () => {
	it('stores the reach range of each movement and which targets were completed', async () => {
		const id = await createPatient(s.priya, uniq('rm').slice(0, 20), false);
		drop(await codeOf(id), 'MARS');
		await sync();
		const [a] = await rows(id);
		expect(a).toMatchObject({ deviceTypeId: 'MARS', timepoint: 'A0' });
		const by = (m: string) => a.results.find((x) => x.mechanism === m)!;
		expect(by('ML')).toMatchObject({ task: 'ROM', unit: 'cm', status: 'Complete' });
		expect(by('ML').romRange).toBeGreaterThan(40);
		expect(by('AP').romRange).toBeGreaterThan(15);
		expect(by('ARMWEIGHT')).toMatchObject({ task: 'CHECK', status: 'Complete' });
		expect(by('DISCRETE').comment).toBe('4 of 4 targets completed');
	});

	it('shows a PLUTO and a MARS timepoint side by side, and two timepoints of one device for the graph', async () => {
		const id = await createPatient(s.priya, uniq('rb').slice(0, 20), false);
		const code = await codeOf(id);
		drop(code, 'PLUTO', 'b'.repeat(64), { tp: 'A0' });
		drop(code, 'PLUTO', 'c'.repeat(64), { tp: 'A1' });
		drop(code, 'MARS', 'd'.repeat(64), { tp: 'A0' });
		await sync();
		const page = await pageData(s.priya, `/patients/${id}`);
		expect(page.roboticAssessments.map((a: { device: string; timepoint: string }) => `${a.device} ${a.timepoint}`).sort()).toEqual(['MARS A0', 'PLUTO A0', 'PLUTO A1']);
	});
});

describe('who sees robotic assessments, and what they unlock', () => {
	it('only people who can see the patient: another centre gets 404, an engineer 403', async () => {
		const id = await createPatient(s.priya, uniq('rs').slice(0, 20), false);
		drop(await codeOf(id), 'PLUTO');
		await sync();
		expect((await s.rohan.get(`/patients/${id}`)).status).toBe(404);
		expect((await s.arjun.get(`/patients/${id}`)).status).toBe(403);
		expect((await s.vikram.get(`/patients/${id}`)).status).toBe(200); // the consultant at the same centre
		expect((await pageData(s.vikram, `/patients/${id}`)).roboticAssessments).toHaveLength(1);
	});

	it('counts as an assessment: the therapy plan can then be created', async () => {
		const id = await createPatient(s.priya, uniq('rg').slice(0, 20), false);
		const plan = () => s.priya.action(`/patients/${id}?/createPlan`, { trainingSide: 'Left', startDate: '2026-12-01', durationDays: '5', dailyTargetMinutes: '30', deviceTypeIds: ['PLUTO'] });
		expect((await plan()).status).toBe(409); // nothing assessed yet
		drop(await codeOf(id), 'PLUTO');
		await sync();
		expect((await plan()).type).toBe('redirect');
	});

	it('removes the assessments with the patient', async () => {
		const id = await createPatient(s.priya, uniq('rd').slice(0, 20), false);
		drop(await codeOf(id), 'PLUTO');
		await sync();
		await db().patient.delete({ where: { id } });
		expect(await db().roboticAssessment.count({ where: { patientId: id } })).toBe(0);
		expect(await db().roboticAssessmentResult.count({ where: { assessment: { patientId: id } } })).toBe(0);
	});
});
