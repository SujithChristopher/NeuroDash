import { beforeAll, describe, expect, it } from 'vitest';
import { PDF, PNG, createPatient, db, signInAll, uniq, type Sessions } from './helpers';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});

describe('creating a patient', () => {
	it('makes the creating therapist the primary therapist, with a generated code and pending status', async () => {
		const name = uniq('Created');
		const id = await createPatient(s.priya, name);
		const p = await db().patient.findUniqueOrThrow({ where: { id }, include: { therapist: true } });
		expect(p.displayCode).toMatch(/^P-\d{5}$/);
		expect(p.status).toBe('Assessment Pending');
		expect(p.therapist.email).toBe('priya.nair@neurodash.care');
		expect(p.therapyGoals).toEqual(['Improve grasp']);
		const audit = await db().auditLog.findFirst({ where: { action: 'Patient Created', entityId: id } });
		expect(audit?.actorRole).toBe('THERAPIST');
	});

	it('requires a name', async () => {
		const r = await s.priya.action('/patients/new', { name: '   ' });
		expect(r.type).toBe('failure');
		expect(r.status).toBe(400);
	});

	it('rejects an impossible date of birth', async () => {
		const r = await s.priya.action('/patients/new', { name: uniq('Bad'), dob: 'not-a-date' });
		expect(r.type).toBe('failure');
	});

	it('generates distinct codes for many patients', async () => {
		const ids = await Promise.all(Array.from({ length: 6 }, () => createPatient(s.priya)));
		const codes = (await db().patient.findMany({ where: { id: { in: ids } } })).map((p) => p.displayCode);
		expect(new Set(codes).size).toBe(6);
	});

	it('only therapists can create patients', async () => {
		for (const who of ['vikram', 'arjun', 'admin'] as const) {
			expect((await s[who].action('/patients/new', { name: uniq('No') })).status, who).toBe(403);
		}
		expect((await s.anon.action('/patients/new', { name: uniq('No') })).status).toBe(302);
	});

	it('stores attached documents as real, type-checked files', async () => {
		const name = uniq('WithDocs');
		const r = await s.priya.action('/patients/new', { name, documents: [PDF('referral'), PNG()] });
		expect(r.type).toBe('redirect');
		const p = await db().patient.findFirstOrThrow({ where: { name }, include: { documents: true } });
		expect(p.documents.map((d) => d.mimeType).sort()).toEqual(['application/pdf', 'image/png']);
		expect(p.documents.every((d) => d.data && d.data.length > 0)).toBe(true);
	});

	it('refuses the whole registration if an attachment is not a real PDF/image', async () => {
		const name = uniq('BadDoc');
		const r = await s.priya.action('/patients/new', { name, documents: [new File(['<html>x</html>'], 'x.pdf')] });
		expect(r.type).toBe('failure');
		expect(await db().patient.count({ where: { name } })).toBe(0);
	});
});

describe('location scoping', () => {
	let id: string;
	let name: string;
	beforeAll(async () => {
		name = uniq('Scoped');
		id = await createPatient(s.priya, name);
	});

	it('the colleague at the same location and the consultant can open the patient', async () => {
		expect((await s.priya.get(`/patients/${id}`)).status).toBe(200);
		expect((await s.vikram.get(`/patients/${id}`)).status).toBe(200);
	});

	it('admin sees every location', async () => {
		expect((await s.admin.get(`/patients/${id}`)).status).toBe(200);
	});

	it('a therapist at another location gets a 404, not a 403 (no existence leak)', async () => {
		expect((await s.rohan.get(`/patients/${id}`)).status).toBe(404);
	});

	it('the patient list is filtered by location', async () => {
		expect(await (await s.priya.get('/patients')).text()).toContain(name);
		expect(await (await s.vikram.get('/patients')).text()).toContain(name);
		expect(await (await s.rohan.get('/patients')).text()).not.toContain(name);
		expect(await (await s.admin.get('/patients')).text()).toContain(name);
	});

	it('every patient-linked list is location-scoped too (assessments, plans, sessions)', async () => {
		for (const path of ['/assessments', '/plans', '/sessions']) {
			const html = await (await s.rohan.get(path)).text();
			expect(html, path).not.toContain('Ananya R.');
			expect(await (await s.priya.get(path)).text(), path).toContain('Ananya R.');
		}
	});

	it('writes are scoped as well: another location cannot touch the patient', async () => {
		expect((await s.rohan.action(`/patients/${id}?/addNote`, { text: 'hello' })).status).toBe(404);
		expect((await s.rohan.action(`/patients/${id}?/setStatus`, { status: 'Paused' })).status).toBe(404);
		expect((await s.rohan.action(`/patients/${id}?/requestDevice`, { deviceTypeId: 'PLUTO' })).status).toBe(404);
	});

	it('a colleague therapist at the same location may read but not change the primary therapist’s status', async () => {
		const { createUser, downtownId } = await import('./helpers');
		const colleague = await createUser(s.admin, { role: 'THERAPIST', locationId: await downtownId() });
		expect((await colleague.client.get(`/patients/${id}`)).status).toBe(200);
		expect((await colleague.client.action(`/patients/${id}?/setStatus`, { status: 'Paused' })).status).toBe(403);
	});
});

