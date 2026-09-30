import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from './db';

export interface NotificationInput {
	notifType: string;
	tone?: 'good' | 'info' | 'warning' | 'critical' | 'neutral';
	icon?: string;
	title: string;
	description: string;
	link?: { page: string };
}

function toData(n: NotificationInput) {
	return {
		notifType: n.notifType,
		tone: n.tone ?? 'info',
		icon: n.icon,
		title: n.title,
		description: n.description,
		link: n.link as Prisma.InputJsonValue | undefined
	};
}

export async function notifyRole(role: UserRole, n: NotificationInput) {
	await prisma.notification.create({ data: { ...toData(n), targetRole: role } });
}

export async function notifyUser(userId: string, n: NotificationInput) {
	await prisma.notification.create({ data: { ...toData(n), targetUserId: userId } });
}
