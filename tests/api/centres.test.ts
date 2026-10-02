import { beforeAll, describe, expect, it } from 'vitest';
import { createPatient, db, downtownId, northId, pageData, signInAll, type Sessions } from './helpers';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});

type Centre = { id: string; name: string; engineer: string | null; therapists: number; consultants: number; devices: number; patients: number; byStatus: Record<string, number>; totalHours: number; activeDays: number; activeDays30: number };
const centres = async (c: typeof s.admin) => (await pageData(c, '/analytics')).centres as Centre[];
const downtown = async (c = s.admin) => (await centres(c)).find((x) => x.name === 'Downtown Clinic')!;

describe('analytics per centre', () => {
	it('shows each centre with its staff, devices, patients by status, hours and active days, matching the database', async () => {
		const d = await downtown();
		const id = await downtownId();
		expect(d.therapists).toBe(await db().user.count({ where: { locationId: id, role: 'THERAPIST', isActive: true } }));
		expect(d.consultants).toBe(await db().user.count({ where: { locationId: id, role: 'CONSULTANT', isActive: true } }));
		expect(d.devices).toBe(await db().device.count({ where: { locationId: id } }));
		expect(d.patients).toBe(await db().patient.count({ where: { therapist: { locationId: id } } }));
		expect(Object.values(d.byStatus).reduce((a, b) => a + b, 0)).toBe(d.patients);
		const sessions = { patient: { therapist: { locationId: id } } };
		const mins = Number((await db().therapySession.aggregate({ where: sessions, _sum: { durationMinutes: true } }))._sum.durationMinutes ?? 0);
		expect(d.totalHours).toBeCloseTo(Math.round((mins / 60) * 10) / 10, 1);
		expect(d.activeDays).toBe((await db().therapySession.groupBy({ by: ['sessionDate'], where: sessions })).length);
		expect(d.activeDays).toBeGreaterThan(0);
		expect(d.activeDays30).toBeLessThanOrEqual(d.activeDays);
		expect(d.byStatus).toHaveProperty('Discontinued');
		expect(d.byStatus).toHaveProperty('Completed');
	});

	it('names the responsible engineer', async () => {
		expect((await downtown()).engineer).toBe('Arjun Rao');
	});

	it('counts patients by status as they change', async () => {
		const before = await downtown();
		const pid = await createPatient(s.priya);
		expect((await downtown()).byStatus.Active).toBe(before.byStatus.Active + 1);
		await s.priya.action(`/patients/${pid}?/setStatus`, { status: 'Discontinued' });
		const after = await downtown();
		expect([after.byStatus.Active, after.byStatus.Discontinued]).toEqual([before.byStatus.Active, before.byStatus.Discontinued + 1]);
		await s.priya.action(`/patients/${pid}?/setStatus`, { status: 'Paused' });
		expect((await downtown()).byStatus.Paused).toBe(before.byStatus.Paused + 1);
		expect((await downtown()).patients).toBe(before.patients + 1);
	});

	it('the admin sees every centre; therapists and consultants only their own; engineers none', async () => {
		expect((await centres(s.admin)).map((c) => c.name)).toEqual(expect.arrayContaining(['Downtown Clinic', 'North Campus']));
		expect((await centres(s.priya)).map((c) => c.name)).toEqual(['Downtown Clinic']);
		expect((await centres(s.vikram)).map((c) => c.name)).toEqual(['Downtown Clinic']);
		expect((await centres(s.rohan)).map((c) => c.name)).toEqual(['North Campus']);
		expect(await centres(s.arjun)).toEqual([]);
	});
});

describe('the engineer responsible for a centre', () => {
	const set = (c: typeof s.admin, id: string, engineerId: string) => c.action('/locations?/setEngineer', { id, engineerId });

	it('is set and cleared by the admin, and audited', async () => {
		const north = await northId();
		const arjun = await db().user.findFirstOrThrow({ where: { email: 'arjun.rao@neurodash.care' } });
		expect((await set(s.admin, north, '')).type).toBe('success');
		expect((await db().location.findUniqueOrThrow({ where: { id: north } })).engineerId).toBeNull();
		expect((await centres(s.admin)).find((c) => c.name === 'North Campus')!.engineer).toBeNull();
		expect((await set(s.admin, north, arjun.id)).type).toBe('success');
		expect((await centres(s.admin)).find((c) => c.name === 'North Campus')!.engineer).toBe('Arjun Rao');
		expect(await db().auditLog.findFirst({ where: { action: 'Centre Engineer Set', entityId: north } })).toBeTruthy();
	});

	it('must be an active engineer', async () => {
		const priya = await db().user.findFirstOrThrow({ where: { email: 'priya.nair@neurodash.care' } });
		expect((await set(s.admin, await northId(), priya.id)).type).toBe('failure');
		expect((await set(s.admin, await northId(), 'nope')).type).toBe('failure');
		expect((await set(s.admin, 'nope', '')).status).toBe(404);
	});

	it('is admin-only', async () => {
		for (const who of ['priya', 'vikram', 'arjun'] as const) expect((await set(s[who], await northId(), '')).status, who).toBe(403);
	});
});
