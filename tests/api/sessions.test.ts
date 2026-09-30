import { beforeAll, describe, expect, it } from 'vitest';
import { db, signInAll, type Sessions } from './helpers';

let s: Sessions;
let sessionId: string;
beforeAll(async () => {
	s = await signInAll();
	const p = await db().patient.findFirstOrThrow({ where: { displayCode: 'P-10124' } });
	sessionId = (await db().therapySession.findFirstOrThrow({ where: { patientId: p.id }, orderBy: { sessionDate: 'desc' } })).id;
});

const PNG_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('session detail', () => {
	it('returns the trial table with accuracy computed server-side', async () => {
		const res = await s.priya.get(`/api/sessions/${sessionId}`);
		expect(res.status).toBe(200);
		const d = await res.json();
		expect(d.id).toBe(sessionId);
		expect(d.device.displayCode).toMatch(/^[A-Z]+-\d{3}$/);
		expect(d.trials.length).toBeGreaterThan(0);
		expect(d.accuracyPct).toBe(d.totalTargets > 0 ? Math.round((d.totalHits / d.totalTargets) * 10000) / 100 : null);
		for (const t of d.trials) expect(t.accuracyPct).toBe(t.targets > 0 ? Math.round((t.hits / t.targets) * 10000) / 100 : null);
		expect(typeof d.durationMinutes).toBe('number'); // Decimal is serialised as a number, not a string
	});

	it('is visible to therapist, consultant and admin of the right scope only', async () => {
		expect((await s.vikram.get(`/api/sessions/${sessionId}`)).status).toBe(200);
		expect((await s.admin.get(`/api/sessions/${sessionId}`)).status).toBe(200);
		expect((await s.rohan.get(`/api/sessions/${sessionId}`)).status).toBe(404);
		expect((await s.arjun.get(`/api/sessions/${sessionId}`)).status).toBe(403);
		expect((await s.anon.get(`/api/sessions/${sessionId}`)).status).toBe(401);
		expect((await s.priya.get('/api/sessions/00000000-0000-0000-0000-000000000000')).status).toBe(404);
	});

	it('tells the UI who may add notes', async () => {
		expect((await (await s.priya.get(`/api/sessions/${sessionId}`)).json()).canAddNote).toBe(true);
		expect((await (await s.vikram.get(`/api/sessions/${sessionId}`)).json()).canAddNote).toBe(true);
		expect((await (await s.admin.get(`/api/sessions/${sessionId}`)).json()).canAddNote).toBe(false);
	});
});

describe('session notes', () => {
	const post = (c: typeof s.priya, body: unknown, id = sessionId) => c.json('POST', `/api/sessions/${id}/notes`, body);

	it('stores a text note with author and audit entry', async () => {
		const r = await post(s.priya, { text: 'Good trunk control today.' });
		expect(r.status).toBe(200);
		expect(r.body.author).toBe('Dr. Priya Nair');
		const row = await db().sessionNote.findUniqueOrThrow({ where: { id: r.body.id } });
		expect(row.sessionId).toBe(sessionId);
		expect(row.imageDataUrl).toBeNull();
		expect(await db().auditLog.findFirst({ where: { action: 'Session Note Added', entityId: r.body.id } })).toBeTruthy();
	});

	it('accepts a real image data URL and returns the note in the session detail', async () => {
		const r = await post(s.priya, { text: 'Photo of grip.', imageDataUrl: PNG_URL });
		expect(r.status).toBe(200);
		const d = await (await s.priya.get(`/api/sessions/${sessionId}`)).json();
		expect(d.notes.find((n: { id: string }) => n.id === r.body.id).imageDataUrl).toBe(PNG_URL);
	});

	it.each([
		['an SVG (script-capable)', 'data:image/svg+xml;base64,PHN2Zy8+'],
		['HTML', 'data:text/html;base64,PGh0bWw+'],
		['a non-base64 payload', 'data:image/png,hello'],
		['a plain URL', 'https://evil.example/x.png'],
		['javascript:', 'javascript:alert(1)'],
		['garbage base64', 'data:image/png;base64,***not base64***']
	])('rejects %s as the image', async (_l, imageDataUrl) => {
		const r = await post(s.priya, { text: 'x', imageDataUrl });
		expect(r.status).toBe(400);
	});

	it('caps the decoded image at 2 MB', async () => {
		const big = 'data:image/png;base64,' + 'A'.repeat(2_800_000); // ≈2.1 MB decoded
		expect((await post(s.priya, { text: 'x', imageDataUrl: big })).status).toBe(400);
	});

	it('rejects empty and oversized text and malformed bodies', async () => {
		expect((await post(s.priya, { text: '   ' })).status).toBe(400);
		expect((await post(s.priya, { text: 'x'.repeat(4001) })).status).toBe(400);
		expect((await post(s.priya, { nope: true })).status).toBe(400);
		expect((await post(s.priya, null)).status).toBe(400);
	});

	it('consultants may add notes; admin (view-only), engineer and other locations may not', async () => {
		expect((await post(s.vikram, { text: 'Consultant observation.' })).status).toBe(200);
		expect((await post(s.admin, { text: 'x' })).status).toBe(403);
		expect((await post(s.arjun, { text: 'x' })).status).toBe(403);
		expect((await post(s.rohan, { text: 'x' })).status).toBe(404);
		expect((await post(s.anon, { text: 'x' })).status).toBe(401);
		expect((await post(s.priya, { text: 'x' }, '00000000-0000-0000-0000-000000000000')).status).toBe(404);
	});
});
