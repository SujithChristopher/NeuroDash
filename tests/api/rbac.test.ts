import { beforeAll, describe, expect, it } from 'vitest';
import { db, signInAll, type Sessions } from './helpers';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});

type Who = 'priya' | 'rohan' | 'vikram' | 'arjun' | 'admin';

// Expected HTTP status of a GET by each role (302 = redirect, e.g. Engineer/Admin away from "/").
// Order: priya (therapist), rohan (therapist, other location), vikram (consultant), arjun (engineer), admin.
const PAGES: [string, number, number, number, number, number][] = [
	['/', 200, 200, 200, 302, 302],
	['/analytics', 200, 200, 200, 200, 200],
	['/patients', 200, 200, 200, 403, 200],
	['/patients/new', 200, 200, 403, 403, 403],
	['/assessments', 200, 200, 200, 403, 200],
	['/plans', 200, 200, 200, 403, 200],
	['/sessions', 200, 200, 200, 403, 200],
	['/devices', 200, 200, 200, 200, 200],
	['/device-requests', 200, 200, 403, 200, 403],
	['/device-issues', 403, 403, 403, 200, 200],
	['/maintenance', 200, 200, 200, 200, 200],
	['/device-usage', 200, 200, 200, 200, 200],
	['/device-history', 200, 200, 200, 200, 200],
	['/users', 403, 403, 403, 403, 200],
	['/locations', 403, 403, 403, 403, 200],
	['/audit-log', 403, 403, 403, 403, 200],
	['/reports', 200, 200, 200, 403, 200],
	['/ai', 200, 200, 200, 200, 200],
	['/notifications', 200, 200, 200, 200, 200],
	['/profile', 200, 200, 200, 200, 200]
];
const WHO: Who[] = ['priya', 'rohan', 'vikram', 'arjun', 'admin'];

describe('page access by role', () => {
	for (const [path, ...expected] of PAGES) {
		it(`${path}`, async () => {
			for (const [i, who] of WHO.entries()) {
				const res = await s[who].get(path);
				expect(res.status, `${who} GET ${path}`).toBe(expected[i]);
			}
		});
	}
});

describe('the consultant is read-only apart from adding notes', () => {
	it('has no write access to anything clinical or operational', async () => {
		const p = await db().patient.findFirstOrThrow({ where: { displayCode: 'P-10124' } });
		const plan = await db().therapyPlan.findFirstOrThrow({ where: { patientId: p.id } });
		const dev = await db().device.findFirstOrThrow({ where: { displayCode: 'PLUTO-002' } });
		const issue = await db().deviceIssue.findFirstOrThrow({});

		const writes: [string, string, Record<string, string>][] = [
			['create patient', '/patients/new', { name: 'X' }],
			['set status', `/patients/${p.id}?/setStatus`, { status: 'Paused' }],
			['edit plan', `/patients/${p.id}?/editPlan`, { planId: plan.id, status: 'Paused', dailyTargetMinutes: '10', targetSessions: '5', reason: 'x' }],
			['create plan', `/patients/${p.id}?/createPlan`, { name: 'x', startDate: '2026-01-01', durationDays: '5', dailyTargetMinutes: '10', deviceTypeIds: 'PLUTO' }],
			['upload document', `/patients/${p.id}?/addDocument`, {}],
			['request device', `/patients/${p.id}?/requestDevice`, { deviceTypeId: 'PLUTO' }],
			['new assessment', `/assessments/new?patient=${p.id}`, {}],
			['clear issue', '/device-issues?/clear', { id: issue.id }],
			['investigate issue', '/device-issues?/investigate', { id: issue.id }],
			['resolve issue', '/device-issues?/resolve', { id: issue.id, resolution: 'x' }],
			['report issue', '/device-issues?/report', { deviceId: dev.id, severity: 'Low', description: 'x' }],
			['register device', '/devices?/register', { deviceTypeId: 'PLUTO', serialNumber: 'X' }],
			['assign device', `/devices/${dev.id}?/assign`, { patientId: p.id }],
			['log maintenance', `/devices/${dev.id}?/logMaintenance`, { maintenanceType: 'Inspection & Safety Check', maintenanceDate: '2026-01-01' }],
			['clear request', '/device-requests?/clear', { id: 'x' }],
			['create user', '/users?/create', { name: 'x', email: 'x@y.z', role: 'ENGINEER' }],
			['create location', '/locations?/create', { name: 'Nope' }]
		];
		for (const [label, path, fields] of writes) {
			const r = await s.vikram.action(path, fields);
			expect(r.status, `consultant: ${label}`).toBe(403);
		}
	});

	it('can add patient notes and session notes', async () => {
		const p = await db().patient.findFirstOrThrow({ where: { displayCode: 'P-10124' } });
		const n = await s.vikram.action(`/patients/${p.id}?/addNote`, { text: 'Consultant review: continue current load.' });
		expect(n.type).toBe('success');
		const session = await db().therapySession.findFirstOrThrow({ where: { patientId: p.id } });
		const sn = await s.vikram.json('POST', `/api/sessions/${session.id}/notes`, { text: 'Observed good posture.' });
		expect(sn.status).toBe(200);
	});

	it('cannot see the audit log', async () => {
		expect((await s.vikram.get('/audit-log')).status).toBe(403);
	});
});

