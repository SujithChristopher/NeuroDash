import { beforeAll, describe, expect, it } from 'vitest';
import { createPatient, db, pageData, signInAll, uniq, type Sessions } from './helpers';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});

describe('notifications', () => {
	it('shows a user their own and their role’s broadcasts — never someone else’s', async () => {
		const vikram = await db().user.findUniqueOrThrow({ where: { email: 'vikram.suresh@neurodash.care' } });
		const secret = uniq('secret-for-vikram-');
		await db().notification.create({ data: { targetUserId: vikram.id, notifType: 'system', title: secret, description: secret } });
		const broadcast = uniq('engineers-only-');
		await db().notification.create({ data: { targetRole: 'ENGINEER', notifType: 'system', title: broadcast, description: broadcast } });

		const titles = async (c: typeof s.priya) => ((await (await c.get('/api/notifications?limit=100')).json()).items as { title: string }[]).map((n) => n.title);
		expect(await titles(s.vikram)).toContain(secret);
		expect(await titles(s.priya)).not.toContain(secret);
		expect(await titles(s.arjun)).toContain(broadcast);
		expect(await titles(s.priya)).not.toContain(broadcast);
		expect(await titles(s.rohan)).not.toContain(broadcast);
	});

	it('counts unread, and marking read only ever touches the caller’s own notifications', async () => {
		const vikram = await db().user.findUniqueOrThrow({ where: { email: 'vikram.suresh@neurodash.care' } });
		const n = await db().notification.create({ data: { targetUserId: vikram.id, notifType: 'system', title: 'x', description: 'x' } });

		// Priya tries to mark Vikram's notification read (by id) — it must be a no-op.
		await s.priya.json('POST', '/api/notifications/read', { id: n.id });
		expect((await db().notification.findUniqueOrThrow({ where: { id: n.id } })).isRead).toBe(false);

		const before = (await (await s.vikram.get('/api/notifications')).json()).unread;
		expect(before).toBeGreaterThan(0);
		await s.vikram.json('POST', '/api/notifications/read', { id: n.id });
		expect((await db().notification.findUniqueOrThrow({ where: { id: n.id } })).isRead).toBe(true);
		expect((await (await s.vikram.get('/api/notifications')).json()).unread).toBe(before - 1);

		await s.vikram.json('POST', '/api/notifications/read', {});
		expect((await (await s.vikram.get('/api/notifications')).json()).unread).toBe(0);
	});

	it('bounds the page size and requires sign-in', async () => {
		const items = (await (await s.admin.get('/api/notifications?limit=100000')).json()).items;
		expect(items.length).toBeLessThanOrEqual(100);
		expect((await s.anon.json('POST', '/api/notifications/read', {})).status).toBe(401);
	});

	it('the unread filter on the notifications page only lists unread items', async () => {
		await s.vikram.json('POST', '/api/notifications/read', {});
		const d = await pageData(s.vikram, '/notifications?filter=unread');
		expect(d.items).toHaveLength(0);
		expect(d.filter).toBe('unread');
	});
});

describe('global search', () => {
	let name: string;
	beforeAll(async () => {
		name = uniq('Searchable');
		await createPatient(s.priya, name);
	});
	const search = async (c: typeof s.priya, q: string) => (await (await c.get(`/api/search?q=${encodeURIComponent(q)}`)).json()) as { patients: { name: string }[]; devices: { displayCode: string }[] };

	it('finds patients by name or code within the caller’s location', async () => {
		expect((await search(s.priya, name.toLowerCase())).patients.map((p) => p.name)).toContain(name);
		const code = (await db().patient.findFirstOrThrow({ where: { name } })).displayCode;
		expect((await search(s.vikram, code.toLowerCase())).patients.map((p) => p.name)).toContain(name);
		expect((await search(s.admin, name)).patients.map((p) => p.name)).toContain(name);
		expect((await search(s.rohan, name)).patients).toHaveLength(0);
	});

	it('finds devices by code or serial', async () => {
		expect((await search(s.arjun, 'pluto-001')).devices.map((d) => d.displayCode)).toContain('PLUTO-001');
		expect((await search(s.arjun, 'SN-PL-0001')).devices.map((d) => d.displayCode)).toContain('PLUTO-001');
	});

	it('never returns patients to an engineer', async () => {
		expect((await search(s.arjun, name)).patients).toHaveLength(0);
		expect((await search(s.arjun, 'Ananya')).patients).toHaveLength(0);
	});

	it('treats wildcards and odd input literally and returns nothing for an empty query', async () => {
		expect((await search(s.admin, '')).patients).toHaveLength(0);
		expect((await search(s.admin, '   ')).patients).toHaveLength(0);
		expect((await search(s.admin, '%')).patients).toHaveLength(0);
		expect((await search(s.admin, "'; drop table patients; --")).patients).toHaveLength(0);
		expect(await db().patient.count()).toBeGreaterThan(0);
	});

	it('caps results at five per group', async () => {
		expect((await search(s.admin, 'P-')).patients.length).toBeLessThanOrEqual(5);
	});
});

