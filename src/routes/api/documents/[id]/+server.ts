import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/server/db';
import { requireApiRole } from '$lib/server/guard';
import { patientScopeFor } from '$lib/server/scope';
import { auditAs } from '$lib/server/audit';

/** Streams a stored scan. Access follows the patient's location scope; engineers have no clinical access. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const user = requireApiRole(locals.user, 'THERAPIST', 'CONSULTANT', 'ADMIN');
	const doc = await prisma.patientDocument.findFirst({
		where: { id: params.id, patient: patientScopeFor(user) }
	});
	if (!doc || !doc.data || !doc.mimeType) throw error(404, 'Document not found');

	await auditAs(user)({ action: 'Document Viewed', entityType: 'Patient Document', entityId: doc.id });

	const asDownload = url.searchParams.get('download') === '1';
	const safeName = doc.name.replace(/["\r\n]/g, '_');
	return new Response(new Uint8Array(doc.data), {
		headers: {
			'content-type': doc.mimeType,
			'content-length': String(doc.data.length),
			'content-disposition': `${asDownload ? 'attachment' : 'inline'}; filename="${safeName}"`,
			// A scan is only ever a PDF or a raster image: never let it execute as anything else.
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
			'cache-control': 'private, no-store'
		}
	});
};
