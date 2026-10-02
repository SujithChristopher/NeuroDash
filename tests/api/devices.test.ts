import { beforeAll, describe, expect, it } from 'vitest';
import { createPatient, db, downtownId, northId, pageData, signInAll, uniq, type Sessions } from './helpers';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});

/**
 * Registers a fresh DYNABO unit as the engineer so every test has a device it fully controls. By default it is set up at
 * Downtown Clinic (Priya's centre); pass `stock` for a unit that is not set up anywhere yet.
 */
async function newDevice(type = 'DYNABO', stock = false) {
	const r = await s.arjun.action('/devices?/register', {
		deviceTypeId: type,
		serialNumber: uniq('SN-'),
		firmwareVersion: '1.0.0',
		location: 'Test Bay',
		...(stock ? {} : { locationId: await downtownId() })
	});
	expect(r.type).toBe('success');
	// `updatedAt` is stamped on create, so the newest row of that type is the one just registered.
	return (await db().device.findMany({ where: { deviceTypeId: type }, orderBy: { updatedAt: 'desc' }, take: 1 }))[0];
}

describe('registering devices', () => {
	it('generates a unique {TYPE}-### code, starts Available, and logs an event and an audit entry', async () => {
		const d = await newDevice();
		expect(d.displayCode).toMatch(/^DYNABO-\d{3}$/);
		expect(d.status).toBe('Available');
		expect(d.firmwareVersion).toBe('1.0.0');
		const ev = await db().deviceEvent.findFirstOrThrow({ where: { deviceId: d.id } });
		expect(ev.eventType).toBe('registered');
		expect(await db().auditLog.findFirst({ where: { action: 'Device Registered', entityId: d.id } })).toBeTruthy();
	});

	it('validates the type and serial number', async () => {
		expect((await s.arjun.action('/devices?/register', { deviceTypeId: 'NOPE', serialNumber: 'X' })).type).toBe('failure');
		expect((await s.arjun.action('/devices?/register', { deviceTypeId: 'DYNABO', serialNumber: '   ' })).type).toBe('failure');
		expect((await s.arjun.action('/devices?/register', { deviceTypeId: '', serialNumber: 'X' })).type).toBe('failure');
	});

	it('is engineer-only', async () => {
		for (const who of ['priya', 'vikram', 'admin'] as const) {
			expect((await s[who].action('/devices?/register', { deviceTypeId: 'DYNABO', serialNumber: 'X' })).status, who).toBe(403);
		}
	});
});

