import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDF, createPatient, createUser, db, downtownId, northId, signInAll, type Sessions } from './helpers';
import { allItems, answerableItems } from '../../src/lib/scales/evaluate';
import type { ScaleDef } from '../../src/lib/scales/types';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});

const scale = (id: string) => JSON.parse(readFileSync(join(process.cwd(), 'clinical_scales', 'neuro', `${id}.json`), 'utf8')) as ScaleDef;
const tomorrow = () => new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);

/** Answers every single-choice item in `ids` (or all) with `pick(item)`. */
function answers(def: ScaleDef, pick: (choices: number[]) => number, only?: (id: string) => boolean) {
	const out: Record<string, number> = {};
	for (const it of answerableItems(def)) {
		if (it.type !== 'single_choice' || (only && !only(it.id))) continue;
		const nums = (it.choices ?? []).map((c) => c.value).filter((v): v is number => typeof v === 'number');
		if (nums.length) out[it.id] = pick(nums);
	}
	return out;
}

const submit = (client: typeof s.priya, patientId: string, fields: Record<string, string | Blob | (string | Blob)[]>) =>
	client.action(`/assessments/new?patient=${patientId}`, { assessmentDate: '2026-09-01', label: 'Baseline', ...fields });

const phq9 = scale('phq9');
const PHQ_SCORED = (id: string) => (allItems(phq9).find((i) => i.id === 'phq9_total_score')!.expr ?? '').includes(id);

describe('the assessment screen', () => {
	it('lists every real scale (and not the bookkeeping forms) for the primary therapist', async () => {
		const id = await createPatient(s.priya);
		const html = await (await s.priya.get(`/assessments/new?patient=${id}`)).text();
		for (const title of ['Patient Health Questionnaire', 'Fugl-Meyer', 'Action Research Arm Test', 'Box and Block Test']) {
			expect(html, title).toContain(title);
		}
		expect(html).not.toContain('Consent Form');
		expect(html).not.toContain('Completed Screening');
	});

	it('renders the chosen scale from its JSON definition', async () => {
		const id = await createPatient(s.priya);
		const res = await s.priya.get(`/assessments/new?patient=${id}&scale=phq9`);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('phq9_total_score');
	});

	it('needs a patient, and only the primary therapist may open it', async () => {
		expect((await s.priya.get('/assessments/new')).status).toBe(400);
		const id = await createPatient(s.priya);
		expect((await s.vikram.get(`/assessments/new?patient=${id}`)).status).toBe(403);
		expect((await s.admin.get(`/assessments/new?patient=${id}`)).status).toBe(403);
		expect((await s.arjun.get(`/assessments/new?patient=${id}`)).status).toBe(403);
		expect((await s.rohan.get(`/assessments/new?patient=${id}`)).status).toBe(404);
		const colleague = await createUser(s.admin, { role: 'THERAPIST', locationId: await downtownId() });
		expect((await colleague.client.get(`/assessments/new?patient=${id}`)).status).toBe(403);
	});
});

