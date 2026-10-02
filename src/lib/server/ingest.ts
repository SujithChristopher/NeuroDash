// Reads what the training laptops uploaded to the local server and stores it in the database.
//   <data dir>/<patient ID>/<LAPTOP>/sessions.csv    → TherapySession + SessionTrial (stars, hits, durations)
//   <data dir>/<patient ID>/<LAPTOP>/configdata.csv  → DeviceConfig
// Re-scans are idempotent: a file is skipped when its SHA-256 is unchanged, and sessions are upserted by a
// stable source key (laptops re-upload the whole cumulative file every time).
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from './db';
import { dataRoot } from './dataDir';
import {
	groupSessions,
	normalizeDevice,
	parseConfigCsv,
	parseSessionsCsv,
	sessionSourceKey,
	trialTypeFor
} from '$lib/ingest/parse';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const KINDS = { 'sessions.csv': 'sessions', 'configdata.csv': 'config' } as const;

export interface FileResult {
	path: string;
	status: 'ok' | 'unchanged' | 'unmatched' | 'error';
	message?: string;
}

export interface IngestSummary {
	startedAt: string;
	finishedAt: string;
	root: string | null;
	scanned: number;
	ingested: number;
	unchanged: number;
	unmatched: number;
	errors: number;
	sessions: number;
	trials: number;
	files: FileResult[];
	error?: string;
}

let running: Promise<IngestSummary> | null = null;
let last: IngestSummary | null = null;
export const lastIngest = () => last;

/** One run at a time: concurrent callers (poller + button) share the run that is already in progress. */
export function runIngest(): Promise<IngestSummary> {
	if (!running) running = doIngest().finally(() => (running = null));
	return running;
}

const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

async function listDirs(dir: string) {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	return entries.filter((e) => e.isDirectory() && !e.name.startsWith('_') && e.name.toLowerCase() !== 'backup').map((e) => e.name);
}

/** Finds every <root>/<patient>/<laptop>/(sessions|configdata).csv. Symlinks are ignored. */
async function discover(root: string) {
	const found: { patientFolder: string; laptop: string; kind: 'sessions' | 'config'; abs: string; rel: string }[] = [];
	for (const patientFolder of await listDirs(root)) {
		const pdir = path.join(root, patientFolder);
		for (const laptop of await listDirs(pdir)) {
			const ldir = path.join(pdir, laptop);
			for (const f of await fs.readdir(ldir, { withFileTypes: true })) {
				const kind = KINDS[f.name.toLowerCase() as keyof typeof KINDS];
				if (kind && f.isFile()) {
					found.push({ patientFolder, laptop, kind, abs: path.join(ldir, f.name), rel: [patientFolder, laptop, f.name].join('/') });
				}
			}
		}
	}
	return found;
}

async function doIngest(): Promise<IngestSummary> {
	const startedAt = new Date().toISOString();
	const summary: IngestSummary = {
		startedAt,
		finishedAt: startedAt,
		root: dataRoot(),
		scanned: 0,
		ingested: 0,
		unchanged: 0,
		unmatched: 0,
		errors: 0,
		sessions: 0,
		trials: 0,
		files: []
	};
	const finish = (extra: Partial<IngestSummary> = {}) => {
		summary.finishedAt = new Date().toISOString();
		Object.assign(summary, extra);
		last = summary;
		return summary;
	};

	const root = summary.root;
	if (!root) return finish({ error: 'NEURODASH_DATA_DIR is not set.' });
	try {
		await fs.access(root);
	} catch {
		return finish({ error: `The data folder ${root} does not exist or cannot be read.` });
	}

	const touched = new Set<string>(); // patient ids that received new data this run
	let files;
	try {
		files = await discover(root);
	} catch (e) {
		return finish({ error: `Could not scan ${root}: ${e instanceof Error ? e.message : e}` });
	}

	for (const f of files) {
		summary.scanned++;
		let result: FileResult;
		try {
			result = await processFile(f, touched, summary);
		} catch (e) {
			result = { path: f.rel, status: 'error', message: e instanceof Error ? e.message : String(e) };
			await record(f.rel, f.kind, '', f.patientFolder, null, 0, 'error', result.message).catch(() => undefined);
		}
		summary.files.push(result);
		if (result.status === 'ok') summary.ingested++;
		else if (result.status === 'unchanged') summary.unchanged++;
		else if (result.status === 'unmatched') summary.unmatched++;
		else summary.errors++;
	}

	for (const patientId of touched) {
		await applyDayLogs(patientId);
		await markOngoing(patientId);
	}
	await rolloverMissedDays();

	if (summary.ingested > 0) {
		await prisma.auditLog
			.create({
				data: {
					actorRole: 'SYSTEM',
					action: 'Device Data Synced',
					entityType: 'Data Sync',
					entityId: 'local-server',
					newValue: { files: summary.ingested, sessions: summary.sessions, trials: summary.trials }
				}
			})
			.catch(() => undefined);
	}
	return finish();
}

