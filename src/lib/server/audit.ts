import type { Prisma } from '@prisma/client';
import { prisma } from './db';

export interface AuditInput {
	actorUserId?: string | null;
	actorRole: string;
	action: string;
	entityType: string;
	entityId: string;
	previousValue?: Prisma.InputJsonValue;
	newValue?: Prisma.InputJsonValue;
	notes?: string;
}

export async function logAudit(input: AuditInput) {
	await prisma.auditLog.create({
		data: {
			actorUserId: input.actorUserId ?? null,
			actorRole: input.actorRole,
			action: input.action,
			entityType: input.entityType,
			entityId: input.entityId,
			previousValue: input.previousValue,
			newValue: input.newValue,
			notes: input.notes
		}
	});
}

/** Shorthand for the common case: an authenticated user performing an action. */
export function auditAs(user: NonNullable<App.Locals['user']>) {
	return (a: Omit<AuditInput, 'actorUserId' | 'actorRole'>) =>
		logAudit({ ...a, actorUserId: user.id, actorRole: user.role });
}