describe('recording a scored assessment (PHQ-9)', () => {
	it('recomputes the score from the answers and ignores any score the client sends', async () => {
		const id = await createPatient(s.priya);
		const a = answers(phq9, () => 1, PHQ_SCORED);
		const r = await submit(s.priya, id, { scaleId: 'phq9', answers: JSON.stringify(a), score: '999', maxScore: '1' });
		expect(r.type).toBe('redirect');
		expect(r.location).toBe(`/patients/${id}?tab=assessments`);

		const row = await db().assessment.findFirstOrThrow({ where: { patientId: id } });
		expect(row.scaleId).toBe('phq9');
		expect(row.scaleVersion).toBe(1);
		expect(row.scoreItem).toBe('phq9_total_score');
		expect(row.score).toBe(9);
		expect(row.maxScore).toBe(27);
		expect(row.label).toBe('Baseline');
		expect(row.assessmentDate.toISOString().slice(0, 10)).toBe('2026-09-01');
		// REDCap parity: the scale's own date item carries the assessment date.
		const dateItem = allItems(phq9).find((i) => i.type === 'date')!;
		expect((row.answers as Record<string, unknown>)[dateItem.id]).toBe('2026-09-01');
	});

	it('scores varied answers correctly and leaves the score empty until every scored item is answered', async () => {
		const id = await createPatient(s.priya);
		const ids = Object.keys(answers(phq9, () => 0, PHQ_SCORED));
		const varied = Object.fromEntries(ids.map((k, i) => [k, i % 4]));
		await submit(s.priya, id, { scaleId: 'phq9', answers: JSON.stringify(varied) });
		const total = ids.reduce((sum, _k, i) => sum + (i % 4), 0);
		expect((await db().assessment.findFirstOrThrow({ where: { patientId: id } })).score).toBe(total);

		const partial = await createPatient(s.priya);
		await submit(s.priya, partial, { scaleId: 'phq9', answers: JSON.stringify({ [ids[0]]: 2 }) });
		const row = await db().assessment.findFirstOrThrow({ where: { patientId: partial } });
		expect(row.score).toBeNull(); // REDCap semantics: blank in, blank out
		expect(row.maxScore).toBe(27);
	});

	it('moves an Assessment-Pending patient to Active, but leaves other statuses alone', async () => {
		const pending = await createPatient(s.priya);
		await submit(s.priya, pending, { scaleId: 'phq9', answers: JSON.stringify(answers(phq9, () => 0, PHQ_SCORED)) });
		expect((await db().patient.findUniqueOrThrow({ where: { id: pending } })).status).toBe('Active');

		const paused = await createPatient(s.priya);
		await s.priya.action(`/patients/${paused}?/setStatus`, { status: 'Paused' });
		await submit(s.priya, paused, { scaleId: 'phq9', answers: JSON.stringify(answers(phq9, () => 0, PHQ_SCORED)) });
		expect((await db().patient.findUniqueOrThrow({ where: { id: paused } })).status).toBe('Paused');
	});

	it('audits the creation', async () => {
		const id = await createPatient(s.priya);
		await submit(s.priya, id, { scaleId: 'phq9', answers: JSON.stringify(answers(phq9, () => 1, PHQ_SCORED)) });
		const row = await db().assessment.findFirstOrThrow({ where: { patientId: id } });
		const audit = await db().auditLog.findFirstOrThrow({ where: { action: 'Assessment Created', entityId: row.id } });
		expect(audit.newValue).toBe('phq9 9/27');
	});
});

