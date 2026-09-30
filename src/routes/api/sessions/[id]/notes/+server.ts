import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/server/db';
import { requireApiRole } from '$lib/server/guard';
import { patientScopeFor } from '$lib/server/scope';
import { auditAs } from '$lib/server/audit';
import { validateImageDataUrl } from '$lib/server/imageDataUrl';

const body = z.object({
	text: z.string().trim().min(1, 'Write a note first.').max(4000),
	imageDataUrl: z.string().max(3_000_000).nullish()
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
	// Clinical record: Admin is view-only, Engineer has no clinical access.
	const user = requireApiRole(locals.user, 'THERAPIST', 'CONSULTANT');

	const session = await prisma.therapySession.findFirst({
		where: { id: params.id, patient: patientScopeFor(user) },
		select: { id: true }
	});
	if (!session) throw error(404, 'Session not found');

	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return json({ error: parsed.error.issues[0].message }, { status: 400 });

	const image = parsed.data.imageDataUrl || null;
	if (image) {
		const v = validateImageDataUrl(image);
		if (!v.ok) return json({ error: v.error }, { status: 400 });
	}

	const note = await prisma.sessionNote.create({
		data: { sessionId: session.id, authorId: user.id, text: parsed.data.text, imageDataUrl: image },
		include: { author: { select: { name: true } } }
	});
	await auditAs(user)({ action: 'Session Note Added', entityType: 'Session Note', entityId: note.id });

	return json({
		id: note.id,
		author: note.author.name,
		text: note.text,
		imageDataUrl: note.imageDataUrl,
		createdAt: note.createdAt
	});
};
