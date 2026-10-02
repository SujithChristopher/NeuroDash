// Background scan of the local server's data folder, so uploads appear in the app without anyone pressing a button.
import { watch } from 'node:fs';
import { building } from '$app/environment';
import { dataRoot, ingestIntervalSeconds } from './dataDir';
import { runIngest } from './ingest';
import { isWatchedUpload } from '$lib/ingest/parse';

const KEY = Symbol.for('neurodash.ingest.poller');

/**
 * Starts once per server process (hot-reload safe). INGEST_INTERVAL_SECONDS=0 turns it all off.
 *   - a scan every INGEST_INTERVAL_SECONDS (the safety net: catches anything a file watcher misses), and
 *   - a file watcher that scans about a second after a sessions.csv / configdata.csv is written, so a finished
 *     session appears in the dashboard almost immediately.
 */
export function startIngestPoller() {
	const g = globalThis as Record<symbol, unknown>;
	if (building || g[KEY]) return;
	const seconds = ingestIntervalSeconds();
	const root = dataRoot();
	if (!seconds || !root) return;

	const tick = () => runIngest().catch((e) => console.warn('[local server] scan failed:', e instanceof Error ? e.message : e));
	g[KEY] = setInterval(tick, seconds * 1000);
	(g[KEY] as { unref?: () => void }).unref?.(); // never keep the process alive just for the poller
	setTimeout(tick, 2000).unref?.();

	try {
		let debounce: ReturnType<typeof setTimeout> | undefined;
		const watcher = watch(root, { recursive: true, persistent: false }, (_event, name) => {
			if (!name || !isWatchedUpload(String(name))) return;
			clearTimeout(debounce);
			debounce = setTimeout(tick, 1200); // let the write finish and coalesce bursts of events
		});
		watcher.on('error', (e) => console.warn('[local server] file watcher stopped:', e.message));
		console.log(`[local server] watching ${root}, scanning every ${seconds}s`);
	} catch (e) {
		// Recursive watching is not available everywhere: the periodic scan still covers everything.
		console.warn(`[local server] file watcher unavailable (${e instanceof Error ? e.message : e}); scanning every ${seconds}s`);
	}
}
