// Reads the local server's heartbeat file (devices.json) so the Data Sync page can show which laptops are
// online and whether they hold the current patients.json. Read-only: the Python server owns devices.json.
import fs from 'node:fs/promises';
import { dataRoot, devicesHeartbeatPath, patientsRegistryPath } from './dataDir';

/** A laptop polls every 60 s; offline after 3 missed polls (same rule as patients_store.py). */
export const OFFLINE_AFTER_SECONDS = 180;

export type LaptopState = 'online' | 'offline';

export interface LaptopRow {
	device: string;
	lastSeen: string;
	secondsAgo: number;
	version: number;
	ip: string | null;
	state: LaptopState;
	upToDate: boolean;
}

export function laptopState(lastSeenIso: string, now = Date.now()): { state: LaptopState; secondsAgo: number } {
	// devices.json stores local wall-clock time without a zone, written by a process on this same machine.
	const t = new Date(lastSeenIso).getTime();
	const secondsAgo = Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : Infinity;
	return { state: secondsAgo > OFFLINE_AFTER_SECONDS ? 'offline' : 'online', secondsAgo };
}

async function readJson<T>(file: string): Promise<T | null> {
	try {
		return JSON.parse(await fs.readFile(file, 'utf8')) as T;
	} catch {
		return null;
	}
}

export async function laptopStatus(): Promise<{ registryVersion: number | null; laptops: LaptopRow[] }> {
	const root = dataRoot();
	if (!root) return { registryVersion: null, laptops: [] };
	const [reg, beats] = await Promise.all([
		readJson<{ version?: number }>(patientsRegistryPath(root)),
		readJson<Record<string, { last_seen?: string; version?: number; ip?: string }>>(devicesHeartbeatPath(root))
	]);
	const registryVersion = typeof reg?.version === 'number' ? reg.version : null;
	const laptops = Object.entries(beats ?? {})
		.map(([device, b]) => {
			const { state, secondsAgo } = laptopState(b.last_seen ?? '');
			const version = typeof b.version === 'number' ? b.version : -1;
			return { device, lastSeen: b.last_seen ?? '', secondsAgo, version, ip: b.ip ?? null, state, upToDate: registryVersion !== null && version === registryVersion };
		})
		.sort((a, b) => a.device.localeCompare(b.device));
	return { registryVersion, laptops };
}