describe('AI assistant', () => {
	const ask = (c: typeof s.priya, question: unknown) => c.json('POST', '/api/ai', { question });

	it('validates the question', async () => {
		expect((await ask(s.priya, '')).status).toBe(400);
		expect((await ask(s.priya, '   ')).status).toBe(400);
		expect((await ask(s.priya, 'x'.repeat(501))).status).toBe(400);
		expect((await ask(s.priya, 123)).status).toBe(400);
		expect((await s.priya.json('POST', '/api/ai', {})).status).toBe(400);
		expect((await s.anon.json('POST', '/api/ai', { question: 'hi' })).status).toBe(401);
	});

	it('answers a patient question from real data: baseline vs latest, with facts and a link', async () => {
		const r = await ask(s.priya, 'Has Ananya improved since baseline?');
		expect(r.status).toBe(200);
		expect(r.body.text).toMatch(/Ananya R\. has shown improvement/);
		const facts = Object.fromEntries(r.body.facts.map((f: { label: string; value: string }) => [f.label, f.value]));
		expect(facts.Baseline).toMatch(/^\d+(\.\d+)?\/66$/);
		expect(facts.Latest).toMatch(/\/66$/);
		expect(facts.Change).toMatch(/^\+\d+/);
		expect(r.body.links.some((l: { href: string }) => l.href.startsWith('/patients/'))).toBe(true);
		expect(r.body.tags).toContain('calculated');
	});

	it('answers device, hours and adherence questions', async () => {
		expect((await ask(s.priya, 'Which device does Ananya use most?')).body.text).toMatch(/uses (PLUTO|MARS)-001 the most/);
		expect((await ask(s.priya, 'How many hours this week did Ananya train?')).body.text).toMatch(/last 7 days/);
		expect((await ask(s.priya, 'Is Ananya following the plan?')).body.text).toMatch(/(on track|moderately behind|significantly behind)/);
		expect((await ask(s.priya, 'Which device has the highest utilization?')).body.text).toMatch(/most-used device/);
		expect((await ask(s.priya, 'Show unresolved device issues')).body.text).toMatch(/unresolved device issue/);
	});

	it('is scoped: a therapist at another location gets no information about the patient', async () => {
		const r = await ask(s.rohan, 'Has Ananya improved since baseline?');
		expect(r.body.text).not.toMatch(/Ananya/);
		expect(r.body.facts.every((f: { label: string }) => f.label === 'Try')).toBe(true);
	});

	it('an engineer only gets device answers, never patient ones', async () => {
		const p = await ask(s.arjun, 'Has Ananya improved since baseline?');
		expect(p.body.text).toMatch(/device questions/);
		expect(JSON.stringify(p.body)).not.toMatch(/Baseline|Ananya R/);
		expect((await ask(s.arjun, 'Show unresolved device issues')).body.text).toMatch(/unresolved device issue/);
		const low = await ask(s.arjun, 'Which patients have low adherence?');
		expect(low.body.text).toMatch(/device questions/);
	});

	it('low-adherence lists only in-scope patients', async () => {
		const name = uniq('Lapsed');
		const id = await createPatient(s.priya, name);
		await s.priya.action(`/patients/${id}?/createPlan`, { name: 'Plan', startDate: '2026-09-01', durationDays: '10', dailyTargetMinutes: '60', deviceTypeIds: 'PLUTO' });
		const plan = await db().therapyPlan.findFirstOrThrow({ where: { patientId: id } });
		await db().planDayLog.updateMany({ where: { planId: plan.id, dayNumber: { lte: 4 } }, data: { status: 'missed', actualMinutes: 0 } });

		const mine = await ask(s.priya, 'Which patients have low adherence?');
		expect(mine.body.facts.map((f: { label: string }) => f.label).join('|')).toContain(name);
		const theirs = await ask(s.rohan, 'Which patients have low adherence?');
		expect(JSON.stringify(theirs.body)).not.toContain(name);
		const admin = await ask(s.admin, 'Which patients have low adherence?');
		expect(admin.body.facts.map((f: { label: string }) => f.label).join('|')).toContain(name);
	});

	it('says plainly when it cannot answer, and never guesses', async () => {
		const r = await ask(s.priya, 'What will the weather be tomorrow?');
		expect(r.body.tags).toEqual([]);
		expect(r.body.text).toMatch(/don.t have an answer/);
		const ambiguous = await ask(s.priya, 'Has Zzyzx improved?');
		expect(ambiguous.body.tags).toEqual([]);
	});

	it('does not refer to an ambiguous first name', async () => {
		await createPatient(s.priya, 'Twin A.');
		await createPatient(s.priya, 'Twin B.');
		const r = await ask(s.priya, 'How is Twin doing now?');
		expect(r.body.text).not.toMatch(/Twin [AB]\./);
	});
});

