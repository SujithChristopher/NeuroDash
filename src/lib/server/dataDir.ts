import path from 'node:path';
import { env } from '$env/dynamic/private';
import { PATIENT_ID_PATTERN } from '$lib/ingest/parse';

/**
 * The local server's data folder (NEURODASH_DATA_DIR, e.g. D:/NeuroDashData). Returns null when it is not
 * configured, in which case every folder feature quietly does nothing and the rest of the app is unaffected.
 */
export function dataRoot(): string | null {
	const v = env.NEURODASH_DATA_DIR?.trim();
	return v ? path.resolve(v) : null;
}

/** <root>/<patient ID>. The ID is validated and the result is checked to stay inside the root. */
export function patientDir(root: string, patientCode: string): string {
	if (!PATIENT_ID_PATTERN.test(patientCode)) throw new Error(`"${patientCode}" is not a valid patient folder name.`);
	const dir = path.resolve(root, patientCode);
	if (path.dirname(dir) !== path.resolve(root)) throw new Error('Patient folder escapes the data directory.');
	return dir;
}

export const patientsRegistryPath = (root: string) => path.join(root, 'patients.json');
export const devicesHeartbeatPath = (root: string) => path.join(root, 'devices.json');

export function ingestIntervalSeconds(): number {
	const n = Number(env.INGEST_INTERVAL_SECONDS ?? '30');
	return Number.isFinite(n) && n >= 0 ? n : 30;
}

/** UDP nudge tells laptops "patients.json changed, sync now". Off in tests via NEURODASH_NUDGE=0. */
export const nudgeEnabled = () => (env.NEURODASH_NUDGE ?? '1') !== '0';

/** A patient counts as "in session" if a sessions.csv arrived this recently. Keep equal to ACTIVE_WINDOW_SECONDS in patients_store.py. */
export function activeWindowSeconds(): number {
	const n = Number(env.ACTIVE_WINDOW_SECONDS ?? '300');
	return Number.isFinite(n) && n > 0 ? n : 300;
}

export const presencePath = (root: string) => path.join(root, 'presence.json');
