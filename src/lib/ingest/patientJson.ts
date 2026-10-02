// What goes into the local server's common patients.json (one file for every patient).
// Pure builders, so the exact contents are unit-tested.
//
// Privacy: the file sits on a shared folder that laptops and engineers can read, so it holds the patient's training
// identity and device allocation only: never name, date of birth or contact details.

/** The laptop-side vocabulary of patients.json (see localserver/DASHBOARD_DATA_GUIDE.md). */
export type LaptopStatus = 'active' | 'paused' | 'discharged';

export function laptopStatus(status: string): LaptopStatus {
	if (status === 'Paused') return 'paused';
	if (status === 'Completed' || status === 'Discontinued') return 'discharged';
	return 'active'; // Active / Ongoing
}

export function laptopSide(affectedSide: string | null | undefined): 'left' | 'right' | 'both' | null {
	const s = (affectedSide ?? '').toLowerCase();
	if (s === 'left' || s === 'right') return s;
	if (s === 'bilateral' || s === 'both') return 'both';
	return null;
}

export interface RegistryEntry {
	user_id: string;
	status: LaptopStatus;
	side: 'left' | 'right' | 'both' | null;
	devices: string[];
	[extra: string]: unknown;
}

/** The entry for patients.json. Devices are upper-case and sorted, and always sent as a whole list. */
export function registryEntry(p: {
	code: string;
	status: string;
	affectedSide: string | null;
	devices: string[];
}): RegistryEntry {
	return {
		user_id: p.code,
		status: laptopStatus(p.status),
		side: laptopSide(p.affectedSide),
		devices: [...new Set(p.devices.map((d) => d.toUpperCase()))].sort()
	};
}

/** Training devices the local server knows; patient IDs may not collide with these folder names. */
export const LOCAL_SERVER_DEVICES = ['PLUTO', 'MARS', 'ATOBOT', 'HYPERCUBE', 'NOARK', 'DYNABO', 'MOBBO', 'WEARABLE'];

const RESERVED_NAMES = new Set(['_incoming', 'backup', 'patients', 'devices', 'sync_log', 'patient']);

/**
 * Patient IDs are folder names in the same directory as the device folders and the server's own files, so
 * "PLUTO", "mars01", "_incoming" or "patients" would collide with them.
 */
export function isReservedPatientId(id: string, deviceIds: string[] = LOCAL_SERVER_DEVICES): boolean {
	const lower = id.toLowerCase();
	if (RESERVED_NAMES.has(lower)) return true;
	const stem = id.toUpperCase().replace(/\d+$/, '');
	return deviceIds.some((d) => d.toUpperCase() === stem);
}
