import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPatient, db, pageData, signInAll, uniq, type Client, type Sessions } from './helpers';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});
const ROOT = () => process.env.TEST_DATA_DIR!;

const save = (c: Client, patientId: string, notes: unknown = {}, title = '') =>
	c.action<{ message?: string; error?: string; savedId?: string }>('/reports?/saveReport', { patientId, title, notes: JSON.stringify(notes) });

describe('the patient report content', () => {
	it('lists the devices used with time and movements, and one series per scored scale with its change', async () => {
		const p = await db().patient.findFirstOrThrow({ where: { displayCode: 'P-10124' } });
		const d = await pageData(s.priya, `/reports?view=patient&patient=${p.id}`);
		const rep = d.patientReport;
		expect(rep.devices.map((x: { typeId: string }) => x.typeId).sort()).toEqual(expect.arrayContaining(['MARS', 'PLUTO']));
		for (const dev of rep.devices) {
			expect(dev.minutes).toBeGreaterThan(0);
			expect(dev).toHaveProperty('movements');
		}
		expect(rep.scales.length).toBeGreaterThan(0);
		expect(rep.scales[0].points.length).toBeGreaterThanOrEqual(2);
		expect(rep.scales[0].change).toMatchObject({ direction: expect.stringMatching(/improved|declined|unchanged/) });
		for (const gone of ['avgAccuracy', 'totalStars']) expect(JSON.stringify(rep)).not.toContain(gone);
		expect(rep.patient).not.toHaveProperty('name');
	});

	it('shows several scales as several series', async () => {
		const id = await createPatient(s.priya, uniq('multi').slice(0, 20));
		const priya = await db().user.findFirstOrThrow({ where: { email: 'priya.nair@neurodash.care' } });
		for (const [scaleId, score, max, date] of [['fma', 20, 66, '2026-08-01'], ['fma', 40, 66, '2026-09-01'], ['arat', 10, 57, '2026-08-02'], ['arat', 30, 57, '2026-09-02']] as const) {
			await db().assessment.create({
				data: { patientId: id, scaleId, assessmentDate: new Date(date), score, maxScore: max, administeredById: priya.id, answers: {} }
			});
		}
		const rep = (await pageData(s.priya, `/reports?view=patient&patient=${id}`)).patientReport;
		expect(rep.scales.map((x: { scaleId: string }) => x.scaleId)).toEqual(['fma', 'arat']);
		expect(rep.scales.every((x: { change: { direction: string } }) => x.change.direction === 'improved')).toBe(true);
	});
});

describe('choosing the period', () => {
	it('narrows the report and its session list to the dates, and ignores bad dates', async () => {
		const p = await db().patient.findFirstOrThrow({ where: { displayCode: 'P-10124' } });
		const all = await pageData(s.priya, `/reports?view=patient&patient=${p.id}`);
		expect(all.patientReport.period).toBeNull();
		const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
		const recent = await pageData(s.priya, `/reports?view=patient&patient=${p.id}&from=${day(7)}&to=${day(0)}`);
		expect(recent.patientReport.period).toEqual({ from: day(7), to: day(0) });
		expect(recent.patientReport.totals.sessions).toBeLessThan(all.patientReport.totals.sessions);
		expect(recent.patientReport.totals.sessions).toBeGreaterThan(0);
		expect(recent.sessions.every((x: { date: string }) => x.date >= day(7) && x.date <= day(0))).toBe(true);
		expect(recent.sessions.length).toBe(recent.patientReport.totals.sessions);
		const bad = await pageData(s.priya, `/reports?view=patient&patient=${p.id}&from=garbage&to=2999-99-99`);
		expect(bad.patientReport.period).toBeNull();
		expect(bad.patientReport.totals.sessions).toBe(all.patientReport.totals.sessions);
	});

	it('is saved with the report, and the title says which period it covers', async () => {
		const pid = await createPatient(s.priya, uniq('per').slice(0, 20));
		const r = await s.priya.action<{ savedId?: string }>('/reports?/saveReport', { patientId: pid, notes: '{}', from: '2026-09-01', to: '2026-09-30' });
		expect(r.type).toBe('success');
		const row = await db().patientReport.findUniqueOrThrow({ where: { id: r.data!.savedId! } });
		expect(row.title).toContain('2026-09-01 to 2026-09-30');
		const saved = await pageData(s.priya, `/reports/saved/${row.id}`);
		expect(saved.report.period).toEqual({ from: '2026-09-01', to: '2026-09-30' });
	});
});

