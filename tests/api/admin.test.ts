import { beforeAll, describe, expect, it } from 'vitest';
import { Client, PASSWORD, createPatient, createUser, db, downtownId, northId, pageData, signInAll, uniq, type Sessions } from './helpers';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});

const create = (over: Record<string, string> = {}) =>
	s.admin.action<{ tempPassword: string; tempFor: string }>('/users?/create', { name: 'Dr. Jane Tester', email: `${uniq('j')}@test.neurodash`, role: 'THERAPIST', title: 'Physio', ...over });

describe('creating accounts', () => {
	it('creates a therapist with a location, a code, initials and a one-time temp password', async () => {
		const email = `${uniq('t')}@test.neurodash`;
		const loc = await downtownId();
		const r = await create({ email, locationId: loc });
		expect(r.type).toBe('success');
		expect(r.data?.tempPassword).toMatch(/^[A-HJKMNP-Za-km-z2-9]{12}$/); // no 0/O/1/I/l
		const u = await db().user.findUniqueOrThrow({ where: { email } });
		expect(u.displayCode).toMatch(/^U-T\d{2}$/);
		expect(u.initials).toBe('JT'); // "Dr." is dropped
		expect([u.role, u.locationId, u.mustResetPassword, u.isActive]).toEqual(['THERAPIST', loc, true, true]);
		expect(u.passwordHash).not.toContain(r.data!.tempPassword); // never stored in plaintext
		expect(await db().auditLog.findFirst({ where: { action: 'User Created', entityId: u.id } })).toBeTruthy();
	});

	it('uses the role prefix for display codes', async () => {
		const loc = await downtownId();
		const c = await create({ role: 'CONSULTANT', locationId: loc, email: `${uniq('c')}@test.neurodash` });
		const e = await create({ role: 'ENGINEER', email: `${uniq('e')}@test.neurodash` });
		expect(c.type).toBe('success');
		expect(e.type).toBe('success');
		const latestC = await db().user.findMany({ where: { role: 'CONSULTANT' }, orderBy: { createdAt: 'desc' }, take: 1 });
		const latestE = await db().user.findMany({ where: { role: 'ENGINEER' }, orderBy: { createdAt: 'desc' }, take: 1 });
		expect(latestC[0].displayCode).toMatch(/^U-C\d{2}$/);
		expect(latestE[0].displayCode).toMatch(/^U-E\d{2}$/);
	});

	it('requires a location for therapists and consultants, and ignores one for engineers', async () => {
		expect((await create({ role: 'THERAPIST' })).type).toBe('failure');
		expect((await create({ role: 'CONSULTANT' })).type).toBe('failure');
		expect((await create({ role: 'THERAPIST', locationId: 'no-such-location' })).type).toBe('failure');
		const email = `${uniq('eng')}@test.neurodash`;
		expect((await create({ role: 'ENGINEER', email, locationId: await downtownId() })).type).toBe('success');
		expect((await db().user.findUniqueOrThrow({ where: { email } })).locationId).toBeNull();
	});

	it('can never create another admin, nor an unknown role', async () => {
		const before = await db().user.count({ where: { role: 'ADMIN' } });
		expect((await create({ role: 'ADMIN' })).type).toBe('failure');
		expect((await create({ role: 'SUPERUSER' })).type).toBe('failure');
		expect(await db().user.count({ where: { role: 'ADMIN' } })).toBe(before);
	});

	it('validates name and email and rejects duplicates (case-insensitively)', async () => {
		const loc = await downtownId();
		expect((await create({ name: '   ', locationId: loc })).type).toBe('failure');
		expect((await create({ email: 'not-an-email', locationId: loc })).type).toBe('failure');
		const email = `${uniq('dup')}@test.neurodash`;
		expect((await create({ email, locationId: loc })).type).toBe('success');
		expect((await create({ email: email.toUpperCase(), locationId: loc })).type).toBe('failure');
		expect((await create({ email: 'priya.nair@neurodash.care', locationId: loc })).type).toBe('failure');
	});

	it('is admin-only', async () => {
		for (const who of ['priya', 'vikram', 'arjun'] as const) {
			const r = await s[who].action('/users?/create', { name: 'x', email: `${uniq()}@t.test`, role: 'ENGINEER' });
			expect(r.status, who).toBe(403);
		}
		expect((await s.anon.action('/users?/create', { name: 'x', email: 'a@b.co', role: 'ENGINEER' })).status).toBe(302);
	});

	it('new users can sign in only after choosing a real password, and see the right data', async () => {
		const u = await createUser(s.admin, { role: 'THERAPIST', locationId: await northId() });
		expect((await u.client.get('/patients')).status).toBe(200);
		expect((await u.client.get('/users')).status).toBe(403);
	});
});