async function record(
	rel: string,
	kind: string,
	sha: string,
	patientCode: string | null,
	device: string | null,
	rows: number,
	status: 'ok' | 'unmatched' | 'error',
	message?: string
) {
	const note = message?.slice(0, 500) ?? null;
	const prev = await prisma.ingestedFile.findUnique({ where: { path: rel } });
	// An unmatched/errored file is re-checked on every scan. If nothing about the outcome changed, leave the row (and its
	// timestamp) alone so the log stays quiet and open dashboards are not told about "new data" that is not new.
	if (prev && prev.sha256 === sha && prev.status === status && prev.message === note && prev.rows === rows && prev.device === device && prev.patientCode === patientCode) return;
	const data = { kind, sha256: sha, patientCode, device, rows, status, message: note, ingestedAt: new Date() };
	await prisma.ingestedFile.upsert({ where: { path: rel }, update: data, create: { path: rel, ...data } });
}

type Found = Awaited<ReturnType<typeof discover>>[number];

async function processFile(f: Found, touched: Set<string>, summary: IngestSummary): Promise<FileResult> {
	const stat = await fs.stat(f.abs);
	if (stat.size > MAX_FILE_BYTES) {
		await record(f.rel, f.kind, '', f.patientFolder, null, 0, 'error', 'File is larger than 20 MB.');
		return { path: f.rel, status: 'error', message: 'File is larger than 20 MB.' };
	}
	const buf = await fs.readFile(f.abs);
	const sha = createHash('sha256').update(buf).digest('hex');

	const previous = await prisma.ingestedFile.findUnique({ where: { path: f.rel } });
	if (previous && previous.sha256 === sha && previous.status === 'ok') return { path: f.rel, status: 'unchanged' };

	const text = buf.toString('utf8');
	return f.kind === 'sessions' ? ingestSessions(f, text, sha, touched, summary) : ingestConfig(f, text, sha, touched);
}

async function findPatient(code: string | null) {
	if (!code) return null;
	return prisma.patient.findFirst({ where: { displayCode: { equals: code, mode: 'insensitive' } } });
}

const unmatched = async (f: Found, sha: string, code: string | null, device: string | null, message: string): Promise<FileResult> => {
	await record(f.rel, f.kind, sha, code, device, 0, 'unmatched', message);
	return { path: f.rel, status: 'unmatched', message };
};
const failed = async (f: Found, sha: string, code: string | null, device: string | null, message: string): Promise<FileResult> => {
	await record(f.rel, f.kind, sha, code, device, 0, 'error', message);
	return { path: f.rel, status: 'error', message };
};

/** The unit that logs the sessions: a unit of that type set up at the patient's centre, else any unit, else a new one. */
async function resolveUnit(patientId: string, typeId: string): Promise<string> {
	const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { therapist: { select: { locationId: true } } } });
	const centreId = patient?.therapist.locationId;
	const atCentre = centreId ? await prisma.device.findFirst({ where: { deviceTypeId: typeId, locationId: centreId }, orderBy: { displayCode: 'asc' }, select: { id: true } }) : null;
	if (atCentre) return atCentre.id;
	const any = await prisma.device.findFirst({ where: { deviceTypeId: typeId }, orderBy: { displayCode: 'asc' }, select: { id: true } });
	if (any) return any.id;
	const created = await prisma.device.create({
		data: { displayCode: `${typeId}-001`, deviceTypeId: typeId, serialNumber: 'AUTO-REGISTERED', status: 'Available', location: 'Local server' }
	});
	await prisma.deviceEvent.create({ data: { deviceId: created.id, eventType: 'registered', description: 'Registered automatically from uploaded training data.' } });
	return created.id;
}

