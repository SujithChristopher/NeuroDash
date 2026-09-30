import { beforeAll, describe, expect, it } from 'vitest';
import { Client, PASSWORD, USERS, createUser, db, downtownId, loginAs, signInAll, uniq, type Sessions } from './helpers';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});

describe('login', () => {
	it('rejects a wrong password with a generic message', async () => {
		const r = await new Client().login(USERS.priya, 'wrong-password');
		expect(r.type).toBe('failure');
		expect(r.status).toBe(400);
		expect(String(r.data?.error)).toMatch(/invalid email or password/i);
	});

	it('gives the same message for an unknown email (no account enumeration)', async () => {
		const known = await new Client().login(USERS.priya, 'nope');
		const unknown = await new Client().login('nobody@nowhere.test', 'nope');
		expect(unknown.data?.error).toBe(known.data?.error);
	});

	it('rejects empty credentials', async () => {
		const r = await new Client().action('/login?/login', { email: '', password: '' });
		expect(r.type).toBe('failure');
	});

	it('signs in with correct credentials and sets an HttpOnly session cookie', async () => {
		const c = new Client();
		const r = await c.login(USERS.priya);
		expect(r.type).toBe('redirect');
		expect(r.location).toBe('/');
		const setCookie = r.raw.headers.getSetCookie().find((x) => x.startsWith('session='))!;
		expect(setCookie).toMatch(/HttpOnly/i);
		expect(setCookie).toMatch(/SameSite=Lax/i);
		// (Secure is on in production; SvelteKit exempts plain http://localhost, which is what tests use.)
		expect(c.sessionCookie).toMatch(/^[0-9a-f]{64}$/);
	});

	it('refuses to sign in a deactivated account', async () => {
		const u = await createUser(s.admin, { role: 'ENGINEER' });
		await db().user.update({ where: { email: u.email }, data: { isActive: false } });
		const r = await new Client().login(u.email);
		expect(r.type).toBe('failure');
		// And an already-open session stops working the moment the account is deactivated.
		expect((await u.client.get('/analytics')).status).toBe(302);
	});

	it('writes an audit entry on sign-in', async () => {
		await loginAs(USERS.vikram);
		const row = await db().auditLog.findFirst({ where: { action: 'Signed In', actorRole: 'CONSULTANT' } });
		expect(row).toBeTruthy();
	});
});

describe('sessions and route protection', () => {
	it('redirects unauthenticated page requests to /login', async () => {
		for (const path of ['/', '/patients', '/devices', '/notifications', '/users']) {
			const res = await s.anon.get(path);
			expect(res.status, path).toBe(302);
			expect(res.headers.get('location')).toBe('/login');
		}
	});

	it('answers 401 to unauthenticated API calls', async () => {
		expect((await s.anon.get('/api/notifications')).status).toBe(401);
		expect((await s.anon.get('/api/search?q=a')).status).toBe(401);
		expect((await s.anon.json('POST', '/api/ai', { question: 'hi' })).status).toBe(401);
	});

	it('rejects a forged or malformed session cookie', async () => {
		const c = new Client();
		c.setSession('0'.repeat(64));
		expect((await c.get('/patients')).status).toBe(302);
		c.setSession("'; drop table users; --");
		expect((await c.get('/patients')).status).toBe(302);
	});

	it('rejects an expired session', async () => {
		const c = await loginAs(USERS.priya);
		await db().session.update({ where: { id: c.sessionCookie! }, data: { expiresAt: new Date(Date.now() - 1000) } });
		expect((await c.get('/patients')).status).toBe(302);
	});

	it('logout destroys the session server-side, not just the cookie', async () => {
		const c = await loginAs(USERS.priya);
		const token = c.sessionCookie!;
		const out = await c.json('POST', '/logout');
		expect(out.status).toBe(303);
		expect(await db().session.findUnique({ where: { id: token } })).toBeNull();

		const replay = new Client();
		replay.setSession(token);
		expect((await replay.get('/patients')).status).toBe(302);
	});

	it('blocks cross-origin form posts (CSRF)', async () => {
		const post = (origin?: string) =>
			fetch(`${process.env.TEST_BASE_URL}/login?/login`, {
				method: 'POST',
				headers: { ...(origin ? { origin } : {}), 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ email: USERS.priya, password: PASSWORD }),
				redirect: 'manual'
			});
		expect((await post('https://evil.example')).status).toBe(403);
		expect((await post()).status).toBe(403); // no Origin at all
		expect((await post(process.env.TEST_BASE_URL)).status).not.toBe(403);
	});

	it('a signed-in user visiting /login is sent home', async () => {
		const res = await s.priya.get('/login');
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('/');
	});
});

