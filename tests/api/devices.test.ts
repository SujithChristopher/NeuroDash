import { beforeAll, describe, expect, it } from 'vitest';
import { createPatient, db, signInAll, uniq, type Sessions } from './helpers';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});

/** Registers a fresh ATLAS unit as the engineer so every test has a device it fully controls. */
async function newDevice(type = 'ATLAS') {
	const r = await s.arjun.action('/devices?/register', { deviceTypeId: type, serialNumber: uniq('SN-'), firmwareVersion: '1.0.0', location: 'Test Bay' });
	expect(r.type).toBe('success');
	// `updatedAt` is stamped on create, so the newest row of that type is the one just registered.
	return (await db().device.findMany({ where: { deviceTypeId: type }, orderBy: { updatedAt: 'desc' }, take: 1 }))[0];
}

describe('registering devices', () => {
	it('generates a unique {TYPE}-### code, starts Available, and logs an event and an audit entry', async () => {
		const d = await newDevice();
		expect(d.displayCode).toMatch(/^ATLAS-\d{3}$/);
		expect(d.status).toBe('Available');
		expect(d.firmwareVersion).toBe('1.0.0');
		const ev = await db().deviceEvent.findFirstOrThrow({ where: { deviceId: d.id } });
		expect(ev.eventType).toBe('registered');
		expect(await db().auditLog.findFirst({ where: { action: 'Device Registered', entityId: d.id } })).toBeTruthy();
	});

	it('validates the type and serial number', async () => {
		expect((await s.arjun.action('/devices?/register', { deviceTypeId: 'NOPE', serialNumber: 'X' })).type).toBe('failure');
		expect((await s.arjun.action('/devices?/register', { deviceTypeId: 'ATLAS', serialNumber: '   ' })).type).toBe('failure');
		expect((await s.arjun.action('/devices?/register', { deviceTypeId: '', serialNumber: 'X' })).type).toBe('failure');
	});

	it('is engineer-only', async () => {
		for (const who of ['priya', 'vikram', 'admin'] as const) {
			expect((await s[who].action('/devices?/register', { deviceTypeId: 'ATLAS', serialNumber: 'X' })).status, who).toBe(403);
		}
	});
});