describe('saving a report with notes', () => {
	let pid: string;
	let code: string;
	beforeAll(async () => {
		code = uniq('rep').slice(0, 20);
		pid = await createPatient(s.priya, code);
	});

	it('writes a snapshot file with the notes to the local server and indexes it', async () => {
		const r = await save(s.priya, pid, { summary: '  Good progress. ', devices: 'Mostly MARS', scales: { fma: 'ignored: no such scale here' } }, '4-week review');
		expect(r.type).toBe('success');
		const id = r.data!.savedId!;
		const row = await db().patientReport.findUniqueOrThrow({ where: { id }, include: { createdBy: true } });
		expect([row.title, row.storage, row.storageKey, row.createdBy.email]).toEqual(['4-week review', 'local', `${code}/${id}.json`, 'priya.nair@neurodash.care']);

		const snap = JSON.parse(fs.readFileSync(path.join(ROOT(), '_reports', code, `${id}.json`), 'utf8'));
		expect(snap.notes).toEqual({ summary: 'Good progress.', devices: 'Mostly MARS', scales: {} });
		expect(snap.savedBy).toMatchObject({ role: 'THERAPIST' });
		expect(snap.report.patient.displayCode).toBe(code);
		expect(await db().auditLog.findFirst({ where: { action: 'Report Saved', entityId: id } })).toBeTruthy();
	});

	it('is listed for that patient and defaults the title', async () => {
		await save(s.priya, pid, {});
		const rows = (await pageData(s.priya, `/reports?view=patient&patient=${pid}`)).savedReports as { title: string }[];
		expect(rows.length).toBeGreaterThanOrEqual(2);
		expect(rows.some((x) => /^Report \d{4}-\d{2}-\d{2}$/.test(x.title))).toBe(true);
	});

	it('takes only the notes from the browser: the data is rebuilt on the server', async () => {
		const r = await save(s.priya, pid, { summary: 'x', report: { totals: { minutes: 99999 } }, patient: { name: 'Evil' } });
		const snap = JSON.parse(fs.readFileSync(path.join(ROOT(), '_reports', code, `${r.data!.savedId}.json`), 'utf8'));
		expect(snap.report.totals.minutes).toBe(0);
		expect(JSON.stringify(snap)).not.toContain('Evil');
	});

	it('rejects unreadable notes and unknown patients', async () => {
		expect((await s.priya.action('/reports?/saveReport', { patientId: pid, notes: 'not json' })).type).toBe('failure');
		expect((await save(s.priya, '00000000-0000-0000-0000-000000000000')).status).toBe(404);
	});

	it('therapists and consultants may save; admin and engineers may not; other centres get 404', async () => {
		expect((await save(s.vikram, pid, { summary: 'consultant note' })).type).toBe('success');
		expect((await save(s.admin, pid)).status).toBe(403);
		expect((await save(s.arjun, pid)).status).toBe(403);
		expect((await save(s.rohan, pid)).status).toBe(404);
		expect((await save(s.anon, pid)).status).toBe(302);
	});

	it('a saved report reopens exactly as saved, for anyone who can see the patient, and nobody else', async () => {
		const r = await save(s.priya, pid, { summary: 'Keep this wording' }, 'Reopen me');
		const id = r.data!.savedId!;
		for (const who of ['priya', 'vikram', 'admin'] as const) {
			const d = await pageData(s[who], `/reports/saved/${id}`);
			expect(d.title, who).toBe('Reopen me');
			expect(d.notes.summary, who).toBe('Keep this wording');
			expect(d.report.patient.displayCode, who).toBe(code);
		}
		expect((await s.rohan.get(`/reports/saved/${id}`)).status).toBe(404);
		expect((await s.arjun.get(`/reports/saved/${id}`)).status).toBe(403);
		expect((await s.priya.get(`/reports/saved/${id}`)).status).toBe(200);
		expect((await s.priya.get('/reports/saved/00000000-0000-0000-0000-000000000000')).status).toBe(404);
	});

	it('says so when the stored file has gone missing', async () => {
		const r = await save(s.priya, pid, {}, 'Soon gone');
		fs.rmSync(path.join(ROOT(), '_reports', code, `${r.data!.savedId}.json`));
		expect((await s.priya.get(`/reports/saved/${r.data!.savedId}`)).status).toBe(404);
	});
});
