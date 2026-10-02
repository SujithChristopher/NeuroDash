// Where saved report snapshots live. Today that is a folder on the local server; the interface is the seam for S3 later:
// add an S3 implementation of ReportStore, return it from reportStore() when REPORT_STORAGE=s3, and nothing else changes
// (the database row keeps `storage` and `storageKey`, so old reports stay readable from wherever they were written).
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { dataRoot } from './dataDir';

export interface ReportStore {
	readonly kind: 'local';
	put(key: string, body: string): Promise<void>;
	get(key: string): Promise<string>;
}

/** Keys are "<patient ID>/<report id>.json": nothing else is accepted, so a key can never point outside the store. */
const KEY = /^[A-Za-z0-9_-]{1,40}\/[A-Za-z0-9-]{8,64}\.json$/;

export class LocalReportStore implements ReportStore {
	readonly kind = 'local' as const;
	constructor(private readonly root: string) {}

	private file(key: string) {
		if (!KEY.test(key)) throw new Error('Invalid report key.');
		const f = path.resolve(this.root, key);
		if (!f.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Report key escapes the store.');
		return f;
	}

	async put(key: string, body: string) {
		const f = this.file(key);
		await fs.mkdir(path.dirname(f), { recursive: true });
		// Write-then-rename so a reader never sees half a report.
		const tmp = `${f}.${process.pid}.tmp`;
		await fs.writeFile(tmp, body, 'utf8');
		await fs.rename(tmp, f);
	}

	async get(key: string) {
		return fs.readFile(this.file(key), 'utf8');
	}
}

/** REPORTS_DIR if set, else <data dir>/_reports (the underscore keeps the ingester and the Python server away from it). */
export function reportsDir(): string | null {
	const explicit = env.REPORTS_DIR?.trim();
	if (explicit) return path.resolve(explicit);
	const root = dataRoot();
	return root ? path.join(root, '_reports') : null;
}

export function reportStore(): ReportStore | null {
	const dir = reportsDir();
	return dir ? new LocalReportStore(dir) : null;
}

/** Returns the store a saved report was written to. Only "local" exists so far. */
export function storeFor(storage: string): ReportStore | null {
	return storage === 'local' ? reportStore() : null;
}
