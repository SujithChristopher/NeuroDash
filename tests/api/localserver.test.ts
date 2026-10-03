import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, createPatient, db, pageData, signInAll, uniq, type Sessions } from './helpers';

const ROOT = () => process.env.TEST_DATA_DIR!;
let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});

const readJson = (...p: string[]) => JSON.parse(fs.readFileSync(path.join(ROOT(), ...p), 'utf8'));
const exists = (...p: string[]) => fs.existsSync(path.join(ROOT(), ...p));
const registry = () => readJson('patients.json') as { version: number; patients: Record<string, unknown>[] };
const entry = (code: string) => registry().patients.find((p) => p.user_id === code);

/**
 * Sets a patient's devices the way a therapist does: in the therapy plan. The first call creates the plan; later calls
 * modify it (adding or removing devices). Returns the action response.
 */
async function setDevices(pid: string, deviceTypeIds: string[], over: Record<string, string> = {}, client: Client = s.priya) {
	const plan = await db().therapyPlan.findFirst({ where: { patientId: pid } });
	if (!plan) {
		return client.action(`/patients/${pid}?/createPlan`, { trainingSide: 'Left', startDate: '2026-12-01', durationDays: '5', dailyTargetMinutes: '30', deviceTypeIds, ...over });
	}
	return client.action(`/patients/${pid}?/editPlan`, {
		planId: plan.id,
		status: 'Active',
		trainingSide: plan.trainingSide ?? 'Left',
		dailyTargetMinutes: String(plan.dailyTargetMinutes),
		targetSessions: String(plan.targetSessions ?? 5),
		reason: 'Device change',
		deviceTypeIds,
		...over
	});
}

/** Registers a patient as Priya (hospital ID, date of birth, gender, side). Devices, when given, are set in a plan afterwards. */
async function register(over: Record<string, string | string[]> = {}, client: Client = s.priya) {
	const { deviceTypeIds, ...fields } = over;
	const r = await client.action('/patients/new', { patientId: uniq('p').slice(0, 20), dob: '1970-01-01', affectedSide: 'Left', gender: 'Female', ...fields });
	if (r.type === 'redirect' && deviceTypeIds?.length) await setDevices(idOf(r), deviceTypeIds as string[], {}, client);
	return r;
}
const idOf = (r: { location?: string }) => r.location!.split('/patients/')[1];

// --- device CSVs in the real laptop format (see localserver/s2.py) -------------------------------------------------
const SESSION_HEADER =
	'SessionNumber,DateTime,TrialNumberDay,TrialNumberSession,TrialStartTime,TrialStopTime,TrialRawDataFile,Movement,TrainingPlaneAngle,GameName,ReachSpeed,GameParameter,GameDuration,SuccessRate,MoveTime,CurrentTargets,CurrentHits,CurrentMisses,CummulativeTargets,CummulativeHits,CummulativeMisses,currentStar,CummulativeStars,RawDataFileName';
const trial = (sn: number, date: string, n: number, targets: number, hits: number, stars: number, game = 'SS') =>
	`${sn},${date} 10:56:02,${n},${n},${date} 10:57:24,${date} 10:58:25,x,ML,-90,${game},0.025,18.7,60,100,60,${targets},${hits},${targets - hits},${targets},${hits},${targets - hits},${stars},${stars},raw-${sn}-${n}.csv`;
const sessionsCsv = (user: string, device: string, rows: string[]) => `﻿:Location: ranipet\n:Device: ${device}\n:User: ${user}\n${SESSION_HEADER}\n${rows.join('\n')}\n`;
const configCsv = (user: string) =>
	`HomerID,StartDate,EndDate,TotalTime,ML,AP,MLAP,ForeArmLength,UpperArmLength,TrainingSide,Location,Group\n${user},28-09-2026 10:55:52,26-10-2026 23:59:59,0,0,0,0,250,150,Right,ranipet,Experimental\n${user},28-09-2026 10:57:18,26-10-2026 23:59:59,30,10,10,10,250,150,Right,ranipet,Experimental\n`;

function drop(user: string, laptop: string, file: string, content: string, sub = '') {
	const dir = path.join(ROOT(), user, laptop, sub);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, file), content);
}
const sync = (c: Client = s.arjun) => c.action<{ message?: string; error?: string }>('/data-sync?/sync');
const fileRow = (rel: string) => db().ingestedFile.findUnique({ where: { path: rel } });