describe('validation: the server never trusts the client', () => {
	let id: string;
	const firstId = Object.keys(answers(phq9, () => 0, PHQ_SCORED))[0];
	beforeAll(async () => {
		id = await createPatient(s.priya);
	});
	const count = () => db().assessment.count({ where: { patientId: id } });

	it.each([
		['a value outside the closed set', { [firstId]: 99 }],
		['a value of the wrong kind', { [firstId]: 'high' }],
		['several values for a single-choice item', { [firstId]: [1, 2] }],
		['an unknown item', { not_an_item: 1 }],
		['a computed (auto-scored) item', { phq9_total_score: 27 }]
	])('rejects %s', async (_label, bad) => {
		const r = await submit(s.priya, id, { scaleId: 'phq9', answers: JSON.stringify(bad) });
		expect(r.type).toBe('failure');
		expect(r.status).toBe(400);
		expect(await count()).toBe(0);
	});

	it('names the offending item so the screen can jump to it', async () => {
		const r = await submit(s.priya, id, { scaleId: 'phq9', answers: JSON.stringify({ [firstId]: 99 }) });
		expect(r.data?.itemId).toBe(firstId);
	});

	it('rejects empty, malformed and non-object answers', async () => {
		for (const a of ['{}', 'not json', '[1,2]', 'null', '"x"']) {
			const r = await submit(s.priya, id, { scaleId: 'phq9', answers: a });
			expect(r.type, a).toBe('failure');
		}
		expect(await count()).toBe(0);
	});

	it('rejects unknown and non-assessment scales', async () => {
		const good = JSON.stringify({ [firstId]: 1 });
		expect((await submit(s.priya, id, { scaleId: 'nope', answers: good })).type).toBe('failure');
		expect((await submit(s.priya, id, { scaleId: 'consent_form', answers: good })).type).toBe('failure'); // bookkeeping
		expect((await submit(s.priya, id, { scaleId: '../../etc/passwd', answers: good })).type).toBe('failure');
		expect(await count()).toBe(0);
	});

	it('rejects a future date, an invalid date and an unknown timepoint', async () => {
		const good = JSON.stringify({ [firstId]: 1 });
		expect((await submit(s.priya, id, { scaleId: 'phq9', answers: good, assessmentDate: tomorrow() })).type).toBe('failure');
		expect((await submit(s.priya, id, { scaleId: 'phq9', answers: good, assessmentDate: 'yesterday' })).type).toBe('failure');
		expect((await submit(s.priya, id, { scaleId: 'phq9', answers: good, label: 'Whenever' })).type).toBe('failure');
		expect(await count()).toBe(0);
	});

	it('rejects answers to items that are hidden by a showIf rule (NIHSS "UN" follow-ups)', async () => {
		const nihss = scale('nihss');
		const gated = allItems(nihss).find((i) => i.showIf && i.type === 'single_choice');
		if (!gated) return; // definition has no answerable gated item: nothing to assert
		const driver = /(\w+)\s*=\s*'([^']*)'/.exec(gated.showIf!)!;
		const a = { [driver[1]]: 1, [gated.id]: (gated.choices ?? [])[0]?.value };
		const r = await submit(s.priya, id, { scaleId: 'nihss', answers: JSON.stringify(a) });
		expect(r.type).toBe('failure');
	});

	it('rejects free text in place of a stepper number and keeps steppers in range', async () => {
		const eq = scale('eq5d');
		expect((await submit(s.priya, id, { scaleId: 'eq5d', answers: JSON.stringify({ eq5d_vas: 101 }) })).type).toBe('failure');
		expect((await submit(s.priya, id, { scaleId: 'eq5d', answers: JSON.stringify({ eq5d_vas: 'fifty' }) })).type).toBe('failure');
		expect((await submit(s.priya, id, { scaleId: 'eq5d', answers: JSON.stringify({ eq5d_vas: -1 }) })).type).toBe('failure');
		void eq;
		expect(await count()).toBe(0);
		expect((await submit(s.priya, id, { scaleId: 'eq5d', answers: JSON.stringify({ eq5d_vas: 100 }) })).type).toBe('redirect');
	});
});

