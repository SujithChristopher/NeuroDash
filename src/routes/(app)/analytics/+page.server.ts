import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/guard';
import { centreStats, fleetStats, inflowSeries, parseRange, programStats, recentAudit } from '$lib/server/analytics';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals.user);
	const range = parseRange(url.searchParams.get('range'));
	const role = user.role;

	// Therapist/Consultant: patient KPIs. Engineer: device ops. Admin: both + audit activity.
	const wantsProgram = role !== 'ENGINEER';
	const wantsFleet = role === 'ENGINEER' || role === 'ADMIN';

	const [program, inflow, fleet, audit, centres] = await Promise.all([
		wantsProgram ? programStats(user) : null,
		wantsProgram ? inflowSeries(user, range) : null,
		wantsFleet ? fleetStats() : null,
		role === 'ADMIN' ? recentAudit(8) : null,
		// Per-centre figures: the admin sees every centre; therapists and consultants see their own.
		wantsProgram ? centreStats(user) : []
	]);

	return { range, program, inflow, fleet, audit, centres };
};