describe('analytics are scoped and bucketed server-side', () => {
	it('program KPIs match the database for each location', async () => {
		await createPatient(s.rohan, uniq('NorthPat')); // make sure North Campus has a patient of its own
		const down = await db().patient.count({ where: { therapist: { location: { name: 'Downtown Clinic' } } } });
		const north = await db().patient.count({ where: { therapist: { location: { name: 'North Campus' } } } });
		const all = await db().patient.count();
		expect((await pageData(s.priya, '/analytics')).program.total).toBe(down);
		expect((await pageData(s.vikram, '/analytics')).program.total).toBe(down);
		expect((await pageData(s.rohan, '/analytics')).program.total).toBe(north);
		expect((await pageData(s.admin, '/analytics')).program.total).toBe(all);
		expect(all).toBeGreaterThan(down);
	});

	it('the engineer console is fleet-wide and carries no patient program data', async () => {
		const d = await pageData(s.arjun, '/analytics');
		expect(d.program).toBeNull();
		expect(d.fleet.total).toBe(await db().device.count());
		expect(d.fleet.inUse).toBe(await db().device.count({ where: { status: 'In Use' } }));
		expect(d.audit).toBeNull();
	});

	it('the admin view has both, plus recent audit activity', async () => {
		const d = await pageData(s.admin, '/analytics');
		expect(d.program).toBeTruthy();
		expect(d.fleet).toBeTruthy();
		expect(d.audit.length).toBeGreaterThan(0);
	});

	it('inflow buckets by calendar day (UTC) or month and totals what was registered', async () => {
		const today = new Date();
		const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
		const registeredToday = await db().patient.count({ where: { registrationDate: { gte: startOfDay }, therapist: { location: { name: 'Downtown Clinic' } } } });
		const shape = { today: 2, week: 8, month: 31, year: 12 } as const;
		for (const [range, n] of Object.entries(shape)) {
			const d = await pageData(s.priya, `/analytics?range=${range}`);
			expect(d.inflow.labels, range).toHaveLength(n);
			expect(d.inflow.values, range).toHaveLength(n);
			expect(d.range).toBe(range);
		}
		const week = await pageData(s.priya, '/analytics?range=week');
		expect(week.inflow.values.at(-1)).toBe(registeredToday); // last bucket is today
		expect((await pageData(s.priya, '/analytics?range=year')).inflow.values.at(-1)).toBeGreaterThanOrEqual(registeredToday);
	});

	it('falls back to "month" for an unknown range', async () => {
		expect((await pageData(s.priya, '/analytics?range=decade')).range).toBe('month');
	});

	it('the Overview’s today list uses UTC calendar days', async () => {
		const d = await pageData(s.priya, '/');
		const startOfDay = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
		const expected = await db().therapySession.count({
			where: { sessionDate: { gte: startOfDay, lt: new Date(startOfDay.getTime() + 86400_000) }, patient: { therapist: { location: { name: 'Downtown Clinic' } } } }
		});
		expect(d.today).toHaveLength(expected);
		expect(d.todos.some((t: { title: string }) => /baseline assessment/.test(t.title))).toBe(true);
	});
});

describe('reports', () => {
	it('builds a patient report from scoped data and refuses other locations’ patients', async () => {
		const p = await db().patient.findFirstOrThrow({ where: { displayCode: 'P-10124' } });
		const mine = await pageData(s.priya, `/reports?view=patient&patient=${p.id}`);
		expect(mine.patientReport.patient.displayCode).toBe('P-10124');
		expect(mine.patientReport.sessionsCount).toBeGreaterThan(0);
		expect(mine.patientReport.assessment.latest).toBeGreaterThanOrEqual(mine.patientReport.assessment.baseline);
		expect(mine.patientReport.sessions[0]).toHaveProperty('accuracyPct');
		const theirs = await pageData(s.rohan, `/reports?view=patient&patient=${p.id}`);
		expect(theirs.patientReport).toBeNull();
		expect((await pageData(s.rohan, '/reports')).patients.map((x: { id: string }) => x.id)).not.toContain(p.id);
	});

	it('the device report is fleet-wide and the inflow report honours the range', async () => {
		const dev = await pageData(s.admin, '/reports?view=device');
		expect(dev.deviceRows.length).toBe(await db().device.count());
		const hours = dev.deviceRows.map((r: { totalMin: number }) => r.totalMin);
		expect(hours).toEqual([...hours].sort((a: number, b: number) => b - a));
		expect((await pageData(s.priya, '/reports?view=inflow&range=year')).inflow.labels).toHaveLength(12);
	});

	it('is closed to engineers', async () => {
		expect((await s.arjun.get('/reports')).status).toBe(403);
	});
});
