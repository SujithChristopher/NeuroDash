import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/guard';
import { AI_SUGGESTIONS } from '$lib/server/ai';

export const load: PageServerLoad = async ({ locals }) => {
	requireUser(locals.user);
	return { suggestions: AI_SUGGESTIONS };
};
