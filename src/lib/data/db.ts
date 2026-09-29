import { generateDB, OPEN_FAULT, type Patient, type Unit } from './generate';
import type { User } from './users';
import { NAV, DETAIL } from './users';
import { daysAgo } from './seed';

export const DB = generateDB();

export const unitOf = (id: string) => DB.units.find((u) => u.id === id);
export const patientOf = (id: string) => DB.patients.find((p) => p.id === id);

export function scopePatients(user: User): Patient[] {
	if (user.role === 'therapist') return DB.patients.filter((p) => p.therapistId === user.id);
	if (user.role === 'engineer') return DB.patients.filter((p) => p.plan && (user.owns ?? []).includes(p.plan.typeId));
	return DB.patients;
}

export function scopeUnits(user: User): Unit[] {
	return user.role === 'engineer' ? DB.units.filter((u) => (user.owns ?? []).includes(u.typeId)) : DB.units;
}

export const canSeePatient = (user: User, p: Patient) =>
	user.role === 'consultant' || user.role === 'admin' || (user.role === 'therapist' && p.therapistId === user.id);

export const canSeeUnit = (user: User, u: Unit) =>
	user.role === 'admin' || (user.role === 'engineer' && (user.owns ?? []).includes(u.typeId));

export const anon = (user: User) => user.role === 'engineer';
export const pname = (user: User, p: Patient) => (anon(user) ? p.code : p.name);

export function allowed(user: User, page: string): boolean {
	if (DETAIL[page]) return DETAIL[page].includes(user.role);
	return NAV[user.role].some((n) => Array.isArray(n) && n[0] === page);
}

export const daysToCal = (u: Unit) => u.calInterval - daysAgo(u.lastCal);

export function unitStatus(u: Unit): 'Out of service' | 'Needs attention' | 'In use' | 'Available' {
	const open = DB.faults.filter((f) => f.unitId === u.id && OPEN_FAULT(f));
	const calDue = daysToCal(u);
	const syncH = (+new Date() - +u.lastSync) / 3600000;
	if (open.some((f) => f.severity === 'Critical' || f.severity === 'High')) return 'Out of service';
	if (open.length || calDue < 0 || syncH > 24) return 'Needs attention';
	if (DB.patients.some((p) => p.status === 'Active' && p.plan && p.plan.unitId === u.id)) return 'In use';
	return 'Available';
}

export function liveStatus(u: Unit): 'Out of service' | 'Offline' | 'Needs attention' | 'In session' | 'Available' | 'In use' {
	const s = unitStatus(u);
	if (s === 'Out of service') return s;
	if ((+new Date() - +u.lastSync) / 3600000 > 24) return 'Offline';
	if (s === 'Needs attention') return s;
	if (DB.patients.some((p) => p.slot && p.slot.state === 'In progress' && p.plan && p.plan.unitId === u.id)) return 'In session';
	return s;
}

export { OPEN_FAULT };