describe('resetting a password', () => {
	it('issues a new temp password, signs the user out everywhere, and forces a reset', async () => {
		const u = await createUser(s.admin, { role: 'ENGINEER' });
		const row = await db().user.findUniqueOrThrow({ where: { email: u.email } });
		expect((await u.client.get('/analytics')).status).toBe(200);

		const r = await s.admin.action<{ tempPassword: string }>('/users?/resetPassword', { id: row.id });
		expect(r.type).toBe('success');
		expect(await db().session.count({ where: { userId: row.id } })).toBe(0);
		expect((await u.client.get('/analytics')).status).toBe(302); // existing session is gone
		expect((await new Client().login(u.email, PASSWORD)).type).toBe('failure');
		const again = await new Client().login(u.email, r.data!.tempPassword);
		expect(again.data?.mustResetPassword).toBe(true);
		expect(await db().auditLog.findFirst({ where: { action: 'Password Reset', entityId: row.id } })).toBeTruthy();
	});

	it('rejects an unknown user and non-admins', async () => {
		expect((await s.admin.action('/users?/resetPassword', { id: 'nope' })).type).toBe('failure');
		const target = await db().user.findUniqueOrThrow({ where: { email: 'arjun.rao@neurodash.care' } });
		for (const who of ['priya', 'vikram', 'arjun'] as const) {
			expect((await s[who].action('/users?/resetPassword', { id: target.id })).status, who).toBe(403);
		}
		// Arjun's own password was not touched by the failed attempts.
		expect((await new Client().login('arjun.rao@neurodash.care')).type).toBe('redirect');
	});
});

describe('the users page', () => {
	it('lists everyone grouped by role and never exposes password hashes', async () => {
		const html = await (await s.admin.get('/users')).text();
		for (const name of ['Dr. Priya Nair', 'Dr. Vikram Suresh', 'Arjun Rao']) expect(html).toContain(name);
		expect(html).not.toMatch(/\$2[aby]\$\d\d\$/); // bcrypt hash prefix
		expect(html).not.toContain('passwordHash');
	});

	it('flags accounts whose password reset is still pending', async () => {
		const email = `${uniq('pend')}@test.neurodash`;
		await create({ email, role: 'ENGINEER' });
		expect(await (await s.admin.get('/users')).text()).toContain('Password reset pending');
	});
});