describe('forced password reset (first login with a temporary password)', () => {
	it('a temp-password session cannot reach the app until a new password is set', async () => {
		const email = `${uniq('reset')}@test.neurodash`;
		const created = await s.admin.action<{ tempPassword: string }>('/users?/create', { name: 'Reset Tester', email, role: 'ENGINEER' });
		const temp = created.data!.tempPassword;
		expect(temp).toMatch(/^[A-HJKMNP-Za-km-z2-9]{12}$/); // unambiguous alphabet, length 12

		const c = new Client();
		const login = await c.login(email, temp);
		expect(login.type).toBe('success');
		expect(login.data?.mustResetPassword).toBe(true);

		// Holding the reset cookie is not an access session.
		for (const p of ['/', '/devices', '/analytics']) expect((await c.get(p)).status, p).toBe(302);
		expect((await c.get('/api/notifications')).status).toBe(401);

		// Weak / mismatched / unchanged passwords are refused.
		expect((await c.action('/login?/setPassword', { password: 'short', confirm: 'short' })).type).toBe('failure');
		expect((await c.action('/login?/setPassword', { password: 'longenough1', confirm: 'different1' })).type).toBe('failure');
		const same = await c.action('/login?/setPassword', { password: temp, confirm: temp });
		expect(same.type).toBe('failure');

		const ok = await c.action('/login?/setPassword', { password: 'a-new-password-1', confirm: 'a-new-password-1' });
		expect(ok.type).toBe('redirect');
		expect((await c.get('/analytics')).status).toBe(200);

		// The temp password is dead; the new one works; the flag is cleared.
		expect((await new Client().login(email, temp)).type).toBe('failure');
		expect((await new Client().login(email, 'a-new-password-1')).type).toBe('redirect');
		expect((await db().user.findUniqueOrThrow({ where: { email } })).mustResetPassword).toBe(false);
	});

	it('setPassword without a reset session is refused', async () => {
		const r = await s.anon.action('/login?/setPassword', { password: 'whatever-123', confirm: 'whatever-123' });
		expect(r.status).toBe(401);
		const r2 = await s.priya.action('/login?/setPassword', { password: 'whatever-123', confirm: 'whatever-123' });
		expect(r2.type).not.toBe('redirect'); // a normal access session cannot be used to change a password this way
	});

	it('a reset session expires', async () => {
		const u = await createUser(s.admin, { role: 'ENGINEER' });
		const fresh = await s.admin.action<{ tempPassword: string }>('/users?/resetPassword', {
			id: (await db().user.findUniqueOrThrow({ where: { email: u.email } })).id
		});
		const c = new Client();
		await c.login(u.email, fresh.data!.tempPassword);
		await db().session.update({ where: { id: c.sessionCookie! }, data: { expiresAt: new Date(Date.now() - 1000) } });
		const r = await c.action('/login?/setPassword', { password: 'a-new-password-1', confirm: 'a-new-password-1' });
		expect(r.status).toBe(401);
	});
});

describe('forgot password', () => {
	it('returns an identical reply whether or not the email exists', async () => {
		const target = await createUser(s.admin, { role: 'THERAPIST', locationId: await downtownId() });
		const known = await new Client().action('/login?/forgotPassword', { email: target.email });
		const unknown = await new Client().action('/login?/forgotPassword', { email: 'ghost@nowhere.test' });
		expect(known.data?.forgotMessage).toBeTruthy();
		expect(unknown.data?.forgotMessage).toBe(known.data?.forgotMessage);
	});

	it('issues a temp password, flags the account, notifies admins, and audits as SYSTEM', async () => {
		const target = await createUser(s.admin, { role: 'THERAPIST', locationId: await downtownId() });
		await new Client().action('/login?/forgotPassword', { email: target.email });

		const user = await db().user.findUniqueOrThrow({ where: { email: target.email } });
		expect(user.mustResetPassword).toBe(true);

		const note = await db().notification.findFirst({
			where: { targetRole: 'ADMIN', description: { contains: target.email } },
			orderBy: { createdAt: 'desc' }
		});
		expect(note).toBeTruthy();
		const temp = /Temporary password: (\S+)/.exec(note!.description)![1];

		const audit = await db().auditLog.findFirst({ where: { action: 'Password Reset Requested', entityId: user.id } });
		expect(audit?.actorRole).toBe('SYSTEM');
		expect(audit?.actorUserId).toBeNull();

		// The old password no longer works; the relayed temp one does (and forces a reset).
		expect((await new Client().login(target.email, PASSWORD)).type).toBe('failure');
		const again = await new Client().login(target.email, temp);
		expect(again.data?.mustResetPassword).toBe(true);
	});

	it('does nothing for a deactivated account', async () => {
		const target = await createUser(s.admin, { role: 'ENGINEER' });
		await db().user.update({ where: { email: target.email }, data: { isActive: false } });
		const before = (await db().user.findUniqueOrThrow({ where: { email: target.email } })).passwordHash;
		await new Client().action('/login?/forgotPassword', { email: target.email });
		expect((await db().user.findUniqueOrThrow({ where: { email: target.email } })).passwordHash).toBe(before);
	});
});
