import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { patientScopeFor } from '$lib/server/scope';
import { storeFor } from '$lib/server/reportStore';
import type { PatientReportData, ReportNotes } from '$lib/patientReport';

interface Snapshot {
	title: string;
	savedAt: string;
	savedBy: { name: string; role: string };
	report: PatientReportData;
	notes: ReportNotes;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = requireRole(locals.user, 'THERAPIST', 'CONSULTANT', 'ADMIN');
	// Same location scoping as the patient: another centre's report is a 404, not a 403.
	const row = await prisma.patientReport.findFirst({
		where: { AND: [{ id: params.id }, { patient: patientScopeFor(user) }] },
		include: { patient: { select: { id: true, displayCode: true } } }
	});
	if (!row) throw error(404, 'Report not found');

	const store = storeFor(row.storage);
	if (!store) throw error(503, `This report is stored in "${row.storage}", which is not available here.`);
	let snap: Snapshot;
	try {
		snap = JSON.parse(await store.get(row.storageKey)) as Snapshot;
	} catch {
		throw error(404, 'The saved report file could not be found on the report store.');
	}

	return {
		patient: row.patient,
		title: row.title,
		savedAt: snap.savedAt,
		savedBy: snap.savedBy,
		report: snap.report,
		notes: snap.notes
	};
};
