import { error, fail } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { patientScopeFor } from '$lib/server/scope';
import { auditAs } from '$lib/server/audit';
import { deviceUsage } from '$lib/server/devices';
import { inflowSeries, parseRange } from '$lib/server/analytics';
import { loadPatientReport } from '$lib/server/patientReport';
import { reportStore } from '$lib/server/reportStore';
import { cleanNotes, parsePeriod } from '$lib/patientReport';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireRole(locals.user, 'THERAPIST', 'CONSULTANT', 'ADMIN');
	const view = ['patient', 'device', 'inflow'].includes(url.searchParams.get('view') ?? '')
		? (url.searchParams.get('view') as 'patient' | 'device' | 'inflow')
		: 'patient';
	const range = parseRange(url.searchParams.get('range'));
	const patientId = url.searchParams.get('patient');
	const period = parsePeriod(url.searchParams.get('from'), url.searchParams.get('to'));

	const patients = await prisma.patient.findMany({
		where: patientScopeFor(user),
		select: { id: true, name: true, displayCode: true },
		orderBy: { name: 'asc' }
	});

	let patientReport = null;
	let sessions: { date: string; device: string; minutes: number | null }[] = [];
	let savedReports: { id: string; title: string; createdAt: string; by: string }[] = [];
	if (view === 'patient' && patientId) {
		const loaded = await loadPatientReport(user, patientId, period);
		if (loaded) {
			patientReport = loaded.report;
			sessions = loaded.sessions;
			const saved = await prisma.patientReport.findMany({
				where: { patientId: loaded.patientId },
				orderBy: { createdAt: 'desc' },
				include: { createdBy: { select: { name: true } } }
			});
			savedReports = saved.map((x) => ({ id: x.id, title: x.title, createdAt: x.createdAt.toISOString(), by: x.createdBy.name }));
		}
	}

	let deviceRows: {
		id: string;
		displayCode: string;
		category: string;
		sessions: number;
		totalMin: number;
		avgAccuracy: number;
		totalStars: number;
	}[] = [];
	if (view === 'device') {
		const [devices, usage] = await Promise.all([
			prisma.device.findMany({
				select: { id: true, displayCode: true, deviceType: { select: { category: true } } },
				orderBy: { displayCode: 'asc' }
			}),
			deviceUsage()
		]);
		deviceRows = devices
			.map((d) => {
				const u = usage.get(d.id);
				return {
					id: d.id,
					displayCode: d.displayCode,
					category: d.deviceType.category,
					sessions: u?.sessions ?? 0,
					totalMin: Math.round(u?.totalMin ?? 0),
					avgAccuracy: u?.avgAccuracy ?? 0,
					totalStars: u?.totalStars ?? 0
				};
			})
			.sort((a, b) => b.totalMin - a.totalMin);
	}

	const inflow = view === 'inflow' ? await inflowSeries(user, range) : null;

	return {
		view,
		range,
		patientId,
		period,
		patients,
		patientReport,
		sessions,
		savedReports,
		// Consultants may add notes (so they may save a report); admin is view-only.
		canSave: user.role === 'THERAPIST' || user.role === 'CONSULTANT',
		storageReady: reportStore() !== null,
		deviceRows,
		inflow
	};
};

export const actions: Actions = {
	/** Saves the report as it is now, with the notes typed on it, to the report store; it can be reopened later. */
	saveReport: async ({ request, locals }) => {
		const user = requireRole(locals.user, 'THERAPIST', 'CONSULTANT');
		const fd = await request.formData();
		const patientId = String(fd.get('patientId') ?? '');
		const title = String(fd.get('title') ?? '').trim().slice(0, 120);

		// The report is rebuilt here from the database: only the notes are taken from the browser.
		const period = parsePeriod(String(fd.get('from') ?? ''), String(fd.get('to') ?? ''));
		const loaded = await loadPatientReport(user, patientId, period);
		if (!loaded) throw error(404, 'Patient not found');
		const store = reportStore();
		if (!store) return fail(400, { error: 'Report storage is not set up. Set NEURODASH_DATA_DIR (or REPORTS_DIR) and restart.' });

		let rawNotes: unknown = {};
		try {
			rawNotes = JSON.parse(String(fd.get('notes') ?? '{}'));
		} catch {
			return fail(400, { error: 'The notes could not be read.' });
		}
		const notes = cleanNotes(rawNotes, loaded.report.scales.map((x) => x.scaleId));

		const id = randomUUID();
		const key = `${loaded.report.patient.displayCode}/${id}.json`;
		const savedAt = new Date().toISOString();
		const covers = period.from || period.to ? ` (${period.from ?? 'start'} to ${period.to ?? 'today'})` : '';
		const finalTitle = title || `Report ${savedAt.slice(0, 10)}${covers}`;
		await store.put(key, JSON.stringify({ version: 1, id, title: finalTitle, savedAt, savedBy: { name: user.name, role: user.role }, report: loaded.report, notes }, null, 2));

		await prisma.patientReport.create({ data: { id, patientId: loaded.patientId, createdById: user.id, title: finalTitle, storage: store.kind, storageKey: key } });
		await auditAs(user)({ action: 'Report Saved', entityType: 'Patient Report', entityId: id, newValue: { patient: loaded.report.patient.displayCode, title: finalTitle } });
		return { ok: true, message: 'Report saved. You can reopen it under Saved reports.', savedId: id };
	}
};