describe('registering a patient creates its folder and files', () => {
	it('makes <data dir>/<patient ID>/ and adds the patient to the ONE common patients.json', async () => {
		const id = uniq('pt').slice(0, 20);
		const before = exists('patients.json') ? registry().version : 0;
		const r = await register({ patientId: id, deviceTypeIds: ['PLUTO', 'MARS'] });
		expect(r.type).toBe('redirect');

		expect(fs.statSync(path.join(ROOT(), id)).isDirectory()).toBe(true);
		// There is no per-patient JSON: the patient and their devices live in the common patients.json (and the database).
		expect(exists(id, 'patient.json')).toBe(false);
		expect(fs.readdirSync(path.join(ROOT(), id))).toEqual([]);

		expect(entry(id)).toEqual({ user_id: id, status: 'active', side: 'left', devices: ['MARS', 'PLUTO'] });
		expect(registry().version).toBeGreaterThan(before);
	});

	it('stores the allocated devices in the database table', async () => {
		const id = uniq('pt').slice(0, 20);
		const r = await register({ patientId: id, deviceTypeIds: ['NOARK', 'MARS'] });
		const rows = await db().patientDevice.findMany({ where: { patientId: idOf(r) }, include: { allocatedBy: true } });
		expect(rows.map((x) => x.deviceTypeId).sort()).toEqual(['MARS', 'NOARK']);
		expect(rows.every((x) => x.allocatedBy?.email === 'priya.nair@neurodash.care')).toBe(true);
	});

	it('keeps personal details out of the shared patients.json', async () => {
		const id = uniq('pii').slice(0, 20);
		await register({ patientId: id, dob: '1971-02-03', strokeDate: '2026-05-06', deviceTypeIds: ['PLUTO'] });
		const text = fs.readFileSync(path.join(ROOT(), 'patients.json'), 'utf8');
		for (const secret of ['1971-02-03', '2026-05-06', 'Female']) expect(text).not.toContain(secret);
	});

	it('rejects unsafe, reserved, duplicate and unknown-device registrations without creating anything', async () => {
		const bad: [string, Record<string, string | string[]>][] = [
			['spaces', { patientId: 'has space' }],
			['path traversal', { patientId: '../escape' }],
			['slash', { patientId: 'a/b' }],
			['too long', { patientId: 'x'.repeat(41) }],
			['device name', { patientId: 'PLUTO' }],
			['device name + number', { patientId: 'mars01' }],
			['server folder', { patientId: '_incoming' }],
			['server file', { patientId: 'patients' }],
			['no ID', { patientId: '' }]
		];
		for (const [label, over] of bad) {
			const r = await register(over);
			expect(r.type, label).toBe('failure');
			if (typeof over.patientId === 'string' && over.patientId) expect(exists(over.patientId), label).toBe(false);
		}
		expect(exists('..', 'escape')).toBe(false);
	});

	it('rejects a duplicate Patient ID, ignoring case', async () => {
		const id = uniq('dup').slice(0, 20);
		expect((await register({ patientId: id })).type).toBe('redirect');
		const r = await register({ patientId: id.toUpperCase() });
		expect(r.type).toBe('failure');
		expect(r.status).toBe(409);
	});

	it('only therapists can register patients', async () => {
		for (const who of ['vikram', 'arjun', 'admin'] as const) expect((await register({ patientId: uniq('x') }, s[who])).status, who).toBe(403);
	});

	it('leaves other patients and unknown fields in patients.json untouched', async () => {
		const reg = exists('patients.json') ? registry() : { version: 0, patients: [] as Record<string, unknown>[] };
		reg.patients.push({ user_id: 'legacy-118', status: 'active', side: 'right', devices: ['PLUTO'], note: 'written by the python CLI' });
		fs.writeFileSync(path.join(ROOT(), 'patients.json'), JSON.stringify({ ...reg, updated_at: 'x', extra: 'keep-me' }));
		await register({ patientId: uniq('after').slice(0, 20), deviceTypeIds: ['MARS'] });
		expect(entry('legacy-118')).toMatchObject({ note: 'written by the python CLI', devices: ['PLUTO'] });
		expect(readJson('patients.json').extra).toBe('keep-me');
	});

	it('survives concurrent registrations without losing any entry', async () => {
		const ids = Array.from({ length: 6 }, () => uniq('c').slice(0, 20));
		await Promise.all(ids.map((patientId) => register({ patientId, deviceTypeIds: ['PLUTO'] })));
		for (const id of ids) expect(entry(id), id).toBeTruthy();
		const codes = registry().patients.map((p) => p.user_id);
		expect(new Set(codes).size).toBe(codes.length); // no duplicate entries
	});
});

