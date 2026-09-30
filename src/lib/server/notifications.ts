import type { Prisma } from '@prisma/client';

type User = NonNullable<App.Locals['user']>;

/** A notification is "mine" if addressed to me, or broadcast to my role. */
export function notificationWhereFor(user: User): Prisma.NotificationWhereInput {
	return {
		OR: [{ targetUserId: user.id }, { targetUserId: null, targetRole: user.role }]
	};
}
