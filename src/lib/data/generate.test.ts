import { describe, it, expect } from 'vitest';
import { generateDB } from './generate';

describe('generateDB', () => {
	it('is deterministic', () => {
		const a = generateDB();
		const b = generateDB();
		expect(a.patients.map((p) => p.id)).toEqual(b.patients.map((p) => p.id));
		expect(a.patients[0].rate).toBeCloseTo(b.patients[0].rate, 10);
	});

	it('produces 14 device units across 6 types', () => {
		const db = generateDB();
		expect(db.units).toHaveLength(14);
	});

	it('produces 24 patients with 18 active, 3 new, 3 discharged', () => {
		const db = generateDB();
		expect(db.patients).toHaveLength(24);
		expect(db.patients.filter((p) => p.status === 'Active')).toHaveLength(18);
		expect(db.patients.filter((p) => p.status === 'New')).toHaveLength(3);
		expect(db.patients.filter((p) => p.status === 'Discharged')).toHaveLength(3);
	});

	it('generates sessions only for patients with a plan who are not New', () => {
		const db = generateDB();
		expect(db.sessions.length).toBeGreaterThan(0);
		const sessionPatientIds = new Set(db.sessions.map((s) => s.patientId));
		for (const id of sessionPatientIds) {
			const p = db.patients.find((p) => p.id === id)!;
			expect(p.status).not.toBe('New');
			expect(p.plan).not.toBeNull();
		}
	});

	it('generates at least one assessment per active/discharged patient', () => {
		const db = generateDB();
		for (const p of db.patients.filter((p) => p.status !== 'New')) {
			expect(db.assessments.some((a) => a.patientId === p.id)).toBe(true);
		}
	});

	it('generates the 7 scripted faults with correct lifecycle logs', () => {
		const db = generateDB();
		expect(db.faults).toHaveLength(7);
		const critical = db.faults.find((f) => f.unitId === 'ATLAS-01')!;
		expect(critical.status).toBe('Reported');
		expect(critical.log).toHaveLength(1);
		const cleared = db.faults.find((f) => f.unitId === 'PLUTO-01')!;
		expect(cleared.status).toBe('Cleared for use');
		expect(cleared.log.length).toBeGreaterThan(1);
	});

	it('generates audit entries for every patient registration', () => {
		const db = generateDB();
		for (const p of db.patients) {
			expect(db.audit.some((a) => a.action === 'Registered patient' && a.target === p.id)).toBe(true);
		}
	});
});