describe('changing devices in the therapy plan', () => {
	let id: string;
	let code: string;
	beforeAll(async () => {
		code = uniq('al').slice(0, 20);
		id = idOf(await register({ patientId: code, deviceTypeIds: ['PLUTO'] }));
	});
	const change = (c: Client, ids: string[], over: Record<string, string> = {}) => setDevices(id, ids, over, c);
	const tableDevices = async () => (await db().patientDevice.findMany({ where: { patientId: id } })).map((x) => x.deviceTypeId).sort();
	const planDevices = async () => (await db().planDevice.findMany({ where: { plan: { patientId: id } } })).map((x) => x.deviceTypeId).sort();

	it('modifying the plan replaces its devices in the plan, the patient table and patients.json', async () => {
		expect((await change(s.priya, ['MARS', 'ATOBOT'], { trainingSide: 'Both' })).type).toBe('success');
		expect(await tableDevices()).toEqual(['ATOBOT', 'MARS']);
		expect(await planDevices()).toEqual(['ATOBOT', 'MARS']);
		expect(entry(code)).toMatchObject({ devices: ['ATOBOT', 'MARS'], side: 'both' });
		expect(await db().planRevision.findFirst({ where: { plan: { patientId: id }, fieldChanged: 'Devices' } })).toMatchObject({ previousValue: 'PLUTO', newValue: 'ATOBOT, MARS' });
	});

	it('drops a legacy limb field from an entry it updates', async () => {
		const legacy = uniq('ol').slice(0, 20);
		const reg = registry();
		reg.patients.push({ user_id: legacy, status: 'active', limb: 'hand', side: 'left', devices: ['PLUTO'] });
		fs.writeFileSync(path.join(ROOT(), 'patients.json'), JSON.stringify(reg));
		const pid = idOf(await register({ patientId: legacy }));
		await setDevices(pid, ['MARS']);
		expect(entry(legacy)).toEqual({ user_id: legacy, status: 'active', side: 'left', devices: ['MARS'] });
	});

	it('does not bump the patients.json version when only a note changed', async () => {
		await change(s.priya, ['MARS', 'ATOBOT'], { trainingSide: 'Both' });
		const v = registry().version;
		await change(s.priya, ['MARS', 'ATOBOT'], { trainingSide: 'Both', notes: 'just a note' });
		expect(registry().version).toBe(v);
		await change(s.priya, ['MARS'], { trainingSide: 'Both' });
		expect(registry().version).toBe(v + 1);
	});

	it('removing a device keeps its recorded sessions everywhere (progress, report, devices tab)', async () => {
		const code = uniq('keep').slice(0, 20);
		const pid = idOf(await register({ patientId: code, deviceTypeIds: ['MARS', 'PLUTO'] }));
		const unit = async (t: string) => (await db().device.findFirstOrThrow({ where: { deviceTypeId: t } })).id;
		for (const [t, n] of [['MARS', 1], ['PLUTO', 2]] as const) {
			await db().therapySession.create({ data: { patientId: pid, deviceId: await unit(t), sourceDevice: t, sessionNumber: n, sessionDate: new Date(), startTime: new Date(), durationMinutes: 10, totalTargets: 5, totalHits: 4 } });
		}
		expect((await setDevices(pid, ['MARS'])).type).toBe('success'); // PLUTO removed from the plan
		const page = await pageData(s.priya, `/patients/${pid}`);
		expect(page.sessions.map((x: { device: { typeId: string } }) => x.device.typeId).sort()).toEqual(['MARS', 'PLUTO']);
		expect(page.trainingDevices.map((x: { deviceTypeId: string }) => x.deviceTypeId)).toEqual(['MARS']);
		expect(page.formerDevices.map((x: { deviceTypeId: string }) => x.deviceTypeId)).toEqual(['PLUTO']);
		const report = (await pageData(s.priya, `/reports?view=patient&patient=${pid}`)).patientReport;
		expect(report.devices.map((x: { typeId: string }) => x.typeId).sort()).toEqual(['MARS', 'PLUTO']);
		expect(report.plan.devices).toEqual(['Mars']);
	});

	it('needs at least one real device', async () => {
		expect((await change(s.priya, [])).type).toBe('failure');
		expect((await change(s.priya, ['NOPE'])).type).toBe('failure');
		expect(await tableDevices()).toEqual(['MARS']);
	});

	it('a plan cannot be created twice: modify the existing one', async () => {
		const r = await s.priya.action(`/patients/${id}?/createPlan`, { trainingSide: 'Left', startDate: '2026-12-01', durationDays: '5', dailyTargetMinutes: '30', deviceTypeIds: ['MARS'] });
		expect(r.type).toBe('failure');
		expect(r.status).toBe(409);
		expect(await db().therapyPlan.count({ where: { patientId: id } })).toBe(1);
	});

	it('the primary therapist and a covering colleague may change devices; consultant, admin and other centres may not', async () => {
		for (const who of ['vikram', 'arjun', 'admin'] as const) expect((await change(s[who], ['MARS'])).status, who).toBe(403);
		expect((await change(s.rohan, ['MARS'])).status).toBe(404);
	});

	it('pausing, completing or reactivating the plan moves the patient and patients.json with it', async () => {
		const pid = idOf(await register({ patientId: uniq('ps').slice(0, 20), deviceTypeIds: ['MARS'] }));
		const c = (await db().patient.findUniqueOrThrow({ where: { id: pid } })).displayCode;
		const status = async () => (await db().patient.findUniqueOrThrow({ where: { id: pid } })).status;
		expect((await setDevices(pid, ['MARS'], { status: 'Paused' })).type).toBe('success');
		expect([await status(), entry(c)?.status]).toEqual(['Paused', 'paused']);
		expect((await setDevices(pid, ['MARS'], { status: 'Completed' })).type).toBe('success');
		expect([await status(), entry(c)?.status]).toEqual(['Completed', 'discharged']);
		expect((await setDevices(pid, ['MARS'], { status: 'Discontinued' })).type).toBe('success');
		expect(await status()).toBe('Discontinued');
		expect((await setDevices(pid, ['MARS'], { status: 'Active' })).type).toBe('success');
		expect([await status(), entry(c)?.status]).toEqual(['Active', 'active']); // no session yet: Active, not Ongoing
		expect(await db().auditLog.count({ where: { action: 'Patient Status Changed', entityId: pid } })).toBe(4);
	});

	it('reactivating a plan of a patient who has trained makes them Ongoing again', async () => {
		const code = uniq('rs').slice(0, 20);
		const pid = idOf(await register({ patientId: code, deviceTypeIds: ['MARS'] }));
		await db().therapySession.create({ data: { patientId: pid, deviceId: (await db().device.findFirstOrThrow({ where: { deviceTypeId: 'MARS' } })).id, sessionDate: new Date(), startTime: new Date(), totalTargets: 1, totalHits: 1 } });
		await setDevices(pid, ['MARS'], { status: 'Paused' });
		await setDevices(pid, ['MARS'], { status: 'Active' });
		expect((await db().patient.findUniqueOrThrow({ where: { id: pid } })).status).toBe('Ongoing');
	});

	it('status changes reach the laptops as active / paused / discharged', async () => {
		await s.priya.action(`/patients/${id}?/setStatus`, { status: 'Paused' });
		expect(entry(code)?.status).toBe('paused');
		await s.priya.action(`/patients/${id}?/setStatus`, { status: 'Completed' });
		expect(entry(code)?.status).toBe('discharged');
		await s.priya.action(`/patients/${id}?/setStatus`, { status: 'Active' });
		expect(entry(code)?.status).toBe('active');
	});
});