describe('patient status', () => {
	it('the primary therapist can change it and it is audited with before/after', async () => {
		const id = await createPatient(s.priya);
		const r = await s.priya.action(`/patients/${id}?/setStatus`, { status: 'Paused' });
		expect(r.type).toBe('success');
		expect((await db().patient.findUniqueOrThrow({ where: { id } })).status).toBe('Paused');
		const audit = await db().auditLog.findFirst({ where: { action: 'Patient Status Changed', entityId: id } });
		expect(audit?.previousValue).toBe('Assessment Pending');
		expect(audit?.newValue).toBe('Paused');
	});

	it('rejects values that are not a known status', async () => {
		const id = await createPatient(s.priya);
		expect((await s.priya.action(`/patients/${id}?/setStatus`, { status: 'Banana' })).type).toBe('failure');
		expect((await s.priya.action(`/patients/${id}?/setStatus`, { status: '' })).type).toBe('failure');
		expect((await db().patient.findUniqueOrThrow({ where: { id } })).status).toBe('Assessment Pending');
	});

	it('a consultant (read-only) cannot change it', async () => {
		const id = await createPatient(s.priya);
		expect((await s.vikram.action(`/patients/${id}?/setStatus`, { status: 'Paused' })).status).toBe(403);
		expect((await db().patient.findUniqueOrThrow({ where: { id } })).status).toBe('Assessment Pending');
	});
});

describe('patient notes', () => {
	let id: string;
	beforeAll(async () => {
		id = await createPatient(s.priya);
	});

	it('therapist, consultant and admin can add notes; engineer cannot', async () => {
		expect((await s.priya.action(`/patients/${id}?/addNote`, { text: 'Therapist note' })).type).toBe('success');
		expect((await s.vikram.action(`/patients/${id}?/addNote`, { text: 'Consultant note' })).type).toBe('success');
		expect((await s.admin.action(`/patients/${id}?/addNote`, { text: 'Admin note' })).type).toBe('success');
		expect((await s.arjun.action(`/patients/${id}?/addNote`, { text: 'Engineer note' })).status).toBe(403);
		const notes = await db().patientNote.findMany({ where: { patientId: id }, include: { author: true } });
		expect(notes.map((n) => n.author.email).sort()).toEqual([
			'biorehabilitationgroup@gmail.com',
			'priya.nair@neurodash.care',
			'vikram.suresh@neurodash.care'
		]);
	});

	it('rejects empty and oversized notes', async () => {
		expect((await s.priya.action(`/patients/${id}?/addNote`, { text: '   ' })).type).toBe('failure');
		expect((await s.priya.action(`/patients/${id}?/addNote`, { text: 'x'.repeat(4001) })).type).toBe('failure');
	});

	it('stores note text verbatim (no HTML interpretation server-side)', async () => {
		const evil = '<img src=x onerror=alert(1)>';
		await s.priya.action(`/patients/${id}?/addNote`, { text: evil });
		expect((await db().patientNote.findFirstOrThrow({ where: { patientId: id, text: evil } })).text).toBe(evil);
	});
});