async function ingestSessions(f: Found, text: string, sha: string, touched: Set<string>, summary: IngestSummary): Promise<FileResult> {
	const parsed = parseSessionsCsv(text);
	if (!parsed.user) return failed(f, sha, f.patientFolder, parsed.device, 'No ":User:" line found in sessions.csv.');
	if (parsed.user.toLowerCase() !== f.patientFolder.toLowerCase()) {
		return failed(f, sha, parsed.user, parsed.device, `The file is for "${parsed.user}" but sits in the folder "${f.patientFolder}".`);
	}
	if (!parsed.trials.length) {
		return failed(f, sha, parsed.user, parsed.device, parsed.problems[0]?.message ?? 'The file has no trial rows.');
	}

	const patient = await findPatient(parsed.user);
	const device = parsed.device ?? normalizeDevice(f.laptop);
	if (!patient) return unmatched(f, sha, parsed.user, device, `No patient with ID "${parsed.user}". Register the patient in NeuroDash first.`);
	if (!device) return failed(f, sha, parsed.user, null, 'Could not tell which training device this is.');
	const type = await prisma.deviceType.findUnique({ where: { id: device }, select: { id: true } });
	if (!type) return failed(f, sha, parsed.user, device, `"${device}" is not a device type NeuroDash knows.`);

	const unitId = await resolveUnit(patient.id, type.id);
	const [plans, games] = await Promise.all([
		prisma.therapyPlan.findMany({ where: { patientId: patient.id }, select: { id: true, status: true, startDate: true, durationDays: true } }),
		prisma.deviceGame.findMany({ select: { id: true } })
	]);
	const gameIds = new Set(games.map((g) => g.id));

	const groups = groupSessions(parsed.trials);
	let trialCount = 0;
	await prisma.$transaction(async (tx) => {
		for (const g of groups) {
			const sessionDate = utcDay(g.start);
			// Link to the plan whose window contains the session (prefer an Active one) and that plan's day row.
			const covering = plans
				.filter((p) => {
					const offset = Math.round((sessionDate.getTime() - utcDay(p.startDate).getTime()) / 86_400_000);
					return offset >= 0 && offset < p.durationDays;
				})
				.sort((a, b) => Number(b.status === 'Active') - Number(a.status === 'Active'))[0];
			let planDayLogId: string | null = null;
			if (covering) {
				const dayNumber = Math.round((sessionDate.getTime() - utcDay(covering.startDate).getTime()) / 86_400_000) + 1;
				planDayLogId = (await tx.planDayLog.findUnique({ where: { planId_dayNumber: { planId: covering.id, dayNumber } }, select: { id: true } }))?.id ?? null;
			}

			const data = {
				patientId: patient.id,
				planId: covering?.id ?? null,
				planDayLogId,
				deviceId: unitId,
				sessionNumber: g.sessionNumber,
				sessionDate,
				startTime: g.start,
				endTime: g.end,
				durationMinutes: g.durationMinutes,
				totalTargets: g.totalTargets,
				totalHits: g.totalHits,
				totalMisses: g.totalMisses,
				totalStars: g.totalStars,
				sourceDevice: device
			};
			const sourceKey = sessionSourceKey(parsed.user!, device, g);
			const session = await tx.therapySession.upsert({ where: { sourceKey }, update: data, create: { ...data, sourceKey } });

			// The file is cumulative, so the session's trials are replaced with what the file now says.
			await tx.sessionTrial.deleteMany({ where: { sessionId: session.id } });
			await tx.sessionTrial.createMany({
				data: g.trials.map((t) => ({
					sessionId: session.id,
					trialNumberSession: t.trialNumberSession,
					trialNumberDay: t.trialNumberDay,
					trialType: trialTypeFor(t.gameCode, t.trialKind),
					trialKind: t.trialKind,
					assistMode: t.assistMode,
					gameId: t.gameCode && gameIds.has(t.gameCode) ? t.gameCode : null,
					gameCode: t.gameCode,
					mechanism: t.movement,
					targets: t.targets,
					hits: t.hits,
					misses: t.misses,
					stars: t.stars,
					startTime: t.trialStart,
					stopTime: t.trialStop,
					cumulativeTargets: t.cumulativeTargets,
					cumulativeHits: t.cumulativeHits,
					cumulativeMisses: t.cumulativeMisses,
					cumulativeStars: t.cumulativeStars,
					rawDataRef: t.rawDataRef,
					durationSec: t.durationSec,
					successRate: t.successRate,
					moveTime: t.moveTime,
					reachSpeed: t.reachSpeed,
					gameParameter: t.gameParameter,
					planeAngle: t.planeAngle
				}))
			});
			trialCount += g.trials.length;
		}
	});

	summary.sessions += groups.length;
	summary.trials += trialCount;
	touched.add(patient.id);
	const note = parsed.problems.length ? `${parsed.problems.length} row(s) skipped: ${parsed.problems[0].message}` : undefined;
	await record(f.rel, 'sessions', sha, patient.displayCode, device, trialCount, 'ok', note);
	return { path: f.rel, status: 'ok', message: note };
}

