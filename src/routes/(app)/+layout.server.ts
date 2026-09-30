import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { notificationWhereFor } from '$lib/server/notifications';

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) throw redirect(302, '/login');

	const [unread, openIssues, myOpenRequests] = await Promise.all([
		prisma.notification.count({ where: { ...notificationWhereFor(user), isRead: false } }),
		user.role === 'ENGINEER'
			? prisma.deviceIssue.count({ where: { status: { notIn: ['Resolved', 'Cleared'] } } })
			: Promise.resolve(0),
		user.role === 'THERAPIST'
			? prisma.deviceRequest.count({
					where: { therapistId: user.id, status: { notIn: ['Assigned', 'Declined'] } }
				})
			: Promise.resolve(0)
	]);

	return { user, unread, navBadges: { openIssues, myOpenRequests } };
};
