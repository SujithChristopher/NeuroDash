import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from './db';

const ACCESS_SESSION_HOURS = 12;
const RESET_SESSION_MINUTES = 15;

export type SessionPurpose = 'access' | 'password-reset';

export async function createSession(userId: string, purpose: SessionPurpose = 'access') {
	const id = crypto.randomBytes(32).toString('hex');
	const ttl =
		purpose === 'access' ? ACCESS_SESSION_HOURS * 3600_000 : RESET_SESSION_MINUTES * 60_000;
	const expiresAt = new Date(Date.now() + ttl);
	await prisma.session.create({ data: { id, userId, purpose, expiresAt } });
	return { id, expiresAt };
}

export async function getSession(sessionId: string | undefined) {
	if (!sessionId) return null;
	const session = await prisma.session.findUnique({
		where: { id: sessionId },
		include: { user: { include: { location: true } } }
	});
	if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;
	return session;
}

export async function destroySession(sessionId: string) {
	await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
}

export function hashPassword(plain: string) {
	return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string) {
	return bcrypt.compare(plain, hash);
}