describe('a centre requests a device: request → clear → set up', () => {
	let notes: string;
	beforeAll(() => {
		notes = uniq('Needs-');
	});

	const request = (client = s.priya, deviceTypeId = 'DYNABO') => client.action('/device-requests?/request', { deviceTypeId, notes });
	const latest = async () => db().deviceRequest.findFirstOrThrow({ where: { notes }, orderBy: { requestedAt: 'desc' }, include: { location: true } });

	it('a therapist requests a device type for their centre → Pending Engineer Review, engineers notified', async () => {
		const r = await request();
		expect(r.type).toBe('success');
		const req = await latest();
		expect(req.status).toBe('Pending Engineer Review');
		expect(req.location.name).toBe('Downtown Clinic'); // for the centre, not a patient
		const note = await db().notification.findFirstOrThrow({ where: { targetRole: 'ENGINEER', notifType: 'request', description: { contains: 'Downtown Clinic' } } });
		expect(note.title).toBe('New device request');
		expect((note.link as { page: string }).page).toBe('device-requests');
	});

	it('no longer takes a patient, and validates the device type and who may ask', async () => {
		expect((await request(s.priya, 'NOPE')).type).toBe('failure');
		expect((await request(s.priya, '')).type).toBe('failure');
		expect((await request(s.vikram)).status).toBe(403);
		expect((await request(s.admin)).status).toBe(403);
		expect((await request(s.arjun)).status).toBe(403);
	});

	it('only engineers clear, decline or set up — never the requesting therapist', async () => {
		const req = await latest();
		const dev = await newDevice('DYNABO', true);
		for (const who of ['priya', 'rohan', 'vikram', 'admin'] as const) {
			expect((await s[who].action('/device-requests?/clear', { id: req.id })).status, `${who} clear`).toBe(403);
			expect((await s[who].action('/device-requests?/decline', { id: req.id })).status, `${who} decline`).toBe(403);
			expect((await s[who].action('/device-requests?/assign', { id: req.id, deviceId: dev.id })).status, `${who} assign`).toBe(403);
		}
		expect((await db().deviceRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('Pending Engineer Review');
	});

	it('a request cannot be set up before it is cleared', async () => {
		const req = await latest();
		const dev = await newDevice('DYNABO', true);
		expect((await s.arjun.action('/device-requests?/assign', { id: req.id, deviceId: dev.id })).status).toBe(409);
		expect((await db().device.findUniqueOrThrow({ where: { id: dev.id } })).locationId).toBeNull();
	});

	it('clearing notifies the requesting therapist and can only happen once', async () => {
		const req = await latest();
		expect((await s.arjun.action('/device-requests?/clear', { id: req.id })).type).toBe('success');
		const after = await db().deviceRequest.findUniqueOrThrow({ where: { id: req.id }, include: { engineer: true } });
		expect(after.status).toBe('Cleared — Ready to Assign');
		expect(after.engineer?.email).toBe('arjun.rao@neurodash.care');
		expect(after.clearedAt).toBeTruthy();
		const note = await db().notification.findFirstOrThrow({ where: { targetUser: { email: 'priya.nair@neurodash.care' }, title: 'Device cleared for use', description: { contains: 'Downtown Clinic' } } });
		expect(note.tone).toBe('good');
		expect((await s.arjun.action('/device-requests?/clear', { id: req.id })).status).toBe(409);
	});

	it('setting up needs an unplaced unit of the requested type', async () => {
		const req = await latest();
		const wrongType = await newDevice('PLUTO', true);
		expect((await s.arjun.action('/device-requests?/assign', { id: req.id, deviceId: wrongType.id })).type).toBe('failure');
		expect((await s.arjun.action('/device-requests?/assign', { id: req.id, deviceId: 'nope' })).type).toBe('failure');
		expect((await s.arjun.action('/device-requests?/assign', { id: req.id, deviceId: '' })).type).toBe('failure');
		const placed = await newDevice('DYNABO'); // already set up at a centre
		expect((await s.arjun.action('/device-requests?/assign', { id: req.id, deviceId: placed.id })).status).toBe(409);
		expect((await db().deviceRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('Cleared — Ready to Assign');
	});

	it('setting up places the unit at the centre, logs it, and tells the therapist', async () => {
		const req = await latest();
		const dev = await newDevice('DYNABO', true);
		const r = await s.arjun.action('/device-requests?/assign', { id: req.id, deviceId: dev.id });
		expect(r.type).toBe('success');

		const d = await db().device.findUniqueOrThrow({ where: { id: dev.id } });
		expect(d.locationId).toBe(req.locationId);
		expect((await db().deviceRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('Assigned');
		expect(await db().deviceEvent.findFirst({ where: { deviceId: dev.id, eventType: 'assigned' } })).toBeTruthy();
		const note = await db().notification.findFirstOrThrow({ where: { targetUser: { email: 'priya.nair@neurodash.care' }, title: 'Device set up', description: { contains: dev.displayCode } } });
		expect((note.link as { page: string }).page).toBe('devices');
		expect(await db().auditLog.findFirst({ where: { action: 'Device Set Up', entityId: dev.id } })).toBeTruthy();

		// A unit that is already set up cannot be handed out twice.
		await request();
		const req2 = await latest();
		await s.arjun.action('/device-requests?/clear', { id: req2.id });
		expect((await s.arjun.action('/device-requests?/assign', { id: req2.id, deviceId: dev.id })).status).toBe(409);
	});

	it('declining closes the request, notifies the therapist, and blocks later set-up', async () => {
		await request();
		const req = await latest();
		expect((await s.arjun.action('/device-requests?/decline', { id: req.id })).type).toBe('success');
		expect((await db().deviceRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('Declined');
		expect(await db().notification.findFirst({ where: { title: 'Device request declined', description: { contains: 'Downtown Clinic' } } })).toBeTruthy();
		const dev = await newDevice('DYNABO', true);
		expect((await s.arjun.action('/device-requests?/assign', { id: req.id, deviceId: dev.id })).status).toBe(409);
		expect((await s.arjun.action('/device-requests?/decline', { id: req.id })).status).toBe(409);
	});

	it('a centre sees its own requests; engineers see every centre’s', async () => {
		expect(await (await s.priya.get('/device-requests')).text()).toContain(notes);
		expect(await (await s.rohan.get('/device-requests')).text()).not.toContain(notes); // North Campus
		const eng = await (await s.arjun.get('/device-requests')).text();
		expect(eng).toContain(notes);
		expect(eng).toContain('Downtown Clinic');
	});

	it('another centre (North Campus) requests for itself', async () => {
		const n = uniq('North-');
		expect((await s.rohan.action('/device-requests?/request', { deviceTypeId: 'DYNABO', notes: n })).type).toBe('success');
		expect((await db().deviceRequest.findFirstOrThrow({ where: { notes: n }, include: { location: true } })).location.name).toBe('North Campus');
	});
});

describe('devices belong to a centre', () => {
	it('an engineer sets a unit up at a centre, moves it, and returns it to stock — each logged', async () => {
		const dev = await newDevice('DYNABO', true);
		const north = await northId();
		expect((await s.arjun.action(`/devices/${dev.id}?/setCentre`, { locationId: north })).type).toBe('success');
		expect((await db().device.findUniqueOrThrow({ where: { id: dev.id } })).locationId).toBe(north);
		expect((await s.arjun.action(`/devices/${dev.id}?/setCentre`, { locationId: north })).type).toBe('failure'); // nothing changed
		expect((await s.arjun.action(`/devices/${dev.id}?/setCentre`, { locationId: await downtownId() })).type).toBe('success');
		expect((await s.arjun.action(`/devices/${dev.id}?/setCentre`, { locationId: '' })).type).toBe('success');
		expect((await db().device.findUniqueOrThrow({ where: { id: dev.id } })).locationId).toBeNull();
		expect(await db().deviceEvent.count({ where: { deviceId: dev.id, eventType: 'assigned' } })).toBe(3);
		expect((await s.arjun.action(`/devices/${dev.id}?/setCentre`, { locationId: 'nope' })).type).toBe('failure');
	});

	it('only engineers set centres', async () => {
		const dev = await newDevice();
		for (const who of ['priya', 'vikram', 'admin'] as const) {
			expect((await s[who].action(`/devices/${dev.id}?/setCentre`, { locationId: await northId() })).status, who).toBe(403);
		}
		expect((await s.arjun.action('/devices/00000000-0000-0000-0000-000000000000?/setCentre', { locationId: '' })).status).toBe(404);
	});

	it('therapists and consultants see only their own centre’s devices; engineers and admin see all', async () => {
		const dev = await newDevice(); // Downtown
		const stock = await newDevice('DYNABO', true);
		for (const who of ['priya', 'vikram'] as const) {
			expect((await s[who].get(`/devices/${dev.id}`)).status, who).toBe(200);
			expect((await s[who].get(`/devices/${stock.id}`)).status, who).toBe(404);
		}
		expect((await s.rohan.get(`/devices/${dev.id}`)).status).toBe(404); // another centre: 404, not 403
		expect(await (await s.rohan.get('/devices')).text()).not.toContain(dev.displayCode);
		expect(await (await s.priya.get('/devices')).text()).toContain(dev.displayCode);
		for (const who of ['arjun', 'admin'] as const) {
			expect((await s[who].get(`/devices/${stock.id}`)).status, who).toBe(200);
			expect(await (await s[who].get('/devices')).text()).toContain(dev.displayCode);
		}
	});

	it('a centre can raise issues only for its own devices', async () => {
		const dev = await newDevice();
		const fields = { deviceId: dev.id, severity: 'Low', issueType: 'Cable', description: 'Loose' };
		expect((await s.rohan.action('/device-issues?/report', fields)).status).toBe(404);
		expect((await s.priya.action('/device-issues?/report', fields)).type).toBe('success');
		expect((await db().device.findUniqueOrThrow({ where: { id: dev.id } })).status).toBe('Issue Detected');
	});

	it('there is no per-patient assignment or request any more', async () => {
		const dev = await newDevice();
		expect((await s.arjun.action(`/devices/${dev.id}?/assign`, { patientId: 'x' })).status).toBe(404);
		expect((await s.priya.action('/patients/x?/requestDevice', { deviceTypeId: 'DYNABO' })).status).toBe(404);
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

	it('a device goes back to Available once its issue is cleared', async () => {
		const dev = await newDevice();
		await report(s.priya, dev.id);
		const issue = await latestIssue(dev.id);
		await s.arjun.action('/device-issues?/investigate', { id: issue.id });
		await s.arjun.action('/device-issues?/resolve', { id: issue.id, resolution: 'Fixed' });
		await s.arjun.action('/device-issues?/clear', { id: issue.id });
		expect((await db().device.findUniqueOrThrow({ where: { id: dev.id } })).status).toBe('Available');
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

describe('what an engineer sees about a device', () => {
	it('is about usage (hours, patients, frequency, last used), not patient scores', async () => {
		const dev = await newDevice();
		const day = (n: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - n));
		let sn = 0;
		for (const [patient, daysAgo, minutes] of [[await createPatient(s.priya), 1, 30], [await createPatient(s.priya), 3, 45], [undefined, 3, 15]] as const) {
			const pid = patient ?? (await db().therapySession.findFirstOrThrow({ where: { deviceId: dev.id } })).patientId;
			await db().therapySession.create({
				data: { patientId: pid, deviceId: dev.id, sessionDate: day(daysAgo), startTime: day(daysAgo), durationMinutes: minutes, sessionNumber: ++sn, totalTargets: 10, totalHits: 7, totalMisses: 3, totalStars: 2 }
			});
		}
		const d = await pageData(s.arjun, `/devices/${dev.id}`);
		expect(d.stats).toMatchObject({ sessions: 3, totalMin: 90, patients: 2, activeDays30: 2 });
		expect(d.stats.sessionsPerWeek).toBeGreaterThan(0);
		expect(d.stats.lastDay.slice(0, 10)).toBe(day(1).toISOString().slice(0, 10));
		for (const gone of ['avgAccuracy', 'totalStars', 'totalTrials']) expect(d.stats, gone).not.toHaveProperty(gone);
		expect(d.recentSessions[0]).not.toHaveProperty('totalStars');

		const rows = (await pageData(s.arjun, '/device-usage')).rows as { id: string; patients: number; totalMin: number }[];
		expect(rows.find((r) => r.id === dev.id)).toMatchObject({ patients: 2, totalMin: 90 });
	});
});
