import { beforeAll, describe, expect, it } from 'vitest';
import { PDF, PNG, createPatient, db, signInAll, uniq, type Sessions } from './helpers';

let s: Sessions;
beforeAll(async () => {
	s = await signInAll();
});

describe('creating a patient', () => {
	it('makes the creating therapist the primary therapist, with the hospital ID as its label and Active status', async () => {
		const code = uniq('Created');
		const id = await createPatient(s.priya, code);
		const p = await db().patient.findUniqueOrThrow({ where: { id }, include: { therapist: true } });
		expect(p).toMatchObject({ displayCode: code, name: code, status: 'Active', affectedSide: 'Left', gender: 'Female' });
		expect(p.dob?.toISOString().slice(0, 10)).toBe('1970-01-01');
		expect(p.therapist.email).toBe('priya.nair@neurodash.care');
		const audit = await db().auditLog.findFirst({ where: { action: 'Patient Created', entityId: id } });
		expect(audit?.actorRole).toBe('THERAPIST');
	});

	it('needs only ID, date of birth, gender and affected side (stroke date is optional)', async () => {
		const ok = await s.priya.action('/patients/new', { patientId: uniq('Min'), dob: '1980-05-05', gender: 'Male', affectedSide: 'Right', strokeDate: '2026-06-01' });
		expect(ok.type).toBe('redirect');
		for (const missing of ['patientId', 'dob', 'gender', 'affectedSide']) {
			const f: Record<string, string> = { patientId: uniq('Req'), dob: '1980-05-05', gender: 'Male', affectedSide: 'Right' };
			delete f[missing];
			const r = await s.priya.action('/patients/new', f);
			expect(r.type, missing).toBe('failure');
			expect(r.status, missing).toBe(400);
		}
	});

	it('rejects an impossible or future date of birth', async () => {
		for (const dob of ['not-a-date', '2999-01-01']) {
			const r = await s.priya.action('/patients/new', { patientId: uniq('Bad'), dob, gender: 'Female', affectedSide: 'Left' });
			expect(r.type, dob).toBe('failure');
		}
	});

	it('only therapists can create patients', async () => {
		for (const who of ['vikram', 'arjun', 'admin'] as const) {
			expect((await s[who].action('/patients/new', { patientId: uniq('No') })).status, who).toBe(403);
		}
		expect((await s.anon.action('/patients/new', { patientId: uniq('No') })).status).toBe(302);
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
		expect(audit?.previousValue).toBe('Active');
		expect(audit?.newValue).toBe('Paused');
	});

	it('rejects values that are not a known status', async () => {
		const id = await createPatient(s.priya);
		expect((await s.priya.action(`/patients/${id}?/setStatus`, { status: 'Banana' })).type).toBe('failure');
		expect((await s.priya.action(`/patients/${id}?/setStatus`, { status: '' })).type).toBe('failure');
		expect((await db().patient.findUniqueOrThrow({ where: { id } })).status).toBe('Active');
	});

	it('a consultant (read-only) cannot change it', async () => {
		const id = await createPatient(s.priya);
		expect((await s.vikram.action(`/patients/${id}?/setStatus`, { status: 'Paused' })).status).toBe(403);
		expect((await db().patient.findUniqueOrThrow({ where: { id } })).status).toBe('Active');
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
