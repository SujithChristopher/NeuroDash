import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPatient, createUser, db, downtownId, pageData, signInAll, uniq, type Sessions } from './helpers';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});

const ROOT = () => process.env.TEST_DATA_DIR!;
const entry = (code: string) => (JSON.parse(fs.readFileSync(path.join(ROOT(), 'patients.json'), 'utf8')).patients as Record<string, unknown>[]).find((p) => p.user_id === code);
const plan = (id: string) => s.priya.action(`/patients/${id}?/createPlan`, { trainingSide: 'Left', startDate: '2026-12-01', durationDays: '5', dailyTargetMinutes: '30', deviceTypeIds: ['MARS'] });
const robotic = (id: string, ids: string[], who = s.priya) => who.action(`/patients/${id}?/setRoboticDevices`, { deviceTypeIds: ids });
const codeOf = async (id: string) => (await db().patient.findUniqueOrThrow({ where: { id } })).displayCode;

describe('a therapy plan needs an assessment first', () => {
	it('refuses a plan for a patient who has had no assessment, and leaves them Inactive', async () => {
		const id = await createPatient(s.priya, undefined, false);
		const r = await plan(id);
		expect(r.type).toBe('failure');
		expect(r.status).toBe(409);
		expect(await db().therapyPlan.count({ where: { patientId: id } })).toBe(0);
		expect((await db().patient.findUniqueOrThrow({ where: { id } })).status).toBe('Inactive');
		expect((await pageData(s.priya, `/patients/${id}`)).hasAssessment).toBe(false);
	});

	it('allows it after a clinical assessment', async () => {
		const id = await createPatient(s.priya, undefined, false);
		await db().assessment.create({ data: { patientId: id, scaleId: 'mrs', assessmentDate: new Date('2020-01-01'), answers: {} } });
		expect((await plan(id)).type).toBe('redirect');
		expect((await db().patient.findUniqueOrThrow({ where: { id } })).status).toBe('Active');
	});

	it('allows it after devices were chosen for the robotic assessment, and keeps those devices', async () => {
		const id = await createPatient(s.priya, undefined, false);
		expect((await robotic(id, ['PLUTO'])).type).toBe('success');
		expect((await pageData(s.priya, `/patients/${id}`)).hasAssessment).toBe(true);
		expect((await plan(id)).type).toBe('redirect');
		expect((await db().assessmentDevice.findMany({ where: { patientId: id } })).map((d) => d.deviceTypeId)).toEqual(['PLUTO']);
	});
});

describe('robotic assessment devices', () => {
	it('are stored, written to patients.json as assessment_devices (apart from the plan devices) and audited', async () => {
		const id = await createPatient(s.priya, undefined, false);
		const code = await codeOf(id);
		expect((await robotic(id, ['PLUTO', 'MARS'])).type).toBe('success');
		expect((await db().assessmentDevice.findMany({ where: { patientId: id }, orderBy: { deviceTypeId: 'asc' } })).map((d) => d.deviceTypeId)).toEqual(['MARS', 'PLUTO']);
		expect(entry(code)).toMatchObject({ user_id: code, devices: [], assessment_devices: ['MARS', 'PLUTO'] }); // no plan yet: no training devices
		const audit = await db().auditLog.findFirstOrThrow({ where: { action: 'Robotic Assessment Devices Set', entityId: id }, orderBy: { occurredAt: 'desc' } });
		expect(audit.newValue).toBe('Mars, Pluto');
	});

	it('are replaced as a whole, and can be cleared', async () => {
		const id = await createPatient(s.priya, undefined, false);
		const code = await codeOf(id);
		await robotic(id, ['PLUTO', 'MARS']);
		await robotic(id, ['PLUTO']);
		expect(entry(code)).toMatchObject({ assessment_devices: ['PLUTO'] });
		await robotic(id, []);
		expect(await db().assessmentDevice.count({ where: { patientId: id } })).toBe(0);
		expect(entry(code)).toMatchObject({ assessment_devices: [] });
	});

	it('only accept real device types', async () => {
		const id = await createPatient(s.priya, undefined, false);
		const r = await robotic(id, ['MARS', 'NOPE']);
		expect(r.type).toBe('failure');
		expect(await db().assessmentDevice.count({ where: { patientId: id } })).toBe(0);
	});

	it('are the primary therapist’s to set: consultant, engineer, admin and a covering colleague get 403, another centre 404', async () => {
		const id = await createPatient(s.priya, undefined, false);
		for (const who of ['vikram', 'arjun', 'admin'] as const) expect((await robotic(id, ['MARS'], s[who])).status, who).toBe(403);
		const colleague = await createUser(s.admin, { role: 'THERAPIST', locationId: await downtownId() });
		expect((await robotic(id, ['MARS'], colleague.client)).status).toBe(403);
		expect((await robotic(id, ['MARS'], s.rohan)).status).toBe(404);
		expect(await db().assessmentDevice.count({ where: { patientId: id } })).toBe(0);
	});

	it('show on the patient page for the therapist', async () => {
		const id = await createPatient(s.priya, undefined, false);
		await robotic(id, ['MARS']);
		expect((await pageData(s.priya, `/patients/${id}`)).assessmentDevices.map((d: { deviceTypeId: string }) => d.deviceTypeId)).toEqual(['MARS']);
	});
});