describe('locations', () => {
	it('admin creates a location, duplicates are refused (409), blanks are refused', async () => {
		const name = uniq('Clinic ');
		expect((await s.admin.action('/locations?/create', { name })).type).toBe('success');
		expect(await db().location.findUnique({ where: { name } })).toBeTruthy();
		const dup = await s.admin.action('/locations?/create', { name });
		expect(dup.type).toBe('failure');
		expect(dup.status).toBe(409);
		expect((await s.admin.action('/locations?/create', { name: '   ' })).type).toBe('failure');
		expect(await db().auditLog.findFirst({ where: { action: 'Location Created' } })).toBeTruthy();
	});

	it('cannot delete a location that still has staff, but can delete an empty one', async () => {
		const name = uniq('Temp ');
		await s.admin.action('/locations?/create', { name });
		const loc = await db().location.findUniqueOrThrow({ where: { name } });
		const u = await createUser(s.admin, { role: 'THERAPIST', locationId: loc.id });

		const blocked = await s.admin.action('/locations?/delete', { id: loc.id });
		expect(blocked.status).toBe(409);
		expect(String(blocked.data?.error)).toMatch(/assigned user/);
		expect(await db().location.findUnique({ where: { id: loc.id } })).toBeTruthy();

		await db().user.update({ where: { email: u.email }, data: { locationId: await downtownId() } });
		expect((await s.admin.action('/locations?/delete', { id: loc.id })).type).toBe('success');
		expect(await db().location.findUnique({ where: { id: loc.id } })).toBeNull();
		expect((await s.admin.action('/locations?/delete', { id: loc.id })).status).toBe(404);
	});

	it('is admin-only', async () => {
		for (const who of ['priya', 'vikram', 'arjun'] as const) {
			expect((await s[who].action('/locations?/create', { name: uniq() })).status, who).toBe(403);
			expect((await s[who].action('/locations?/delete', { id: 'x' })).status, who).toBe(403);
		}
	});
});

describe('the audit log', () => {
	it('is visible to the admin only', async () => {
		expect((await s.admin.get('/audit-log')).status).toBe(200);
		for (const who of ['priya', 'rohan', 'vikram', 'arjun'] as const) {
			expect((await s[who].get('/audit-log')).status, who).toBe(403);
		}
		expect((await s.anon.get('/audit-log')).status).toBe(302);
	});

	it('records actor, role, action and entity for real actions, newest first', async () => {
		const id = await createPatient(s.priya, uniq('Audited'));
		const html = await (await s.admin.get('/audit-log')).text();
		expect(html).toContain('Patient Created');
		expect(html).toContain('Dr. Priya Nair');
		const row = await db().auditLog.findFirstOrThrow({ where: { entityId: id, action: 'Patient Created' }, include: { actorUser: true } });
		expect([row.actorRole, row.entityType, row.actorUser?.email]).toEqual(['THERAPIST', 'Patient', 'priya.nair@neurodash.care']);
	});

	it('filters by action and by role', async () => {
		await createPatient(s.priya);
		await s.vikram.action(`/patients/${await createPatient(s.priya)}?/addNote`, { text: 'note' });
		const byAction = await pageData(s.admin, '/audit-log?action=Patient%20Created');
		expect(byAction.rows.length).toBeGreaterThan(0);
		expect(byAction.rows.every((r: { action: string }) => r.action === 'Patient Created')).toBe(true);
		const byRole = await pageData(s.admin, '/audit-log?role=CONSULTANT');
		expect(byRole.rows.length).toBeGreaterThan(0);
		expect(byRole.rows.every((r: { role: string }) => r.role === 'CONSULTANT')).toBe(true);
		expect(byRole.rows.some((r: { action: string }) => r.action === 'Note Added')).toBe(true);
		const sys = await pageData(s.admin, '/audit-log?role=SYSTEM');
		expect(sys.rows.every((r: { role: string; user: string }) => r.role === 'SYSTEM' && r.user === 'System')).toBe(true);
		// The action dropdown offers every distinct action that has been logged.
		expect(byAction.actions).toContain('Note Added');
	});

	it('caps the listing at the 100 most recent events', async () => {
		const d = await pageData(s.admin, '/audit-log');
		expect(d.rows.length).toBeLessThanOrEqual(100);
		const times = d.rows.map((r: { at: string }) => new Date(r.at).getTime());
		expect(times).toEqual([...times].sort((a, b) => b - a));
	});

	it('does not log passwords or temp passwords', async () => {
		const rows = await db().auditLog.findMany({ where: { action: { in: ['User Created', 'Password Reset', 'Password Set', 'Signed In'] } } });
		const blob = JSON.stringify(rows);
		expect(blob).not.toContain(PASSWORD);
		expect(blob).not.toMatch(/Temporary password: \S+/); // the password itself never appears
	});
});
