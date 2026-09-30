import { prisma } from './db';

const MAX_TRIES = 10;

export async function generatePatientDisplayCode() {
	for (let i = 0; i < MAX_TRIES; i++) {
		const candidate = `P-${Math.floor(10000 + Math.random() * 90000)}`;
		if (!(await prisma.patient.findUnique({ where: { displayCode: candidate } }))) return candidate;
	}
	throw new Error('Could not generate a unique patient display code');
}

export async function generateDeviceDisplayCode(deviceTypeId: string) {
	for (let i = 0; i < MAX_TRIES; i++) {
		const candidate = `${deviceTypeId}-${String(Math.floor(1 + Math.random() * 999)).padStart(3, '0')}`;
		if (!(await prisma.device.findUnique({ where: { displayCode: candidate } }))) return candidate;
	}
	throw new Error('Could not generate a unique device display code');
}

const USER_PREFIX: Record<string, string> = {
	THERAPIST: 'U-T',
	CONSULTANT: 'U-C',
	ENGINEER: 'U-E',
	ADMIN: 'U-A'
};

export async function generateUserDisplayCode(role: string) {
	const prefix = USER_PREFIX[role] ?? 'U-X';
	for (let i = 0; i < MAX_TRIES; i++) {
		const candidate = `${prefix}${Math.floor(10 + Math.random() * 90)}`;
		if (!(await prisma.user.findUnique({ where: { displayCode: candidate } }))) return candidate;
	}
	throw new Error('Could not generate a unique user display code');
}