describe('ingesting what the laptops upload', () => {
	it('stores sessions, trials, stars and accuracy from sessions.csv', async () => {
		const code = uniq('ing').slice(0, 20);
		const pid = idOf(await register({ patientId: code, deviceTypeIds: ['MARS'] }));
		drop(code, 'PLUTO01', 'sessions.csv', sessionsCsv(code, 'MARS', [trial(1, '2026-09-28', 1, 28, 28, 1), trial(2, '2026-09-28', 1, 32, 24, 3)]));

		const r = await sync();
		expect(r.type).toBe('success');
		expect(r.data?.message).toMatch(/imported/);

		const sessions = await db().therapySession.findMany({ where: { patientId: pid }, include: { trials: true, device: true }, orderBy: { sessionNumber: 'asc' } });
		expect(sessions).toHaveLength(2);
		expect(sessions[0]).toMatchObject({ sessionNumber: 1, totalTargets: 28, totalHits: 28, totalMisses: 0, totalStars: 1, sourceDevice: 'MARS' });
		expect(sessions[1]).toMatchObject({ sessionNumber: 2, totalTargets: 32, totalHits: 24, totalStars: 3 });
		expect(sessions[0].sessionDate.toISOString().slice(0, 10)).toBe('2026-09-28');
		expect(Number(sessions[0].durationMinutes)).toBe(1);
		expect(sessions[0].device.deviceTypeId).toBe('MARS'); // the :Device: header decides, not the PLUTO01 laptop folder
		expect(sessions[0].trials[0]).toMatchObject({ trialType: 'GAME', gameCode: 'SS', gameId: null, mechanism: 'ML', targets: 28, hits: 28, stars: 1, durationSec: 60, rawDataRef: 'raw-1-1.csv' });

		const f = await fileRow(`${code}/PLUTO01/sessions.csv`);
		expect([f?.status, f?.rows, f?.device, f?.patientCode]).toEqual(['ok', 2, 'MARS', code]);
	});

	it('shows up in the patient’s charts, stars and session drawer data', async () => {
		const code = uniq('chart').slice(0, 20);
		const pid = idOf(await register({ patientId: code, deviceTypeIds: ['MARS'] }));
		drop(code, 'MARS01', 'sessions.csv', sessionsCsv(code, 'MARS', [trial(1, '2026-09-28', 1, 20, 15, 2), trial(2, '2026-09-29', 1, 20, 20, 3)]));
		await sync();

		const d = await pageData(s.priya, `/patients/${pid}?tab=progress`);
		expect(d.sessions).toHaveLength(2);
		expect(d.sessions.map((x: { totalStars: number }) => x.totalStars).sort()).toEqual([2, 3]);
		expect(d.sessions.map((x: { accuracyPct: number }) => x.accuracyPct).sort((a: number, b: number) => a - b)).toEqual([75, 100]);
		expect((await s.priya.get(`/patients/${pid}?tab=progress`)).status).toBe(200); // renders without a plan

		const detail = await (await s.priya.get(`/api/sessions/${d.sessions[0].id}`)).json();
		expect(detail.trials[0]).toMatchObject({ label: 'SS', targets: expect.any(Number), stars: expect.any(Number) });
	});

	it('is idempotent: a second scan changes nothing, and a re-upload updates instead of duplicating', async () => {
		const code = uniq('idem').slice(0, 20);
		const pid = idOf(await register({ patientId: code, deviceTypeIds: ['MARS'] }));
		drop(code, 'MARS01', 'sessions.csv', sessionsCsv(code, 'MARS', [trial(1, '2026-09-28', 1, 10, 10, 1)]));
		await sync();
		const second = await sync();
		expect(second.data?.message).toMatch(/0 imported/);
		expect(await db().therapySession.count({ where: { patientId: pid } })).toBe(1);

		// The laptop re-uploads the cumulative file with a second trial in session 1 and a new session 2.
		drop(code, 'MARS01', 'sessions.csv', sessionsCsv(code, 'MARS', [trial(1, '2026-09-28', 1, 10, 10, 1), trial(1, '2026-09-28', 2, 10, 5, 0), trial(2, '2026-09-29', 1, 12, 12, 2)]));
		await sync();
		const sessions = await db().therapySession.findMany({ where: { patientId: pid }, include: { trials: true }, orderBy: { sessionNumber: 'asc' } });
		expect(sessions).toHaveLength(2);
		expect(sessions[0].trials).toHaveLength(2); // replaced, not appended
		expect([sessions[0].totalTargets, sessions[0].totalHits]).toEqual([20, 15]);
		expect(await db().sessionTrial.count({ where: { session: { patientId: pid } } })).toBe(3);
	});

	it('stores configdata.csv rows and shows them on the patient', async () => {
		const code = uniq('cfg').slice(0, 20);
		const pid = idOf(await register({ patientId: code, deviceTypeIds: ['PLUTO'] }));
		drop(code, 'PLUTO01', 'configdata.csv', configCsv(code));
		await sync();
		const rows = await db().deviceConfig.findMany({ where: { patientId: pid }, orderBy: { startDate: 'asc' } });
		expect(rows).toHaveLength(2);
		expect(rows[1]).toMatchObject({ device: 'PLUTO', totalTime: 30, ml: 10, ap: 10, mlap: 10, foreArmLength: 250, upperArmLength: 150, trainingSide: 'Right', location: 'ranipet', groupName: 'Experimental' });
		await sync(); // re-scan: still two rows
		expect(await db().deviceConfig.count({ where: { patientId: pid } })).toBe(2);
		expect((await pageData(s.priya, `/patients/${pid}?tab=devices`)).deviceConfigs).toHaveLength(2);
	});

	it('links sessions to the therapy plan and records real minutes and missed days', async () => {
		const code = uniq('plan').slice(0, 20);
		const pid = idOf(await register({ patientId: code }));
		await s.priya.action(`/patients/${pid}?/createPlan`, { trainingSide: 'Left', name: 'Real plan', startDate: '2026-09-28', durationDays: '10', dailyTargetMinutes: '60', deviceTypeIds: ['MARS'] });
		drop(code, 'MARS01', 'sessions.csv', sessionsCsv(code, 'MARS', [trial(1, '2026-09-28', 1, 10, 10, 1), trial(2, '2026-09-28', 1, 10, 9, 1)]));
		await sync();

		const plan = await db().therapyPlan.findFirstOrThrow({ where: { patientId: pid }, include: { dayLog: { orderBy: { dayNumber: 'asc' } } } });
		const sessions = await db().therapySession.findMany({ where: { patientId: pid } });
		expect(sessions.every((x) => x.planId === plan.id && x.planDayLogId === plan.dayLog[0].id)).toBe(true);
		expect(plan.dayLog[0]).toMatchObject({ actualMinutes: 2, status: 'done' }); // any training that day counts as done
		expect(plan.dayLog[1].status).toBe('missed'); // 29 Sep passed with no training
	});

	it('does not touch plan days for patients with no device data', async () => {
		const pid = idOf(await register({ patientId: uniq('quiet').slice(0, 20), deviceTypeIds: ['MARS'] }));
		await s.priya.action(`/patients/${pid}?/createPlan`, { trainingSide: 'Left', name: 'Quiet', startDate: '2026-09-28', durationDays: '5', dailyTargetMinutes: '60', deviceTypeIds: ['MARS'] });
		await sync();
		const days = await db().planDayLog.findMany({ where: { plan: { patientId: pid } } });
		expect(days.every((d) => d.status === 'upcoming')).toBe(true);
	});

	it('reports a patient that does not exist yet as unmatched, then imports it once registered', async () => {
		const code = uniq('late').slice(0, 20);
		drop(code, 'MARS01', 'sessions.csv', sessionsCsv(code, 'MARS', [trial(1, '2026-09-28', 1, 10, 10, 1)]));
		await sync();
		const f = await fileRow(`${code}/MARS01/sessions.csv`);
		expect(f?.status).toBe('unmatched');
		expect(f?.message).toMatch(/Register the patient/);

		const pid = idOf(await register({ patientId: code, deviceTypeIds: ['MARS'] })); // the folder already exists: fine
		await sync();
		expect((await fileRow(`${code}/MARS01/sessions.csv`))?.status).toBe('ok');
		expect(await db().therapySession.count({ where: { patientId: pid } })).toBe(1);
	});

	it('rejects bad files with a clear reason and imports nothing from them', async () => {
		const mk = async (label: string, content: string, laptop = 'MARS01', folderUser?: string) => {
			const code = uniq(label).slice(0, 20);
			await register({ patientId: code, deviceTypeIds: ['MARS'] });
			drop(folderUser ?? code, laptop, 'sessions.csv', content.replaceAll('{u}', code));
			return code;
		};
		const wrongUser = await mk('wu', sessionsCsv('someoneelse', 'MARS', [trial(1, '2026-09-28', 1, 1, 1, 0)]));
		const noUser = await mk('nu', `:Device: MARS\n${SESSION_HEADER}\n${trial(1, '2026-09-28', 1, 1, 1, 0)}\n`);
		const badDevice = await mk('bd', sessionsCsv('{u}', 'ZZZ', [trial(1, '2026-09-28', 1, 1, 1, 0)]));
		const noColumns = await mk('nc', ':User: {u}\n:Device: MARS\nFoo,Bar\n1,2\n');
		const empty = await mk('em', ':User: {u}\n:Device: MARS\n');
		await sync();

		const expectError = async (code: string, re: RegExp) => {
			const f = await fileRow(`${code}/MARS01/sessions.csv`);
			expect([code, f?.status]).toEqual([code, 'error']);
			expect(f?.message).toMatch(re);
			expect(await db().therapySession.count({ where: { patient: { displayCode: code } } })).toBe(0);
		};
		await expectError(wrongUser, /sits in the folder|for "someoneelse"/);
		await expectError(noUser, /No ":User:" line/);
		await expectError(badDevice, /not a device type/);
		await expectError(noColumns, /required column/);
		await expectError(empty, /no trial rows|required column|header/i);
	});

	it('imports the good rows of a file with a bad row and notes it', async () => {
		const code = uniq('part').slice(0, 20);
		const pid = idOf(await register({ patientId: code, deviceTypeIds: ['MARS'] }));
		drop(code, 'MARS01', 'sessions.csv', sessionsCsv(code, 'MARS', [trial(1, '2026-09-28', 1, 10, 10, 1), 'x,not-a-date,1,1,,,,,,,,,,,,1,1', trial(2, '2026-09-29', 1, 10, 8, 0)]));
		await sync();
		const f = await fileRow(`${code}/MARS01/sessions.csv`);
		expect(f?.status).toBe('ok');
		expect(f?.message).toMatch(/1 row\(s\) skipped/);
		expect(await db().therapySession.count({ where: { patientId: pid } })).toBe(2);
	});

	it('rejects a configdata.csv that mixes patients', async () => {
		const code = uniq('mix').slice(0, 20);
		await register({ patientId: code, deviceTypeIds: ['PLUTO'] });
		drop(code, 'PLUTO01', 'configdata.csv', `HomerID,StartDate\n${code},28-09-2026 10:00:00\nother,28-09-2026 11:00:00\n`);
		await sync();
		const f = await fileRow(`${code}/PLUTO01/configdata.csv`);
		expect([f?.status, f?.message]).toEqual(['error', expect.stringMatching(/several HomerIDs/)]);
	});

	it('ignores the server’s own folders, backups and unrelated files', async () => {
		const code = uniq('skip').slice(0, 20);
		await register({ patientId: code, deviceTypeIds: ['MARS'] });
		const good = sessionsCsv(code, 'MARS', [trial(1, '2026-09-28', 1, 5, 5, 1)]);
		drop(code, 'MARS01', 'sessions.csv', good, 'backup'); // backup copies
		drop('_incoming', 'MARS01', 'sessions.csv', good); // partial uploads
		drop(code, 'MARS01', 'raw-sess01-trial001.csv', 'a,b\n1,2\n'); // raw trial data
		await sync();
		const paths = (await db().ingestedFile.findMany({ where: { OR: [{ path: { startsWith: `${code}/` } }, { path: { startsWith: '_incoming' } }] } })).map((x) => x.path);
		expect(paths).toEqual([]);
		expect(await db().therapySession.count({ where: { patient: { displayCode: code } } })).toBe(0);
	});
});