describe('other scales', () => {
	it('FMA: headline score is the motor total with a 66-point maximum', async () => {
		const fma = scale('fma');
		const id = await createPatient(s.priya);
		const a = answers(fma, (n) => Math.max(...n));
		await submit(s.priya, id, { scaleId: 'fma', answers: JSON.stringify(a) });
		const row = await db().assessment.findFirstOrThrow({ where: { patientId: id } });
		expect(row.scoreItem).toBe('fma_ue_total_motor');
		expect(row.maxScore).toBe(66);
		expect(row.score).toBe(66);
	});

	it('ARAT: scores the patient’s affected side', async () => {
		const arat = scale('arat');
		const left = await createPatient(s.priya); // created with affectedSide = Left
		const right = await createPatient(s.priya);
		await db().patient.update({ where: { id: right }, data: { affectedSide: 'Right' } });

		await submit(s.priya, left, { scaleId: 'arat', answers: JSON.stringify(answers(arat, (n) => Math.max(...n), (k) => k.endsWith('_l'))) });
		await submit(s.priya, right, { scaleId: 'arat', answers: JSON.stringify(answers(arat, (n) => Math.max(...n), (k) => k.endsWith('_r'))) });

		const l = await db().assessment.findFirstOrThrow({ where: { patientId: left } });
		const r = await db().assessment.findFirstOrThrow({ where: { patientId: right } });
		expect([l.scoreItem, l.score, l.maxScore]).toEqual(['arat_total_l', 57, 57]);
		expect([r.scoreItem, r.score, r.maxScore]).toEqual(['arat_total_r', 57, 57]);
	});

	it('Box & Block: a scale with no total is stored with no score', async () => {
		const id = await createPatient(s.priya);
		const r = await submit(s.priya, id, { scaleId: 'bbt', answers: JSON.stringify({ bnb_left_trial_1: 57, bnb_right_trial_1: 40 }) });
		expect(r.type).toBe('redirect');
		const row = await db().assessment.findFirstOrThrow({ where: { patientId: id } });
		expect(row.score).toBeNull();
		expect(row.maxScore).toBeNull();
		expect(row.scoreItem).toBeNull();
		expect((row.answers as Record<string, unknown>).bnb_left_trial_1).toBe(57);
		expect((await submit(s.priya, id, { scaleId: 'bbt', answers: JSON.stringify({ bnb_left_trial_1: 301 }) })).type).toBe('failure');
	});

	it('MAL (130 items): accepts a large answer set', async () => {
		const mal = scale('mal');
		const id = await createPatient(s.priya);
		const a = answers(mal, (n) => n[Math.min(2, n.length - 1)]);
		expect(Object.keys(a).length).toBeGreaterThan(60);
		const r = await submit(s.priya, id, { scaleId: 'mal', answers: JSON.stringify(a) });
		expect(r.type).toBe('redirect');
	});
});

describe('examiner', () => {
	it('defaults to the signed-in therapist and can be another therapist at the same location', async () => {
		const id = await createPatient(s.priya);
		const colleague = await createUser(s.admin, { role: 'THERAPIST', locationId: await downtownId() });
		const colleagueId = (await db().user.findUniqueOrThrow({ where: { email: colleague.email } })).id;
		const a = JSON.stringify(answers(phq9, () => 0, PHQ_SCORED));

		await submit(s.priya, id, { scaleId: 'phq9', answers: a });
		await submit(s.priya, id, { scaleId: 'phq9', answers: a, examinerId: colleagueId, label: 'Day 7' });
		const rows = await db().assessment.findMany({ where: { patientId: id }, include: { administeredBy: true }, orderBy: { createdAt: 'asc' } });
		expect(rows.map((r) => r.administeredBy?.email)).toEqual(['priya.nair@neurodash.care', colleague.email]);
	});

	it('cannot be a therapist at another location, a consultant, or an invented id', async () => {
		const id = await createPatient(s.priya);
		const a = JSON.stringify(answers(phq9, () => 0, PHQ_SCORED));
		const rohan = (await db().user.findUniqueOrThrow({ where: { email: 'rohan.mehta@neurodash.care' } })).id;
		const vikram = (await db().user.findUniqueOrThrow({ where: { email: 'vikram.suresh@neurodash.care' } })).id;
		for (const examinerId of [rohan, vikram, 'not-a-user']) {
			expect((await submit(s.priya, id, { scaleId: 'phq9', answers: a, examinerId })).type, examinerId).toBe('failure');
		}
		expect(await db().assessment.count({ where: { patientId: id } })).toBe(0);
	});
});

