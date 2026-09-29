import { describe, it, expect } from 'vitest';
import { DB, unitOf, patientOf, scopePatients, scopeUnits, canSeePatient, canSeeUnit, anon, pname, allowed, daysToCal, unitStatus } from './db';
import { userOf } from './users';

const therapist = userOf('U-T1')!;
const engineer = userOf('U-E1')!; // owns PLUTO, MARS
const admin = userOf('U-A1')!;
const consultant = userOf('U-C1')!;

describe('DB', () => {
	it('is built once and populated', () => {
		expect(DB.units.length).toBeGreaterThan(0);
		expect(DB.patients.length).toBeGreaterThan(0);
	});
});

describe('scoping', () => {
	it('therapist sees only their own patients', () => {
		const scoped = scopePatients(therapist);
		expect(scoped.length).toBeGreaterThan(0);
		expect(scoped.every((p) => p.therapistId === therapist.id)).toBe(true);
	});

	it('engineer sees only units of owned types', () => {
		const scoped = scopeUnits(engineer);
		expect(scoped.length).toBeGreaterThan(0);
		expect(scoped.every((u) => engineer.owns!.includes(u.typeId))).toBe(true);
	});

	it('admin sees everything', () => {
		expect(scopePatients(admin)).toHaveLength(DB.patients.length);
		expect(scopeUnits(admin)).toHaveLength(DB.units.length);
	});

	it('empty scope is a valid, non-throwing result', () => {
		const noOwner = { ...engineer, owns: ['NOPE'] };
		expect(scopeUnits(noOwner)).toEqual([]);
	});
});

describe('access control', () => {
	it('canSeePatient: therapist only their own, consultant/admin any', () => {
		const mine = DB.patients.find((p) => p.therapistId === therapist.id)!;
		const notMine = DB.patients.find((p) => p.therapistId !== therapist.id)!;
		expect(canSeePatient(therapist, mine)).toBe(true);
		expect(canSeePatient(therapist, notMine)).toBe(false);
		expect(canSeePatient(consultant, notMine)).toBe(true);
		expect(canSeePatient(admin, notMine)).toBe(true);
	});

	it('canSeeUnit: engineer only owned types, admin any', () => {
		const owned = DB.units.find((u) => engineer.owns!.includes(u.typeId))!;
		const notOwned = DB.units.find((u) => !engineer.owns!.includes(u.typeId))!;
		expect(canSeeUnit(engineer, owned)).toBe(true);
		expect(canSeeUnit(engineer, notOwned)).toBe(false);
		expect(canSeeUnit(admin, notOwned)).toBe(true);
	});

	it('anon/pname: engineers see patient code, others see name', () => {
		const p = DB.patients[0];
		expect(anon(engineer)).toBe(true);
		expect(pname(engineer, p)).toBe(p.code);
		expect(anon(therapist)).toBe(false);
		expect(pname(therapist, p)).toBe(p.name);
	});

	it('allowed: page must be in role NAV, or a permitted detail route', () => {
		expect(allowed(therapist, 'today')).toBe(true);
		expect(allowed(therapist, 'audit')).toBe(false);
		expect(allowed(admin, 'audit')).toBe(true);
		expect(allowed(therapist, 'patient')).toBe(true);
		expect(allowed(engineer, 'patient')).toBe(false);
		expect(allowed(engineer, 'device')).toBe(true);
	});
});

describe('unitOf / patientOf', () => {
	it('find by id, undefined for unknown id', () => {
		expect(unitOf(DB.units[0].id)).toBe(DB.units[0]);
		expect(unitOf('NOPE')).toBeUndefined();
		expect(patientOf(DB.patients[0].id)).toBe(DB.patients[0]);
		expect(patientOf('NOPE')).toBeUndefined();
	});
});

describe('unit status', () => {
	it('daysToCal and unitStatus never throw for any generated unit', () => {
		for (const u of DB.units) {
			expect(() => daysToCal(u)).not.toThrow();
			expect(['Out of service', 'Needs attention', 'In use', 'Available']).toContain(unitStatus(u));
		}
	});

	it('a unit with an open Critical/High fault is Out of service', () => {
		const u = unitOf('ATLAS-01')!;
		expect(unitStatus(u)).toBe('Out of service');
	});
});
