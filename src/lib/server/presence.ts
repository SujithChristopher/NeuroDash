// Read-only view of presence.json (written by the Python server when a sessions.csv arrives).
import fs from 'node:fs/promises';
import { computePresence, type PresenceEntry } from '$lib/ingest/presence';
import { activeWindowSeconds, dataRoot, presencePath } from './dataDir';

export async function readPresence(): Promise<PresenceEntry[]> {
	const root = dataRoot();
	if (!root) return [];
	try {
		return computePresence(JSON.parse(await fs.readFile(presencePath(root), 'utf8')), Date.now(), activeWindowSeconds());
	} catch {
		return []; // no file yet, or caught mid-write: treat as nobody training
	}
}

/** Patients training right now, keyed by patient ID. */
export async function activeByCode(): Promise<Map<string, PresenceEntry>> {
	return new Map((await readPresence()).filter((e) => e.active).map((e) => [e.code, e]));
}