describe('device request workflow: request → clear → assign', () => {
	let patientId: string;
	let patientName: string;
	beforeAll(async () => {
		patientName = uniq('ReqPat');
		patientId = await createPatient(s.priya, patientName);
	});

	const request = (client = s.priya, pid = patientId, deviceTypeId = 'ATLAS') =>
		client.action('/device-requests?/request', { patientId: pid, deviceTypeId, notes: 'Needs shoulder work' });
	const latest = () => db().deviceRequest.findFirstOrThrow({ where: { patientId }, orderBy: { requestedAt: 'desc' } });

	it('a therapist requests a device type → Pending Engineer Review, engineers notified', async () => {
		const r = await request();
		expect(r.type).toBe('success');
		const req = await latest();
		expect(req.status).toBe('Pending Engineer Review');
		expect(req.notes).toBe('Needs shoulder work');
		const note = await db().notification.findFirstOrThrow({ where: { targetRole: 'ENGINEER', notifType: 'request', description: { contains: patientName } } });
		expect(note.title).toBe('New device request');
		expect((note.link as { page: string }).page).toBe('device-requests');
	});

	it('validates the request and scopes it to the therapist’s patients', async () => {
		expect((await request(s.priya, '', 'ATLAS')).type).toBe('failure');
		expect((await request(s.priya, patientId, 'NOPE')).type).toBe('failure');
		expect((await request(s.rohan)).status).toBe(404); // other location's patient
		expect((await request(s.vikram)).status).toBe(403);
		expect((await request(s.admin)).status).toBe(403);
		expect((await request(s.arjun)).status).toBe(403);
	});

	it('only engineers clear, decline or assign — never the requesting therapist', async () => {
		const req = await latest();
		const dev = await newDevice();
		for (const who of ['priya', 'rohan', 'vikram', 'admin'] as const) {
			expect((await s[who].action('/device-requests?/clear', { id: req.id })).status, `${who} clear`).toBe(403);
			expect((await s[who].action('/device-requests?/decline', { id: req.id })).status, `${who} decline`).toBe(403);
			expect((await s[who].action('/device-requests?/assign', { id: req.id, deviceId: dev.id })).status, `${who} assign`).toBe(403);
		}
		expect((await db().deviceRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('Pending Engineer Review');
	});

	it('a request cannot be assigned before it is cleared', async () => {
		const req = await latest();
		const dev = await newDevice();
		const r = await s.arjun.action('/device-requests?/assign', { id: req.id, deviceId: dev.id });
		expect(r.status).toBe(409);
		expect((await db().device.findUniqueOrThrow({ where: { id: dev.id } })).status).toBe('Available');
		expect(await db().deviceAssignment.count({ where: { deviceId: dev.id } })).toBe(0);
	});

	it('clearing notifies the requesting therapist and can only happen once', async () => {
		const req = await latest();
		expect((await s.arjun.action('/device-requests?/clear', { id: req.id })).type).toBe('success');
		const after = await db().deviceRequest.findUniqueOrThrow({ where: { id: req.id }, include: { engineer: true } });
		expect(after.status).toBe('Cleared — Ready to Assign');
		expect(after.engineer?.email).toBe('arjun.rao@neurodash.care');
		expect(after.clearedAt).toBeTruthy();
		const note = await db().notification.findFirstOrThrow({
			where: { targetUser: { email: 'priya.nair@neurodash.care' }, title: 'Device cleared for use', description: { contains: patientName } }
		});
		expect(note.tone).toBe('good');
		expect((await s.arjun.action('/device-requests?/clear', { id: req.id })).status).toBe(409);
	});

	it('assigning needs an available unit of the requested type', async () => {
		const req = await latest();
		const wrongType = await db().device.findFirstOrThrow({ where: { displayCode: 'PLUTO-002' } });
		expect((await s.arjun.action('/device-requests?/assign', { id: req.id, deviceId: wrongType.id })).type).toBe('failure');
		expect((await s.arjun.action('/device-requests?/assign', { id: req.id, deviceId: 'nope' })).type).toBe('failure');
		expect((await s.arjun.action('/device-requests?/assign', { id: req.id, deviceId: '' })).type).toBe('failure');
		expect((await db().deviceRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('Cleared — Ready to Assign');
	});

	it('assigning creates the assignment, marks the device In Use, logs it, and tells the therapist', async () => {
		const req = await latest();
		const dev = await newDevice();
		const r = await s.arjun.action('/device-requests?/assign', { id: req.id, deviceId: dev.id });
		expect(r.type).toBe('success');

		const d = await db().device.findUniqueOrThrow({ where: { id: dev.id } });
		expect([d.status, d.currentPatientId]).toEqual(['In Use', patientId]);
		const a = await db().deviceAssignment.findFirstOrThrow({ where: { deviceId: dev.id }, include: { assignedBy: true } });
		expect([a.patientId, a.status, a.returnedDate, a.assignedBy?.email]).toEqual([patientId, 'In Use', null, 'arjun.rao@neurodash.care']);
		expect((await db().deviceRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('Assigned');
		expect(await db().deviceEvent.findFirst({ where: { deviceId: dev.id, eventType: 'assigned' } })).toBeTruthy();
		const note = await db().notification.findFirstOrThrow({ where: { targetUser: { email: 'priya.nair@neurodash.care' }, title: 'Device assigned', description: { contains: dev.displayCode } } });
		expect((note.link as { page: string }).page).toBe(`patients/${patientId}?tab=devices`);

		// An assigned unit cannot be handed out twice.
		await request();
		const req2 = await latest();
		await s.arjun.action('/device-requests?/clear', { id: req2.id });
		expect((await s.arjun.action('/device-requests?/assign', { id: req2.id, deviceId: dev.id })).status).toBe(409);
	});

	it('declining closes the request, notifies the therapist, and blocks later assignment', async () => {
		await request();
		const req = await latest();
		expect((await s.arjun.action('/device-requests?/decline', { id: req.id })).type).toBe('success');
		expect((await db().deviceRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('Declined');
		expect(await db().notification.findFirst({ where: { title: 'Device request declined', description: { contains: patientName } } })).toBeTruthy();
		const dev = await newDevice();
		expect((await s.arjun.action('/device-requests?/assign', { id: req.id, deviceId: dev.id })).status).toBe(409);
		expect((await s.arjun.action('/device-requests?/decline', { id: req.id })).status).toBe(409);
	});

	it('the requests page shows a therapist only their own requests, and an engineer everything', async () => {
		const mine = await (await s.priya.get('/device-requests')).text();
		expect(mine).toContain(patientName);
		const others = await (await s.rohan.get('/device-requests')).text();
		expect(others).not.toContain(patientName);
		const eng = await (await s.arjun.get('/device-requests')).text();
		// Engineers get the patient's code, never the name.
		expect(eng).not.toContain(patientName);
		expect(eng).toContain((await db().patient.findUniqueOrThrow({ where: { id: patientId } })).displayCode);
	});
});

describe('direct assignment and return', () => {
	it('an engineer assigns an Available device, then returns it to inventory', async () => {
		const dev = await newDevice();
		const p = await createPatient(s.priya);
		expect((await s.arjun.action(`/devices/${dev.id}?/assign`, { patientId: p })).type).toBe('success');
		expect((await db().device.findUniqueOrThrow({ where: { id: dev.id } })).status).toBe('In Use');
		// Not available any more.
		expect((await s.arjun.action(`/devices/${dev.id}?/assign`, { patientId: p })).status).toBe(409);

		expect((await s.arjun.action(`/devices/${dev.id}?/returnDevice`)).type).toBe('success');
		const back = await db().device.findUniqueOrThrow({ where: { id: dev.id } });
		expect([back.status, back.currentPatientId]).toEqual(['Available', null]);
		const a = await db().deviceAssignment.findFirstOrThrow({ where: { deviceId: dev.id } });
		expect([a.status, a.returnedDate !== null]).toEqual(['Returned', true]);
		expect((await s.arjun.action(`/devices/${dev.id}?/returnDevice`)).status).toBe(409);
	});

	it('rejects an unknown patient and non-engineers', async () => {
		const dev = await newDevice();
		const p = await createPatient(s.priya);
		expect((await s.arjun.action(`/devices/${dev.id}?/assign`, { patientId: 'nope' })).type).toBe('failure');
		for (const who of ['priya', 'vikram', 'admin'] as const) {
			expect((await s[who].action(`/devices/${dev.id}?/assign`, { patientId: p })).status, who).toBe(403);
			expect((await s[who].action(`/devices/${dev.id}?/returnDevice`)).status, who).toBe(403);
		}
		expect((await s.arjun.action('/devices/00000000-0000-0000-0000-000000000000?/assign', { patientId: p })).status).toBe(404);
	});

	it('hides the patient’s name from the engineer on the device page', async () => {
		const dev = await newDevice();
		const name = uniq('Hidden');
		const pid = await createPatient(s.priya, name);
		await s.arjun.action(`/devices/${dev.id}?/assign`, { patientId: pid });
		expect(await (await s.arjun.get(`/devices/${dev.id}`)).text()).not.toContain(name);
		expect(await (await s.priya.get(`/devices/${dev.id}`)).text()).toContain(name);
		expect(await (await s.arjun.get('/devices')).text()).not.toContain(name);
	});
});

describe('device issue workflow: report → investigate → resolve → clear', () => {
	const report = (client: typeof s.priya, deviceId: string, over: Record<string, string> = {}) =>
		client.action('/device-issues?/report', { deviceId, severity: 'Medium', issueType: 'Calibration drift', description: 'Reads high', ...over });
	const latestIssue = (deviceId: string) => db().deviceIssue.findFirstOrThrow({ where: { deviceId }, orderBy: { openedAt: 'desc' }, include: { troubleshootingLog: true } });

	it('a therapist or engineer can report; the device is flagged and engineers are notified', async () => {
		const dev = await newDevice();
		const r = await report(s.priya, dev.id, { severity: 'High' });
		expect(r.type).toBe('success');
		const issue = await latestIssue(dev.id);
		expect([issue.status, issue.severity, issue.description]).toEqual(['Open', 'High', 'Calibration drift — Reads high']);
		expect((await db().device.findUniqueOrThrow({ where: { id: dev.id } })).status).toBe('Issue Detected');
		expect(await db().deviceEvent.findFirst({ where: { deviceId: dev.id, eventType: 'issue' } })).toBeTruthy();
		const note = await db().notification.findFirstOrThrow({ where: { targetRole: 'ENGINEER', notifType: 'issue', description: { contains: dev.displayCode } } });
		expect(note.tone).toBe('critical'); // High/Critical are critical, lower are warnings

		const dev2 = await newDevice();
		await report(s.arjun, dev2.id, { severity: 'Low' });
		const low = await db().notification.findFirstOrThrow({ where: { targetRole: 'ENGINEER', description: { contains: dev2.displayCode } } });
		expect(low.tone).toBe('warning');
	});

	it('validates the report and restricts who may file one', async () => {
		const dev = await newDevice();
		expect((await report(s.priya, dev.id, { severity: 'Apocalyptic' })).type).toBe('failure');
		expect((await report(s.priya, dev.id, { issueType: '', description: '' })).type).toBe('failure');
		expect((await report(s.priya, '', {})).type).toBe('failure');
		expect((await report(s.priya, '00000000-0000-0000-0000-000000000000')).status).toBe(404);
		expect((await report(s.vikram, dev.id)).status).toBe(403);
		expect((await report(s.admin, dev.id)).status).toBe(403);
		expect(await db().deviceIssue.count({ where: { deviceId: dev.id } })).toBe(0);
	});

	it('walks the full lifecycle with the right device status at each step', async () => {
		const dev = await newDevice();
		await report(s.priya, dev.id);
		const issue = await latestIssue(dev.id);
		const status = async () => (await db().device.findUniqueOrThrow({ where: { id: dev.id } })).status;

		// Can't jump ahead.
		expect((await s.arjun.action('/device-issues?/resolve', { id: issue.id, resolution: 'Fixed' })).status).toBe(409);
		expect((await s.arjun.action('/device-issues?/clear', { id: issue.id })).status).toBe(409);

		// Investigate
		expect((await s.arjun.action('/device-issues?/investigate', { id: issue.id })).type).toBe('success');
		let cur = await latestIssue(dev.id);
		expect(cur.status).toBe('Investigating');
		expect(cur.engineerId).toBeTruthy();
		expect(cur.troubleshootingLog.map((l) => l.note)).toEqual(['Investigation started.']);
		expect(await status()).toBe('Awaiting Engineer');
		expect((await s.arjun.action('/device-issues?/investigate', { id: issue.id })).status).toBe(409);

		// Troubleshooting notes
		expect((await s.arjun.action('/device-issues?/log', { id: issue.id, note: 'Swapped sensor cable' })).type).toBe('success');
		expect((await s.arjun.action('/device-issues?/log', { id: issue.id, note: '   ' })).type).toBe('failure');

		// Resolve needs a description; parts are optional
		expect((await s.arjun.action('/device-issues?/resolve', { id: issue.id, resolution: '  ' })).type).toBe('failure');
		expect((await s.arjun.action('/device-issues?/resolve', { id: issue.id, resolution: 'Recalibrated', partsReplaced: 'Sensor cable' })).type).toBe('success');
		cur = await latestIssue(dev.id);
		expect([cur.status, cur.resolution, cur.partsReplaced]).toEqual(['Resolved', 'Recalibrated', 'Sensor cable']);
		expect(cur.resolvedAt).toBeTruthy();
		expect(await status()).toBe('Awaiting Engineer'); // still out of service until verified

		// Closed issues take no more notes
		expect((await s.arjun.action('/device-issues?/log', { id: issue.id, note: 'late note' })).status).toBe(409);

		// Clear → back in service, opener notified
		expect((await s.arjun.action('/device-issues?/clear', { id: issue.id })).type).toBe('success');
		cur = await latestIssue(dev.id);
		expect(cur.status).toBe('Cleared');
		expect(cur.clearedAt).toBeTruthy();
		expect(cur.verifiedById).toBeTruthy();
		expect(await status()).toBe('Available');
		const note = await db().notification.findFirstOrThrow({ where: { targetUser: { email: 'priya.nair@neurodash.care' }, title: 'Device issue cleared', description: { contains: dev.displayCode } } });
		expect(note.tone).toBe('good');
		expect((await s.arjun.action('/device-issues?/clear', { id: issue.id })).status).toBe(409);

		const events = (await db().deviceEvent.findMany({ where: { deviceId: dev.id }, orderBy: { eventDate: 'asc' } })).map((e) => e.eventType);
		expect(events).toEqual(['registered', 'issue', 'investigating', 'resolved', 'cleared']);
		const audits = (await db().auditLog.findMany({ where: { entityId: issue.id }, orderBy: { occurredAt: 'asc' } })).map((a) => a.action);
		expect(audits).toEqual(['Issue Reported', 'Issue Investigation Started', 'Issue Resolved', 'Device Cleared']);
	});

	it('a device that was in use goes back to In Use, not Available, once cleared', async () => {
		const dev = await newDevice();
		const pid = await createPatient(s.priya);
		await s.arjun.action(`/devices/${dev.id}?/assign`, { patientId: pid });
		await report(s.priya, dev.id);
		const issue = await latestIssue(dev.id);
		await s.arjun.action('/device-issues?/investigate', { id: issue.id });
		await s.arjun.action('/device-issues?/resolve', { id: issue.id, resolution: 'Fixed' });
		await s.arjun.action('/device-issues?/clear', { id: issue.id });
		const d = await db().device.findUniqueOrThrow({ where: { id: dev.id } });
		expect([d.status, d.currentPatientId]).toEqual(['In Use', pid]);
	});

	it('only engineers work the issue — the consultant, therapists and admin cannot clear or resolve', async () => {
		const dev = await newDevice();
		await report(s.priya, dev.id);
		const issue = await latestIssue(dev.id);
		for (const who of ['priya', 'rohan', 'vikram', 'admin'] as const) {
			for (const act of ['investigate', 'log', 'resolve', 'clear']) {
				const r = await s[who].action(`/device-issues?/${act}`, { id: issue.id, note: 'x', resolution: 'x' });
				expect(r.status, `${who} ${act}`).toBe(403);
			}
		}
		// And a consultant can't close a resolved issue either.
		await s.arjun.action('/device-issues?/investigate', { id: issue.id });
		await s.arjun.action('/device-issues?/resolve', { id: issue.id, resolution: 'Fixed' });
		expect((await s.vikram.action('/device-issues?/clear', { id: issue.id })).status).toBe(403);
		expect((await latestIssue(dev.id)).status).toBe('Resolved');
	});

	it('returns 404 for an unknown issue', async () => {
		expect((await s.arjun.action('/device-issues?/investigate', { id: '00000000-0000-0000-0000-000000000000' })).status).toBe(404);
	});
});

describe('maintenance', () => {
	it('an engineer logs maintenance against a device; it is evented, audited and listed', async () => {
		const dev = await newDevice();
		const r = await s.arjun.action(`/devices/${dev.id}?/logMaintenance`, { maintenanceType: 'Scheduled Calibration', maintenanceDate: '2026-09-01', notes: 'All within tolerance' });
		expect(r.type).toBe('success');
		const m = await db().deviceMaintenance.findFirstOrThrow({ where: { deviceId: dev.id } });
		expect([m.maintenanceType, m.notes, m.maintenanceDate.toISOString().slice(0, 10)]).toEqual(['Scheduled Calibration', 'All within tolerance', '2026-09-01']);
		expect(await db().deviceEvent.findFirst({ where: { deviceId: dev.id, eventType: 'maintenance' } })).toBeTruthy();
		expect(await db().auditLog.findFirst({ where: { action: 'Maintenance Logged', entityId: m.id } })).toBeTruthy();
		expect(await (await s.arjun.get('/maintenance')).text()).toContain(dev.displayCode);
	});

	it('validates input and is engineer-only', async () => {
		const dev = await newDevice();
		expect((await s.arjun.action(`/devices/${dev.id}?/logMaintenance`, { maintenanceType: '', maintenanceDate: '2026-09-01' })).type).toBe('failure');
		expect((await s.arjun.action(`/devices/${dev.id}?/logMaintenance`, { maintenanceType: 'Firmware Update', maintenanceDate: 'soon' })).type).toBe('failure');
		for (const who of ['priya', 'vikram', 'admin'] as const) {
			expect((await s[who].action(`/devices/${dev.id}?/logMaintenance`, { maintenanceType: 'Firmware Update', maintenanceDate: '2026-09-01' })).status, who).toBe(403);
		}
		expect(await db().deviceMaintenance.count({ where: { deviceId: dev.id } })).toBe(0);
	});
});

describe('device pages', () => {
	it('list, detail (every tab), usage and history render for permitted roles', async () => {
		const dev = await db().device.findFirstOrThrow({ where: { displayCode: 'PLUTO-001' } });
		for (const tab of ['overview', 'usage', 'assignments', 'issues', 'maintenance', 'history']) {
			for (const who of ['priya', 'vikram', 'arjun', 'admin'] as const) {
				expect((await s[who].get(`/devices/${dev.id}?tab=${tab}`)).status, `${who} ${tab}`).toBe(200);
			}
		}
		expect((await s.arjun.get('/devices/00000000-0000-0000-0000-000000000000')).status).toBe(404);
	});

	it('usage aggregates sessions per device from the database', async () => {
		const html = await (await s.arjun.get('/device-usage')).text();
		expect(html).toContain('PLUTO-001');
		expect(html).toContain('MARS-001');
	});
});