describe('documents: upload, download, access control', () => {
	let id: string;
	let docId: string;
	beforeAll(async () => {
		id = await createPatient(s.priya);
		const r = await s.priya.action(`/patients/${id}?/addDocument`, { document: PDF('mri-report') });
		expect(r.type).toBe('success');
		docId = (await db().patientDocument.findFirstOrThrow({ where: { patientId: id } })).id;
	});

	it('the primary therapist uploads; the file is stored with size and type', async () => {
		const d = await db().patientDocument.findUniqueOrThrow({ where: { id: docId } });
		expect(d.mimeType).toBe('application/pdf');
		expect(d.docType).toBe('PDF');
		expect(d.sizeKb).toBe(1);
		expect(Buffer.from(d.data!).toString().startsWith('%PDF-')).toBe(true);
	});

	it('rejects a file whose bytes are not a PDF/image, whatever its name or declared type', async () => {
		const html = new File(['<script>alert(1)</script>'], 'scan.pdf', { type: 'application/pdf' });
		expect((await s.priya.action(`/patients/${id}?/addDocument`, { document: html })).type).toBe('failure');
		const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'logo.png', { type: 'image/png' });
		expect((await s.priya.action(`/patients/${id}?/addDocument`, { document: svg })).type).toBe('failure');
		expect(await db().patientDocument.count({ where: { patientId: id } })).toBe(1);
	});

	it('rejects files over 10 MB', async () => {
		const big = new Uint8Array(10 * 1024 * 1024 + 1);
		big.set(new TextEncoder().encode('%PDF-'));
		const r = await s.priya.action(`/patients/${id}?/addDocument`, { document: new File([big], 'huge.pdf') });
		expect(r.type).toBe('failure');
	});

	it('rejects an upload with no file', async () => {
		expect((await s.priya.action(`/patients/${id}?/addDocument`, {})).type).toBe('failure');
	});

	it('only the primary therapist may upload', async () => {
		for (const who of ['vikram', 'admin', 'arjun'] as const) {
			expect((await s[who].action(`/patients/${id}?/addDocument`, { document: PDF() })).status, who).toBe(403);
		}
		expect((await s.rohan.action(`/patients/${id}?/addDocument`, { document: PDF() })).status).toBe(404);
	});

	it('serves the file with safe headers to people who can see the patient', async () => {
		for (const who of ['priya', 'vikram', 'admin'] as const) {
			const res = await s[who].get(`/api/documents/${docId}`);
			expect(res.status, who).toBe(200);
			expect(res.headers.get('content-type')).toBe('application/pdf');
			expect(res.headers.get('x-content-type-options')).toBe('nosniff');
			expect(res.headers.get('content-security-policy')).toContain('sandbox');
			expect(res.headers.get('cache-control')).toContain('no-store');
			expect((await res.text()).startsWith('%PDF-')).toBe(true);
		}
		const dl = await s.priya.get(`/api/documents/${docId}?download=1`);
		expect(dl.headers.get('content-disposition')).toMatch(/^attachment; filename="mri-report\.pdf"/);
	});

	it('hides the file from other locations (404) and from engineers (403), and from the signed-out', async () => {
		expect((await s.rohan.get(`/api/documents/${docId}`)).status).toBe(404);
		expect((await s.arjun.get(`/api/documents/${docId}`)).status).toBe(403);
		expect((await s.anon.get(`/api/documents/${docId}`)).status).toBe(401);
		expect((await s.priya.get('/api/documents/00000000-0000-0000-0000-000000000000')).status).toBe(404);
	});

	it('records who viewed a clinical document', async () => {
		await s.vikram.get(`/api/documents/${docId}`);
		const view = await db().auditLog.findFirst({ where: { action: 'Document Viewed', entityId: docId, actorRole: 'CONSULTANT' } });
		expect(view).toBeTruthy();
	});

	it('never ships file bytes inside the patient page payload', async () => {
		const html = await (await s.priya.get(`/patients/${id}?tab=documents`)).text();
		expect(html).toContain('mri-report.pdf');
		expect(html).not.toContain('%PDF-1.4');
	});
});
