import type { Prisma } from '@prisma/client';

type User = App.Locals['user'];

/** Location scoping: the one helper every patient-linked query reuses (spec §6.3). */
export function patientScopeFor(user: User): Prisma.PatientWhereInput {
	if (!user) return { id: 'never-matches' };
	if (user.role === 'THERAPIST' || user.role === 'CONSULTANT') {
		return { therapist: { locationId: user.locationId ?? null } };
	}
	return {};
}

export function isOwnerTherapist(user: User, therapistId: string) {
	return user?.role === 'THERAPIST' && user.id === therapistId;
}

export function canModifyPlan(
	user: User,
	patientTherapist: { id: string; locationId: string | null }
) {
	if (isOwnerTherapist(user, patientTherapist.id)) return true;
	// A therapist covering for a colleague at the same location. Consultants are read-only (notes aside).
	if (user?.role !== 'THERAPIST') return false;
	return user.locationId != null && user.locationId === patientTherapist.locationId;
}