describe('admin is view-only for clinical and device records', () => {
	it('is refused every clinical/device mutation', async () => {
		const p = await db().patient.findFirstOrThrow({ where: { displayCode: 'P-10124' } });
		const plan = await db().therapyPlan.findFirstOrThrow({ where: { patientId: p.id } });
		const dev = await db().device.findFirstOrThrow({ where: { displayCode: 'PLUTO-002' } });
		const issue = await db().deviceIssue.findFirstOrThrow({});
		const session = await db().therapySession.findFirstOrThrow({ where: { patientId: p.id } });

		const writes: [string, string, Record<string, string>][] = [
			['create patient', '/patients/new', { name: 'X' }],
			['set status', `/patients/${p.id}?/setStatus`, { status: 'Paused' }],
			['edit plan', `/patients/${p.id}?/editPlan`, { planId: plan.id, status: 'Paused', dailyTargetMinutes: '10', targetSessions: '5', reason: 'x' }],
			['create plan', `/patients/${p.id}?/createPlan`, { name: 'x', startDate: '2026-01-01', durationDays: '5', dailyTargetMinutes: '10', deviceTypeIds: 'PLUTO' }],
			['upload document', `/patients/${p.id}?/addDocument`, {}],
			['new assessment', `/assessments/new?patient=${p.id}`, {}],
			['request device', `/patients/${p.id}?/requestDevice`, { deviceTypeId: 'PLUTO' }],
			['clear issue', '/device-issues?/clear', { id: issue.id }],
			['report issue', '/device-issues?/report', { deviceId: dev.id, severity: 'Low', description: 'x' }],
			['register device', '/devices?/register', { deviceTypeId: 'PLUTO', serialNumber: 'X' }],
			['assign device', `/devices/${dev.id}?/assign`, { patientId: p.id }],
			['log maintenance', `/devices/${dev.id}?/logMaintenance`, { maintenanceType: 'Inspection & Safety Check', maintenanceDate: '2026-01-01' }]
		];
		for (const [label, path, fields] of writes) {
			const r = await s.admin.action(path, fields);
			expect(r.status, `admin: ${label}`).toBe(403);
		}
		expect((await s.admin.json('POST', `/api/sessions/${session.id}/notes`, { text: 'x' })).status).toBe(403);
	});

	it('still manages users and locations and reads the audit log', async () => {
		expect((await s.admin.get('/users')).status).toBe(200);
		expect((await s.admin.get('/locations')).status).toBe(200);
		expect((await s.admin.get('/audit-log')).status).toBe(200);
	});
});

describe('the engineer has no clinical access', () => {
	it('cannot read clinical data through any endpoint', async () => {
		const p = await db().patient.findFirstOrThrow({ where: { displayCode: 'P-10124' } });
		const session = await db().therapySession.findFirstOrThrow({ where: { patientId: p.id } });
		expect((await s.arjun.get(`/patients/${p.id}`)).status).toBe(403);
		expect((await s.arjun.get(`/api/sessions/${session.id}`)).status).toBe(403);
		expect((await s.arjun.json('POST', `/api/sessions/${session.id}/notes`, { text: 'x' })).status).toBe(403);
		const addNote = await s.arjun.action(`/patients/${p.id}?/addNote`, { text: 'x' });
		expect(addNote.status).toBe(403);
	});
});
