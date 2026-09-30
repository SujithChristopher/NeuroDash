import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { askAssistant } from '$lib/server/ai';

const body = z.object({ question: z.string().trim().min(1).max(500) });

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401);
	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return json({ error: 'Ask a question (up to 500 characters).' }, { status: 400 });
	return json(await askAssistant(locals.user, parsed.data.question));
};