describe('scanned documents attached to an assessment', () => {
	const a = JSON.stringify(answers(phq9, () => 1, PHQ_SCORED));

	it('are stored with the assessment and can be viewed by people who can see the patient', async () => {
		const id = await createPatient(s.priya);
		const r = await submit(s.priya, id, { scaleId: 'phq9', answers: a, scans: [PDF('sheet-1'), PDF('sheet-2')] });
		expect(r.type).toBe('redirect');

		const row = await db().assessment.findFirstOrThrow({ where: { patientId: id }, include: { documents: true } });
		expect(row.documents.map((d) => d.name).sort()).toEqual(['sheet-1.pdf', 'sheet-2.pdf']);
		expect(row.documents.every((d) => d.assessmentId === row.id && d.patientId === id && d.mimeType === 'application/pdf')).toBe(true);

		const res = await s.vikram.get(`/api/documents/${row.documents[0].id}`);
		expect(res.status).toBe(200);
		expect((await s.rohan.get(`/api/documents/${row.documents[0].id}`)).status).toBe(404);
	});

	it('are optional', async () => {
		const id = await createPatient(s.priya);
		expect((await submit(s.priya, id, { scaleId: 'phq9', answers: a })).type).toBe('redirect');
		expect(await db().patientDocument.count({ where: { patientId: id } })).toBe(0);
	});

	it('a bad scan rejects the whole submission — no half-saved assessment', async () => {
		const id = await createPatient(s.priya);
		const r = await submit(s.priya, id, { scaleId: 'phq9', answers: a, scans: [PDF('ok'), new File(['<html>'], 'fake.pdf')] });
		expect(r.type).toBe('failure');
		expect(await db().assessment.count({ where: { patientId: id } })).toBe(0);
		expect(await db().patientDocument.count({ where: { patientId: id } })).toBe(0);
	});

	it('appear in the patient’s assessment view and their Documents tab', async () => {
		const id = await createPatient(s.priya);
		await submit(s.priya, id, { scaleId: 'phq9', answers: a, scans: [PDF('phq9-sheet')] });
		expect(await (await s.priya.get(`/patients/${id}?tab=assessments`)).text()).toContain('phq9-sheet.pdf');
		expect(await (await s.priya.get(`/patients/${id}?tab=documents`)).text()).toContain('phq9-sheet.pdf');
	});
});

describe('permissions on submit', () => {
	const a = JSON.stringify(answers(phq9, () => 1, PHQ_SCORED));
	it('only the primary therapist can record an assessment', async () => {
		const id = await createPatient(s.priya);
		const colleague = await createUser(s.admin, { role: 'THERAPIST', locationId: await downtownId() });
		const north = await createUser(s.admin, { role: 'THERAPIST', locationId: await northId() });
		expect((await submit(colleague.client, id, { scaleId: 'phq9', answers: a })).status).toBe(403);
		expect((await submit(s.vikram, id, { scaleId: 'phq9', answers: a })).status).toBe(403);
		expect((await submit(s.admin, id, { scaleId: 'phq9', answers: a })).status).toBe(403);
		expect((await submit(s.arjun, id, { scaleId: 'phq9', answers: a })).status).toBe(403);
		expect((await submit(north.client, id, { scaleId: 'phq9', answers: a })).status).toBe(404);
		expect((await submit(s.anon, id, { scaleId: 'phq9', answers: a })).status).toBe(302);
		expect(await db().assessment.count({ where: { patientId: id } })).toBe(0);
	});
});

describe('reading assessments back', () => {
	it('the patient page shows labelled responses and auto-calculated scores from the definition', async () => {
		const id = await createPatient(s.priya);
		await submit(s.priya, id, { scaleId: 'phq9', answers: JSON.stringify(answers(phq9, () => 2, PHQ_SCORED)) });
		const html = await (await s.priya.get(`/patients/${id}?tab=assessments`)).text();
		expect(html).toContain(phq9.title);
		expect(html).toContain('18'); // 9 items × 2
	});

	it('the hub lists assessments only within the caller’s scope, with scan counts', async () => {
		const id = await createPatient(s.priya);
		await submit(s.priya, id, { scaleId: 'phq9', answers: JSON.stringify(answers(phq9, () => 1, PHQ_SCORED)), scans: [PDF('hub')] });
		const name = (await db().patient.findUniqueOrThrow({ where: { id } })).name;
		expect(await (await s.priya.get('/assessments')).text()).toContain(name);
		expect(await (await s.rohan.get('/assessments')).text()).not.toContain(name);
		expect(await (await s.admin.get('/assessments')).text()).toContain(name);
	});
});