async function ingestConfig(f: Found, text: string, sha: string, touched: Set<string>): Promise<FileResult> {
	const parsed = parseConfigCsv(text);
	const device = normalizeDevice(f.laptop);
	if (parsed.homerIds.length > 1) return failed(f, sha, f.patientFolder, device, `configdata.csv mixes several HomerIDs: ${parsed.homerIds.join(', ')}.`);
	if (!parsed.rows.length) return failed(f, sha, f.patientFolder, device, parsed.problems[0]?.message ?? 'The file has no configuration rows.');

	const code = parsed.homerIds[0] ?? f.patientFolder;
	if (code.toLowerCase() !== f.patientFolder.toLowerCase()) {
		return failed(f, sha, code, device, `The file is for "${code}" but sits in the folder "${f.patientFolder}".`);
	}
	const patient = await findPatient(code);
	if (!patient) return unmatched(f, sha, code, device, `No patient with ID "${code}". Register the patient in NeuroDash first.`);
	if (!device) return failed(f, sha, code, null, 'Could not tell which training device this is.');

	await prisma.$transaction(
		parsed.rows.map((r) => {
			const data = {
				endDate: r.endDate,
				totalTime: r.totalTime,
				ml: r.ml,
				ap: r.ap,
				mlap: r.mlap,
				foreArmLength: r.foreArmLength,
				upperArmLength: r.upperArmLength,
				trainingSide: r.trainingSide,
				location: r.location,
				groupName: r.group
			};
			return prisma.deviceConfig.upsert({
				where: { patientId_device_startDate: { patientId: patient.id, device, startDate: r.startDate } },
				update: data,
				create: { patientId: patient.id, device, startDate: r.startDate, ...data }
			});
		})
	);
	touched.add(patient.id);
	await record(f.rel, 'config', sha, patient.displayCode, device, parsed.rows.length, 'ok');
	return { path: f.rel, status: 'ok' };
}

/** A patient with allocated devices who has trained a session is "Ongoing" (a newly created account is "Active"). */
async function markOngoing(patientId: string) {
	const p = await prisma.patient.findUnique({ where: { id: patientId }, select: { status: true, _count: { select: { trainingDevices: true, therapySessions: true } } } });
	if (p?.status === 'Active' && p._count.trainingDevices > 0 && p._count.therapySessions > 0) {
		await prisma.patient.update({ where: { id: patientId }, data: { status: 'Ongoing' } });
	}
}

/** Plan day rows get the real minutes trained that day: a day with any training is done, otherwise missed. */
async function applyDayLogs(patientId: string) {
	const days = await prisma.therapySession.groupBy({
		by: ['planDayLogId'],
		where: { patientId, planDayLogId: { not: null }, sourceKey: { not: null } },
		_sum: { durationMinutes: true }
	});
	for (const d of days) {
		if (!d.planDayLogId) continue;
		const minutes = Number(d._sum.durationMinutes ?? 0);
		const row = await prisma.planDayLog.findUnique({ where: { id: d.planDayLogId }, select: { targetMinutes: true } });
		if (!row) continue;
		await prisma.planDayLog.update({
			where: { id: d.planDayLogId },
			data: { actualMinutes: Math.round(minutes), status: minutes > 0 ? 'done' : 'missed' }
		});
	}
}

/**
 * Once real device data flows for a patient, plan days that have passed without any training are "missed" so
 * adherence reflects reality. Patients with no ingested sessions are left alone.
 */
async function rolloverMissedDays() {
	const connected = await prisma.therapySession.findMany({ where: { sourceKey: { not: null } }, distinct: ['patientId'], select: { patientId: true } });
	if (!connected.length) return;
	await prisma.planDayLog.updateMany({
		where: {
			status: 'upcoming',
			logDate: { lt: utcDay(new Date()) },
			plan: { status: 'Active', patientId: { in: connected.map((c) => c.patientId) } }
		},
		data: { status: 'missed' }
	});
}

// ---------------------------------------------------------------- status for the Data Sync page

export async function recentIngestedFiles(take = 100) {
	return prisma.ingestedFile.findMany({ orderBy: { ingestedAt: 'desc' }, take });
}
