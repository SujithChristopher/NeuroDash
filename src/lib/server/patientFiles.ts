// Keeps the local server's folder in step with the database:
//   <data dir>/<patient ID>/            created when the patient is registered (the laptops upload into it)
//   <data dir>/patients.json            ONE common file: every patient and their devices; the laptops sync from it
// The web app is the single writer of patients.json; the Python CLI (localserver/patients_store.py) still works
// but should not be used at the same time.
import dgram from 'node:dgram';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from './db';
import { dataRoot, nudgeEnabled, patientDir, patientsRegistryPath } from './dataDir';
import { registryEntry, type RegistryEntry } from '$lib/ingest/patientJson';

export type FolderSync = { ok: true; skipped?: boolean } | { ok: false; error: string };

const NUDGE_PORT = 5001;

const localIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

async function writeAtomic(file: string, data: unknown) {
	await fs.mkdir(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
	await fs.rename(tmp, file);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
	try {
		return JSON.parse(await fs.readFile(file, 'utf8')) as T;
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
		throw e; // a corrupt registry must stop us rather than be silently overwritten
	}
}

// ---------------------------------------------------------------- UDP nudge

function broadcastAddresses(): string[] {
	const out = new Set(['255.255.255.255']);
	for (const list of Object.values(os.networkInterfaces())) {
		for (const i of list ?? []) {
			if (i.family === 'IPv4' && !i.internal) out.add(i.address.split('.').slice(0, 3).join('.') + '.255'); // assumes a /24 network
		}
	}
	return [...out];
}

async function sendNudge(version: number) {
	if (!nudgeEnabled()) return;
	const sock = dgram.createSocket('udp4');
	const msg = Buffer.from(JSON.stringify({ type: 'patients_changed', version }));
	try {
		await new Promise<void>((resolve) => sock.bind(0, () => resolve()));
		sock.setBroadcast(true);
		await Promise.all(
			broadcastAddresses().map((addr) => new Promise<void>((resolve) => sock.send(msg, NUDGE_PORT, addr, () => resolve())))
		);
	} catch {
		/* best effort: laptops still poll every 60 s */
	} finally {
		sock.close();
	}
}

// ---------------------------------------------------------------- patients.json

interface Registry {
	version: number;
	updated_at: string;
	patients: RegistryEntry[];
}

// Serialises registry edits inside this process so two quick requests can't overwrite each other.
let registryQueue: Promise<unknown> = Promise.resolve();

/** Adds or updates one patient's entry (other patients and unknown fields are left untouched). */
export function upsertRegistryEntry(root: string, entry: RegistryEntry): Promise<{ changed: boolean; version: number }> {
	const run = async () => {
		const file = patientsRegistryPath(root);
		const reg = await readJson<Registry>(file, { version: 0, updated_at: localIso(), patients: [] });
		if (!Array.isArray(reg.patients)) throw new Error('patients.json is malformed (no patients list).');

		const i = reg.patients.findIndex((p) => p.user_id === entry.user_id);
		// Keep any extra fields another tool wrote; our fields win. `limb` is no longer part of the file, so an old one is dropped.
		const { limb: _oldLimb, ...existing } = (i >= 0 ? reg.patients[i] : {}) as Record<string, unknown>;
		const next = i >= 0 ? ({ ...existing, ...entry } as RegistryEntry) : entry;
		if (i >= 0 && JSON.stringify(reg.patients[i]) === JSON.stringify(next)) return { changed: false, version: reg.version };

		if (i >= 0) reg.patients[i] = next;
		else reg.patients.push(next);
		reg.version += 1;
		reg.updated_at = localIso();
		await writeAtomic(file, reg);
		await sendNudge(reg.version);
		return { changed: true, version: reg.version };
	};
	const result = registryQueue.then(run, run);
	registryQueue = result.catch(() => undefined);
	return result;
}

// ---------------------------------------------------------------- one patient

/** Creates just <data dir>/<patient ID>/ (no patients.json entry yet). Never throws. */
export async function createPatientFolder(displayCode: string): Promise<FolderSync> {
	const root = dataRoot();
	if (!root) return { ok: true, skipped: true };
	try {
		await fs.mkdir(patientDir(root, displayCode), { recursive: true });
		return { ok: true };
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		console.warn(`[local server] could not create the folder for ${displayCode}: ${error}`);
		return { ok: false, error };
	}
}

/**
 * Creates <data dir>/<patient ID>/ and mirrors the patient into the common patients.json (status, side and
 * allocated devices: exactly what the laptops read). The database stays the source of truth; patients.json is a
 * one-way mirror of it.
 * Never throws: a missing or unwritable folder must not break registering a patient. The caller gets the reason.
 */
export async function syncPatientToLocalServer(patientId: string): Promise<FolderSync> {
	const root = dataRoot();
	if (!root) return { ok: true, skipped: true };
	try {
		const p = await prisma.patient.findUnique({
			where: { id: patientId },
			select: {
				displayCode: true,
				status: true,
				affectedSide: true,
				trainingDevices: { select: { deviceTypeId: true } },
				// The side being trained comes from the latest plan; the affected side is the fallback.
				therapyPlans: { orderBy: { createdAt: 'desc' }, take: 1, select: { trainingSide: true } }
			}
		});
		if (!p) return { ok: false, error: 'Patient not found.' };

		await fs.mkdir(patientDir(root, p.displayCode), { recursive: true });
		await upsertRegistryEntry(
			root,
			registryEntry({
				code: p.displayCode,
				status: p.status,
				affectedSide: p.therapyPlans[0]?.trainingSide ?? p.affectedSide,
				devices: p.trainingDevices.map((d) => d.deviceTypeId)
			})
		);
		return { ok: true };
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		console.warn(`[local server] could not update the data folder for ${patientId}: ${error}`);
		return { ok: false, error };
	}
}