async function newDevice(stock = false) {
	const r = await s.arjun.action('/devices?/register', { deviceTypeId: 'DYNABO', serialNumber: uniq('SN-'), location: 'Bay 9', ...(stock ? {} : { locationId: await downtownId() }) });
	expect(r.type).toBe('success');
	return (await db().device.findMany({ where: { deviceTypeId: 'DYNABO' }, orderBy: { updatedAt: 'desc' }, take: 1 }))[0];
}
const ask = (deviceId: string, who = s.priya, reason?: string) => who.action('/devices?/requestReturn', { deviceId, ...(reason ? { reason } : {}) });

describe('returning a device', () => {
	it('a therapist asks for a unit at their centre to be taken back; it stays there until an engineer acts', async () => {
		const d = await newDevice();
		const r = await ask(d.id, s.priya, 'Not needed any more');
		expect(r.type).toBe('success');
		const ret = await db().deviceReturn.findFirstOrThrow({ where: { deviceId: d.id } });
		expect(ret).toMatchObject({ status: 'Pending', reason: 'Not needed any more', locationId: d.locationId });
		expect((await db().device.findUniqueOrThrow({ where: { id: d.id } })).locationId).toBe(d.locationId);
		expect(await db().auditLog.findFirst({ where: { action: 'Device Return Requested', entityId: d.id } })).toBeTruthy();
		expect(await db().deviceEvent.findFirst({ where: { deviceId: d.id, eventType: 'return_requested' } })).toBeTruthy();
	});

	it('shows as pending to the centre and to the engineer, and only once at a time', async () => {
		const d = await newDevice();
		await ask(d.id);
		expect((await ask(d.id)).status).toBe(409);
		expect(await db().deviceReturn.count({ where: { deviceId: d.id } })).toBe(1);
		for (const who of ['priya', 'arjun'] as const) {
			const page = await pageData(s[who], '/devices');
			expect(page.returns.some((r: { deviceId: string }) => r.deviceId === d.id), who).toBe(true);
			expect(page.devices.find((x: { id: string }) => x.id === d.id).returnPending, who).toBe(true);
		}
		expect((await pageData(s.rohan, '/devices')).returns.some((r: { deviceId: string }) => r.deviceId === d.id)).toBe(false); // another centre
	});

	it('only a therapist of that centre can ask: others get 403, another centre and stock units 404', async () => {
		const d = await newDevice();
		for (const who of ['vikram', 'arjun', 'admin'] as const) expect((await ask(d.id, s[who])).status, who).toBe(403);
		expect((await ask(d.id, s.rohan)).status).toBe(404);
		const stock = await newDevice(true);
		expect((await ask(stock.id)).status).toBe(404);
		expect(await db().deviceReturn.count({ where: { deviceId: { in: [d.id, stock.id] } } })).toBe(0);
	});

	it('the engineer takes it back into stock: no centre, no room, the request resolved, the therapist told', async () => {
		const d = await newDevice();
		await ask(d.id);
		const r = await s.arjun.action('/devices?/takeBack', { deviceId: d.id });
		expect(r.type).toBe('success');
		const back = await db().device.findUniqueOrThrow({ where: { id: d.id } });
		expect([back.locationId, back.location]).toEqual([null, null]);
		expect(await db().deviceReturn.findFirstOrThrow({ where: { deviceId: d.id } })).toMatchObject({ status: 'Taken back' });
		expect(await db().deviceEvent.findFirst({ where: { deviceId: d.id, eventType: 'returned' } })).toBeTruthy();
		expect(await db().auditLog.findFirst({ where: { action: 'Device Taken Back', entityId: d.id } })).toBeTruthy();
		const stockList = (await pageData(s.arjun, '/devices')).available as { id: string }[];
		expect(stockList.some((x) => x.id === d.id)).toBe(true); // an engineer can hand it out again
		expect((await pageData(s.priya, '/devices')).devices.some((x: { id: string }) => x.id === d.id)).toBe(false); // gone from the centre
	});

	it('an engineer can take a unit back without a request, but not one that is already in stock', async () => {
		const d = await newDevice();
		expect((await s.arjun.action('/devices?/takeBack', { deviceId: d.id })).type).toBe('success');
		expect((await s.arjun.action('/devices?/takeBack', { deviceId: d.id })).status).toBe(409);
		expect((await s.arjun.action('/devices?/takeBack', { deviceId: 'nope' })).status).toBe(404);
	});

	it('taking back is the engineer’s alone', async () => {
		const d = await newDevice();
		for (const who of ['priya', 'vikram', 'admin', 'rohan'] as const) expect((await s[who].action('/devices?/takeBack', { deviceId: d.id })).status, who).toBe(403);
		expect((await db().device.findUniqueOrThrow({ where: { id: d.id } })).locationId).toBe(d.locationId);
	});

	it('the engineer may decline: the unit stays and the request is closed', async () => {
		const d = await newDevice();
		await ask(d.id);
		const ret = await db().deviceReturn.findFirstOrThrow({ where: { deviceId: d.id } });
		expect((await s.priya.action('/devices?/declineReturn', { id: ret.id })).status).toBe(403);
		expect((await s.arjun.action('/devices?/declineReturn', { id: ret.id })).type).toBe('success');
		expect(await db().deviceReturn.findUniqueOrThrow({ where: { id: ret.id } })).toMatchObject({ status: 'Declined' });
		expect((await db().device.findUniqueOrThrow({ where: { id: d.id } })).locationId).toBe(d.locationId);
		expect((await s.arjun.action('/devices?/declineReturn', { id: ret.id })).status).toBe(409); // already closed
		expect((await ask(d.id)).type).toBe('success'); // and the centre may ask again
	});
});