describe('the Data Sync page', () => {
	it('is for the engineer (can sync) and the admin (view only)', async () => {
		expect((await s.arjun.get('/data-sync')).status).toBe(200);
		expect((await s.admin.get('/data-sync')).status).toBe(200);
		for (const who of ['priya', 'rohan', 'vikram'] as const) expect((await s[who].get('/data-sync')).status, who).toBe(403);
		expect((await s.anon.get('/data-sync')).status).toBe(302);

		expect((await sync(s.arjun)).type).toBe('success');
		for (const who of ['admin', 'priya', 'vikram'] as const) expect((await sync(s[who])).status, who).toBe(403);
		expect((await pageData(s.arjun, '/data-sync')).canSync).toBe(true);
		expect((await pageData(s.admin, '/data-sync')).canSync).toBe(false);
	});

	it('reports totals and recent files', async () => {
		const d = await pageData(s.arjun, '/data-sync');
		expect(d.configured).toBe(true);
		expect(d.totals.sessions).toBeGreaterThan(0);
		expect(d.totals.ok).toBeGreaterThan(0);
		expect(d.files.length).toBeGreaterThan(0);
		expect(d.lastRun).toMatchObject({ scanned: expect.any(Number) });
	});

	it('shows laptops from devices.json with online/offline and up-to-date state', async () => {
		const local = (ms: number) => new Date(Date.now() - ms - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
		const v = registry().version;
		fs.writeFileSync(
			path.join(ROOT(), 'devices.json'),
			JSON.stringify({
				PLUTO01: { last_seen: local(5_000), version: v, ip: '192.168.0.10' },
				MARS01: { last_seen: local(5_000), version: v - 1, ip: '192.168.0.11' },
				NOARK01: { last_seen: local(10 * 60_000), version: v, ip: '192.168.0.12' }
			})
		);
		const laptops = (await pageData(s.arjun, '/data-sync')).laptops as { device: string; state: string; upToDate: boolean }[];
		const by = Object.fromEntries(laptops.map((l) => [l.device, l]));
		expect(by.PLUTO01).toMatchObject({ state: 'online', upToDate: true });
		expect(by.MARS01).toMatchObject({ state: 'online', upToDate: false });
		expect(by.NOARK01).toMatchObject({ state: 'offline' });
	});

	it('audits an import run', async () => {
		const code = uniq('aud').slice(0, 20);
		await register({ patientId: code, deviceTypeIds: ['MARS'] });
		drop(code, 'MARS01', 'sessions.csv', sessionsCsv(code, 'MARS', [trial(1, '2026-09-28', 1, 5, 5, 1)]));
		await sync();
		const a = await db().auditLog.findFirst({ where: { action: 'Device Data Synced' }, orderBy: { occurredAt: 'desc' } });
		expect([a?.actorRole, a?.entityType]).toEqual(['SYSTEM', 'Data Sync']);
	});
});

describe('live updates for the open dashboard', () => {
	const live = async (c: Client) => ((await (await c.get('/api/live')).json()) as { version: string }).version;

	it('needs a signed-in user and exposes no patient data', async () => {
		expect((await s.anon.get('/api/live')).status).toBe(401);
		const res = await s.priya.get('/api/live');
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toContain('no-store');
		expect(Object.keys(await res.json()).sort()).toEqual(['presence', 'version']);
	});

	it('changes when new device data is imported, and only then', async () => {
		const v0 = await live(s.priya);
		await sync(); // nothing new on disk
		expect(await live(s.priya)).toBe(v0);

		const code = uniq('live').slice(0, 20);
		const pid = idOf(await register({ patientId: code, deviceTypeIds: ['MARS'] }));
		drop(code, 'MARS01', 'sessions.csv', sessionsCsv(code, 'MARS', [trial(1, '2026-09-28', 1, 10, 10, 1)]));
		await sync();
		const v1 = await live(s.priya);
		expect(v1).not.toBe(v0);
		expect(await live(s.rohan)).toBe(v1); // the same marker for everyone: it carries no data

		// A laptop uploads its next session: the marker moves again, and the new session is in the page data.
		drop(code, 'MARS01', 'sessions.csv', sessionsCsv(code, 'MARS', [trial(1, '2026-09-28', 1, 10, 10, 1), trial(2, '2026-09-29', 1, 10, 9, 2)]));
		await sync();
		expect(await live(s.priya)).not.toBe(v1);
		expect((await pageData(s.priya, `/patients/${pid}?tab=progress`)).sessions).toHaveLength(2);
	});
});

describe('who can see imported data', () => {
	it('follows the normal patient scoping', async () => {
		const code = uniq('scope').slice(0, 20);
		const pid = idOf(await register({ patientId: code, deviceTypeIds: ['MARS'] }));
		drop(code, 'MARS01', 'sessions.csv', sessionsCsv(code, 'MARS', [trial(1, '2026-09-28', 1, 5, 5, 1)]));
		await sync();
		expect((await s.priya.get(`/patients/${pid}?tab=sessions`)).status).toBe(200);
		expect((await s.vikram.get(`/patients/${pid}?tab=sessions`)).status).toBe(200);
		expect((await s.rohan.get(`/patients/${pid}?tab=sessions`)).status).toBe(404);
		expect((await s.arjun.get(`/patients/${pid}`)).status).toBe(403);
		const sessionId = (await db().therapySession.findFirstOrThrow({ where: { patientId: pid } })).id;
		expect((await s.rohan.get(`/api/sessions/${sessionId}`)).status).toBe(404);
		expect((await s.priya.get(`/api/sessions/${sessionId}`)).status).toBe(200);
	});

	it('imported sessions can be annotated like any other', async () => {
		const code = uniq('note').slice(0, 20);
		const pid = idOf(await register({ patientId: code, deviceTypeIds: ['MARS'] }));
		drop(code, 'MARS01', 'sessions.csv', sessionsCsv(code, 'MARS', [trial(1, '2026-09-28', 1, 5, 5, 1)]));
		await sync();
		const sid = (await db().therapySession.findFirstOrThrow({ where: { patientId: pid } })).id;
		expect((await s.priya.json('POST', `/api/sessions/${sid}/notes`, { text: 'Good effort.' })).status).toBe(200);
	});
});

// keep the shared helper import used when the suite is run on its own
void createPatient;

// --- the real demo files: one patient, two devices with different column layouts --------------------------------------
describe('the demo MARS and PLUTO files (localserver/testdata)', () => {
	const DEMO = 'HOCMCV002'; // created by the seed
	const demoFile = (n: string) => fs.readFileSync(path.join(process.cwd(), 'localserver', 'testdata', n), 'utf8');
	let pid: string;

	it('imports both devices for the patient named in their headers', async () => {
		pid = (await db().patient.findFirstOrThrow({ where: { displayCode: DEMO } })).id;
		drop(DEMO, 'MARS01', 'sessions.csv', demoFile('mars_sessions.csv'));
		drop(DEMO, 'PLUTO01', 'sessions.csv', demoFile('pluto_sessions.csv'));
		expect((await sync()).type).toBe('success');

		const rows = await db().therapySession.findMany({ where: { patientId: pid, sourceKey: { not: null } }, include: { _count: { select: { trials: true } } } });
		const by = (dev: string) => rows.filter((r) => r.sourceDevice === dev);
		expect(by('MARS')).toHaveLength(38);
		expect(by('PLUTO')).toHaveLength(43);
		expect(by('MARS').reduce((n, r) => n + r._count.trials, 0)).toBe(1342);
		expect(by('PLUTO').reduce((n, r) => n + r._count.trials, 0)).toBe(1491);
	});

	it('keeps therapy time per device from MoveTime, and the trial kind and assist mode', async () => {
		const mins = async (dev: string) => Number((await db().therapySession.aggregate({ where: { patientId: pid, sourceDevice: dev }, _sum: { durationMinutes: true } }))._sum.durationMinutes);
		expect(await mins('MARS')).toBeCloseTo(1325.6, 0);
		expect(await mins('PLUTO')).toBeCloseTo(1471.8, 0);
		const t = await db().sessionTrial.findMany({ where: { session: { patientId: pid } }, select: { trialType: true, trialKind: true, assistMode: true } });
		expect(t.some((x) => x.trialKind)).toBe(true);
		expect(t.some((x) => x.assistMode)).toBe(true);
	});

	it('the Progress data carries each session’s device type and colour so the page can split by device', async () => {
		const d = await pageData(s.priya, `/patients/${pid}?tab=progress`);
		const types = new Set(d.sessions.map((x: { device: { typeId: string } }) => x.device.typeId));
		expect(types).toEqual(new Set(['MARS', 'PLUTO']));
		const colours = Object.fromEntries(d.sessions.map((x: { device: { typeId: string; colorSeries: string } }) => [x.device.typeId, x.device.colorSeries]));
		expect(colours.MARS).toBeTruthy();
		expect(colours.MARS).not.toBe(colours.PLUTO);
		expect((await s.priya.get(`/patients/${pid}?tab=progress`)).status).toBe(200);
	});

	it('re-scanning the same files adds nothing', async () => {
		const n = () => db().therapySession.count({ where: { patientId: pid } });
		const before = await n();
		await sync();
		expect(await n()).toBe(before);
	});
});

// --- "in session now": presence.json written by the Python server ------------------------------------------------------
describe('a patient who is training right now', () => {
	const local = (ms: number) => new Date(Date.now() - ms - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
	const setPresence = (o: Record<string, { device: string; client?: string; last_upload: string }>) => fs.writeFileSync(path.join(ROOT(), 'presence.json'), JSON.stringify(o));
	const live = async (c: Client) => (await (await c.get('/api/live')).json()) as { version: string; presence: string };
	let code: string;
	let pid: string;
	beforeAll(async () => {
		code = uniq('pres').slice(0, 20);
		pid = idOf(await register({ patientId: code, deviceTypeIds: ['MARS'] }));
	});
	const inList = async () => (await pageData(s.priya, '/patients')).patients.find((p: { displayCode: string }) => p.displayCode === code);

	it('is not marked when nobody has uploaded', async () => {
		setPresence({});
		expect((await pageData(s.priya, `/patients/${pid}`)).liveSession).toBeNull();
		expect((await inList()).liveDevice).toBeNull();
	});

	it('is marked on the patient page, the list, Data Sync and the live signal', async () => {
		setPresence({ [code]: { device: 'MARS01', last_upload: local(20_000) } });
		const d = await pageData(s.priya, `/patients/${pid}`);
		expect(d.liveSession).toMatchObject({ device: 'MARS01' });
		expect(d.liveSession.secondsAgo).toBeLessThan(60);
		expect((await inList()).liveDevice).toBe('MARS01');
		expect((await pageData(s.arjun, '/data-sync')).training).toContainEqual(expect.objectContaining({ code, device: 'MARS01' }));
		expect((await live(s.priya)).presence).toContain(`${code}@MARS01`);
	});

	it('says which laptop holds the patient when the sender reported one', async () => {
		setPresence({ [code]: { device: 'MARS', client: 'LAPTOP-A', last_upload: local(5_000) } });
		expect((await pageData(s.priya, `/patients/${pid}`)).liveSession).toMatchObject({ device: 'MARS', client: 'LAPTOP-A' });
		setPresence({});
	});

	it('the live signal changes when training starts or stops, not on every upload', async () => {
		setPresence({});
		const idle = (await live(s.priya)).presence;
		setPresence({ [code]: { device: 'MARS01', last_upload: local(10_000) } });
		const on = (await live(s.priya)).presence;
		expect(on).not.toBe(idle);
		setPresence({ [code]: { device: 'MARS01', last_upload: local(1_000) } }); // the next minute's upload
		expect((await live(s.priya)).presence).toBe(on);
		setPresence({});
		expect((await live(s.priya)).presence).toBe(idle);
	});

	it('goes quiet after the active window', async () => {
		setPresence({ [code]: { device: 'MARS01', last_upload: local(20 * 60_000) } });
		expect((await pageData(s.priya, `/patients/${pid}`)).liveSession).toBeNull();
		expect((await inList()).liveDevice).toBeNull();
		expect((await pageData(s.arjun, '/data-sync')).training.some((t: { code: string }) => t.code === code)).toBe(false);
	});

	it('survives a missing or half-written presence.json', async () => {
		fs.writeFileSync(path.join(ROOT(), 'presence.json'), '{ "oops');
		expect((await s.priya.get(`/patients/${pid}`)).status).toBe(200);
		fs.rmSync(path.join(ROOT(), 'presence.json'));
		expect((await live(s.priya)).presence).toBe('');
	});

	it('is only visible to people who can see that patient', async () => {
		setPresence({ [code]: { device: 'MARS01', last_upload: local(5_000) } });
		const other = (await pageData(s.rohan, '/patients')).patients.find((p: { displayCode: string }) => p.displayCode === code);
		expect(other).toBeUndefined();
		setPresence({});
	});
});
