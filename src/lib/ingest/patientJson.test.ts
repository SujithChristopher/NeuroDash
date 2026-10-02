import { describe, expect, it } from 'vitest';
import { isReservedPatientId, laptopSide, laptopStatus, registryEntry } from './patientJson';

describe('status / side mapping to the laptop vocabulary', () => {
	it('maps app statuses to active / paused / discharged', () => {
		expect(laptopStatus('Active')).toBe('active');
		expect(laptopStatus('Ongoing')).toBe('active');
		expect(laptopStatus('Paused')).toBe('paused');
		expect(laptopStatus('Completed')).toBe('discharged');
		expect(laptopStatus('Discontinued')).toBe('discharged');
	});
	it('maps the affected side', () => {
		expect(laptopSide('Left')).toBe('left');
		expect(laptopSide('RIGHT')).toBe('right');
		expect(laptopSide('Bilateral')).toBe('both');
		expect(laptopSide(null)).toBeNull();
		expect(laptopSide('unknown')).toBeNull();
	});
});

describe('registryEntry (patients.json)', () => {
	it('has exactly the fields the laptops read, devices upper-case, unique and sorted', () => {
		expect(registryEntry({ code: '118', status: 'Active', affectedSide: 'Right', devices: ['pluto', 'MARS01', 'PLUTO'] })).toEqual({
			user_id: '118',
			status: 'active',
			side: 'right',
			devices: ['MARS01', 'PLUTO']
		});
	});
	it('uses null for an unset side and [] for no devices', () => {
		expect(registryEntry({ code: 'a', status: 'Paused', affectedSide: null, devices: [] })).toEqual({
			user_id: 'a',
			status: 'paused',
			side: null,
			devices: []
		});
	});
});

describe('patients.json entries carry no personal details', () => {
	it('has exactly the four fields the laptops read and nothing else', () => {
		const e = registryEntry({ code: 'P-1', status: 'Active', affectedSide: 'Left', devices: ['PLUTO'] });
		expect(Object.keys(e).sort()).toEqual(['devices', 'side', 'status', 'user_id']);
	});
});

describe('isReservedPatientId', () => {
	it('blocks ids that would collide with the local server’s own folders and files', () => {
		for (const id of ['PLUTO', 'pluto', 'MARS01', 'mars2', 'NOARK', 'hypercube', 'ATOBOT3', '_incoming', 'backup', 'patients', 'devices', 'sync_log']) {
			expect(isReservedPatientId(id), id).toBe(true);
		}
	});
	it('allows ordinary patient ids', () => {
		for (const id of ['118', 'testr', 'P-10124', 'marsha', 'plutonium', 'A1']) expect(isReservedPatientId(id), id).toBe(false);
	});
});
