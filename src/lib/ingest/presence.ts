// "Who is training right now?" The Python server writes presence.json each time a sessions.csv arrives:
//   { "<patient ID>": { "device": "MARS01", "last_upload": "2026-10-01T16:20:05", "ip": "…" } }
// A patient is "in session" while that upload is newer than the active window. Pure, so it is unit-tested.

export interface PresenceEntry {
	code: string;
	device: string;
	/** The laptop (its own id, e.g. its computer name) when the sender reported one */
	client: string | null;
	lastUpload: string; // as written by the server (local wall-clock time)
	secondsAgo: number;
	active: boolean;
}

export const DEFAULT_ACTIVE_WINDOW_SECONDS = 900; // 15 minutes: some games run that long without a sign of life

/** Anything malformed is ignored rather than breaking the dashboard. */
export function computePresence(raw: unknown, now = Date.now(), windowSeconds = DEFAULT_ACTIVE_WINDOW_SECONDS): PresenceEntry[] {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
	const out: PresenceEntry[] = [];
	for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
		const v = value as { device?: unknown; client?: unknown; last_upload?: unknown } | null;
		if (!v || typeof v.last_upload !== 'string' || typeof v.device !== 'string') continue;
		// Written by a process on this machine in local time without a zone, so it is read back as local time.
		const t = new Date(v.last_upload).getTime();
		if (!Number.isFinite(t)) continue;
		const secondsAgo = Math.max(0, Math.round((now - t) / 1000));
		out.push({ code, device: v.device, client: typeof v.client === 'string' && v.client ? v.client : null, lastUpload: v.last_upload, secondsAgo, active: secondsAgo <= windowSeconds });
	}
	return out;
}

/** Stable text for "who is active" that changes only when someone starts or stops training (not every upload). */
export function presenceSignature(entries: PresenceEntry[]): string {
	return entries
		.filter((e) => e.active)
		.map((e) => `${e.code}@${e.device}`)
		.sort()
		.join(',');
}
