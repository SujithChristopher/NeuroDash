// Parsing for the CSV files the training laptops upload to the local server (localserver/s2.py):
//   sessions.csv   ":Location:/:Device:/:User:" header lines, then one row per TRIAL
//   configdata.csv one row per training configuration (HomerID, StartDate, TrainingSide, …)
// Pure functions only (no fs, no database) so they are unit-tested on their own.

/** IDs become folder names, so they are restricted to letters, digits, "-" and "_" (same rule as the local server). */
export const PATIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export function cleanId(value: string | null | undefined): string | null {
	const v = (value ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '');
	return v ? v.slice(0, 40) : null;
}

/** "PLUTO01" → "PLUTO", "mars" → "MARS". Laptops append a number to the training-device name. */
export function normalizeDevice(raw: string | null | undefined): string | null {
	const v = (raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/\d+$/, '');
	return v || null;
}

/**
 * Should a file-watcher event for this path trigger an import? Only sessions.csv / configdata.csv, and never the
 * server's partial uploads (_incoming) or backup copies. Works for Windows (\) and POSIX (/) separators.
 */
export function isWatchedUpload(relPath: string): boolean {
	const p = relPath.replace(/\\/g, '/');
	if (/(^|\/)(_incoming|backup)(\/|$)/i.test(p)) return false;
	return /(^|\/)(sessions|configdata)\.csv$/i.test(p);
}

/** RFC-4180-ish CSV: quoted fields, escaped quotes, CRLF/LF, BOM. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	const src = text.replace(/^﻿/, '');

	for (let i = 0; i < src.length; i++) {
		const c = src[i];
		if (quoted) {
			if (c === '"') {
				if (src[i + 1] === '"') {
					field += '"';
					i++;
				} else quoted = false;
			} else field += c;
		} else if (c === '"') quoted = true;
		else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && src[i + 1] === '\n') i++;
			row.push(field);
			field = '';
			if (row.some((x) => x.trim() !== '')) rows.push(row);
			row = [];
		} else field += c;
	}
	row.push(field);
	if (row.some((x) => x.trim() !== '')) rows.push(row);
	return rows;
}

/**
 * Device timestamps are wall-clock times without a zone. They are read as UTC components so a value never
 * shifts day when the server's timezone differs (the same rule the rest of the app uses for DATE columns).
 * Accepts "2026-09-28 10:56:02" and "28-09-2026 10:55:52" (and "T" separators / date-only).
 */
export function parseDeviceDate(raw: string | null | undefined): Date | null {
	const s = (raw ?? '').trim();
	if (!s) return null;
	let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
	let y: number, mo: number, d: number, h: number, mi: number, se: number;
	if (m) {
		[y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
		[h, mi, se] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
	} else {
		m = /^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
		if (!m) return null;
		[d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
		[h, mi, se] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
	}
	const t = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
	// Reject impossible dates (Feb 30 etc.) instead of letting them roll over.
	return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? t : null;
}

const num = (v: string | undefined): number | null => {
	if (v === undefined || v.trim() === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};
const int = (v: string | undefined): number | null => {
	const n = num(v);
	return n === null ? null : Math.round(n);
};

// ---------------------------------------------------------------- sessions.csv

export interface TrialRow {
	sessionNumber: number;
	sessionStart: Date;
	trialNumberDay: number | null;
	trialNumberSession: number;
	trialStart: Date | null;
	trialStop: Date | null;
	movement: string | null;
	planeAngle: number | null;
	gameCode: string | null;
	/** PLUTO's TrialType: TRAIN, SR85PCTRAIN, SR85PCCATCH… (null for devices that do not report it). */
	trialKind: string | null;
	/** PLUTO's AssistMode: AAN, ACTIVE… */
	assistMode: string | null;
	reachSpeed: number | null;
	gameParameter: number | null;
	durationSec: number | null;
	successRate: number | null;
	moveTime: number | null;
	targets: number;
	hits: number;
	misses: number;
	cumulativeTargets: number | null;
	cumulativeHits: number | null;
	cumulativeMisses: number | null;
	stars: number;
	cumulativeStars: number | null;
	rawDataRef: string | null;
}

export interface ParsedSessions {
	location: string | null;
	device: string | null;
	user: string | null;
	trials: TrialRow[];
	/** Rows that could not be used, with the reason (1-based line numbers within the file). */
	problems: { line: number; message: string }[];
}

const header = (row: string[]) => row.map((h) => h.trim().toLowerCase());

export function parseSessionsCsv(text: string): ParsedSessions {
	const out: ParsedSessions = { location: null, device: null, user: null, trials: [], problems: [] };

	// ":Key: value" lines come first, before the column header.
	const lines = text.replace(/^﻿/, '').split(/\r?\n/);
	let bodyStart = 0;
	for (; bodyStart < lines.length; bodyStart++) {
		const line = lines[bodyStart].trim();
		if (!line.startsWith(':')) {
			if (line === '') continue;
			break;
		}
		const m = /^:([^:]+):\s*(.*)$/.exec(line);
		if (!m) continue;
		const key = m[1].trim().toLowerCase();
		if (key === 'location') out.location = m[2].trim() || null;
		else if (key === 'device') out.device = normalizeDevice(m[2]);
		else if (key === 'user') out.user = cleanId(m[2]);
	}

	const rows = parseCsv(lines.slice(bodyStart).join('\n'));
	if (!rows.length) return out;
	const cols = header(rows[0]);
	const at = (...names: string[]) => {
		for (const n of names) {
			const i = cols.indexOf(n.toLowerCase());
			if (i >= 0) return i;
		}
		return -1;
	};
	const idx = {
		sn: at('SessionNumber'),
		dt: at('DateTime'),
		day: at('TrialNumberDay'),
		tns: at('TrialNumberSession'),
		ts: at('TrialStartTime'),
		te: at('TrialStopTime'),
		// MARS reports "Movement" (ML/AP/MLAP); PLUTO reports "Mechanism" (WFE/FPS/WURD).
		mv: at('Movement', 'Mechanism'),
		kind: at('TrialType'),
		assist: at('AssistMode'),
		ang: at('TrainingPlaneAngle'),
		game: at('GameName'),
		rs: at('ReachSpeed', 'GameSpeed'),
		gp: at('GameParameter'),
		gd: at('GameDuration'),
		sr: at('SuccessRate'),
		mt: at('MoveTime'),
		ct: at('CurrentTargets'),
		ch: at('CurrentHits'),
		cm: at('CurrentMisses'),
		// The device writes "Cummulative" (sic); accept the correct spelling too.
		cut: at('CummulativeTargets', 'CumulativeTargets'),
		cuh: at('CummulativeHits', 'CumulativeHits'),
		cum: at('CummulativeMisses', 'CumulativeMisses'),
		star: at('currentStar'),
		cus: at('CummulativeStars', 'CumulativeStars'),
		raw: at('RawDataFileName'),
		rawAlt: at('TrialRawDataFile')
	};
	for (const required of ['sn', 'dt', 'ct', 'ch'] as const) {
		if (idx[required] < 0) {
			out.problems.push({ line: bodyStart + 1, message: `Missing required column for "${required}".` });
			return out;
		}
	}

	rows.slice(1).forEach((r, k) => {
		const line = bodyStart + 2 + k;
		const get = (i: number) => (i >= 0 ? r[i] : undefined);
		const sessionNumber = int(get(idx.sn));
		const sessionStart = parseDeviceDate(get(idx.dt));
		const targets = int(get(idx.ct));
		const hits = int(get(idx.ch));
		if (sessionNumber === null || !sessionStart || targets === null || hits === null) {
			out.problems.push({ line, message: 'Row skipped: session number, date, targets or hits is missing or invalid.' });
			return;
		}
		const misses = int(get(idx.cm)) ?? Math.max(0, targets - hits);
		const trialStart = parseDeviceDate(get(idx.ts));
		const trialStop = parseDeviceDate(get(idx.te));
		// Therapy time is the active time the device itself reports (MoveTime). stop − start also counts pauses (minutes
		// can pass between trials) and GameDuration is only the configured length, so both are just fallbacks.
		const wall = trialStart && trialStop ? Math.round((trialStop.getTime() - trialStart.getTime()) / 1000) : null;
		// A reported 0 is treated as missing: a trial with targets and hits did take time (seen in real PLUTO data).
		const positive = (n: number | null) => (n !== null && n > 0 ? n : null);
		const durationSec = positive(int(get(idx.mt))) ?? positive(int(get(idx.gd))) ?? (wall !== null && wall > 0 && wall <= 3600 ? wall : null);
		// MARS puts the file name in RawDataFileName; PLUTO puts it in TrialRawDataFile (where MARS has the user id).
		const rawAlt = (get(idx.rawAlt) ?? '').trim();
		const rawDataRef = (get(idx.raw) ?? '').trim() || (/\.csv$/i.test(rawAlt) ? rawAlt : null);
		out.trials.push({
			sessionNumber,
			sessionStart,
			trialNumberDay: int(get(idx.day)),
			trialNumberSession: int(get(idx.tns)) ?? k + 1,
			trialStart,
			trialStop,
			movement: (get(idx.mv) ?? '').trim() || null,
			planeAngle: num(get(idx.ang)),
			gameCode: (get(idx.game) ?? '').trim() || null,
			trialKind: (get(idx.kind) ?? '').trim() || null,
			assistMode: (get(idx.assist) ?? '').trim() || null,
			reachSpeed: num(get(idx.rs)),
			gameParameter: num(get(idx.gp)),
			durationSec,
			successRate: num(get(idx.sr)),
			moveTime: num(get(idx.mt)),
			targets: Math.max(0, targets),
			hits: Math.max(0, hits),
			misses: Math.max(0, misses),
			cumulativeTargets: int(get(idx.cut)),
			cumulativeHits: int(get(idx.cuh)),
			cumulativeMisses: int(get(idx.cum)),
			stars: Math.max(0, int(get(idx.star)) ?? 0),
			cumulativeStars: int(get(idx.cus)),
			rawDataRef
		});
	});
	return out;
}

export interface SessionGroup {
	sessionNumber: number;
	start: Date;
	end: Date | null;
	durationMinutes: number;
	totalTargets: number;
	totalHits: number;
	totalMisses: number;
	totalStars: number;
	trials: TrialRow[];
}

/** One laptop "session" is many trial rows; roll them up into the totals the app stores per session. */
export function groupSessions(trials: TrialRow[]): SessionGroup[] {
	const by = new Map<number, TrialRow[]>();
	for (const t of trials) by.set(t.sessionNumber, [...(by.get(t.sessionNumber) ?? []), t]);

	return [...by.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([sessionNumber, rows]) => {
			const ordered = [...rows].sort((a, b) => a.trialNumberSession - b.trialNumberSession);
			const start = new Date(Math.min(...ordered.map((r) => r.sessionStart.getTime())));
			const stops = ordered.map((r) => r.trialStop?.getTime()).filter((x): x is number => x != null);
			const seconds = ordered.reduce((s, r) => s + (r.durationSec ?? 0), 0);
			return {
				sessionNumber,
				start,
				end: stops.length ? new Date(Math.max(...stops)) : null,
				durationMinutes: Math.round((seconds / 60) * 100) / 100,
				totalTargets: ordered.reduce((s, r) => s + r.targets, 0),
				totalHits: ordered.reduce((s, r) => s + r.hits, 0),
				totalMisses: ordered.reduce((s, r) => s + r.misses, 0),
				totalStars: ordered.reduce((s, r) => s + r.stars, 0),
				trials: ordered
			};
		});
}

/**
 * Trials named AROM/PROM/APROM (as the game or the trial kind) are range-of-motion checks; everything else, including
 * PLUTO's TRAIN / SR85PCTRAIN / SR85PCCATCH, is a game trial.
 */
export function trialTypeFor(gameCode: string | null, trialKind: string | null = null): 'GAME' | 'AROM' | 'PROM' | 'APROM' {
	for (const v of [gameCode, trialKind]) {
		const x = (v ?? '').toUpperCase();
		if (x === 'AROM' || x === 'PROM' || x === 'APROM') return x;
	}
	return 'GAME';
}

/** Stable identity of a session across re-uploads of the same (cumulative) file. */
export function sessionSourceKey(user: string, device: string, g: Pick<SessionGroup, 'sessionNumber' | 'start'>): string {
	return `${user}:${device}:${g.sessionNumber}:${g.start.toISOString()}`;
}

// ---------------------------------------------------------------- configdata.csv

export interface ConfigRow {
	homerId: string | null;
	startDate: Date;
	endDate: Date | null;
	totalTime: number | null;
	ml: number | null;
	ap: number | null;
	mlap: number | null;
	foreArmLength: number | null;
	upperArmLength: number | null;
	trainingSide: string | null;
	location: string | null;
	group: string | null;
}

export interface ParsedConfig {
	rows: ConfigRow[];
	/** Every distinct HomerID in the file (the local server rejects files that mix several). */
	homerIds: string[];
	problems: { line: number; message: string }[];
}

export function parseConfigCsv(text: string): ParsedConfig {
	const out: ParsedConfig = { rows: [], homerIds: [], problems: [] };
	const rows = parseCsv(text);
	if (!rows.length) return out;
	const cols = header(rows[0]);
	const at = (n: string) => cols.indexOf(n.toLowerCase());
	const i = {
		id: at('HomerID'),
		sd: at('StartDate'),
		ed: at('EndDate'),
		tt: at('TotalTime'),
		ml: at('ML'),
		ap: at('AP'),
		mlap: at('MLAP'),
		fl: at('ForeArmLength'),
		ul: at('UpperArmLength'),
		side: at('TrainingSide'),
		loc: at('Location'),
		grp: at('Group')
	};
	if (i.id < 0 || i.sd < 0) {
		out.problems.push({ line: 1, message: 'configdata.csv needs HomerID and StartDate columns.' });
		return out;
	}
	const ids = new Set<string>();
	rows.slice(1).forEach((r, k) => {
		const get = (x: number) => (x >= 0 ? r[x] : undefined);
		const startDate = parseDeviceDate(get(i.sd));
		if (!startDate) {
			out.problems.push({ line: k + 2, message: 'Row skipped: StartDate is missing or invalid.' });
			return;
		}
		const id = cleanId(get(i.id));
		if (id) ids.add(id);
		out.rows.push({
			homerId: id,
			startDate,
			endDate: parseDeviceDate(get(i.ed)),
			totalTime: int(get(i.tt)),
			ml: int(get(i.ml)),
			ap: int(get(i.ap)),
			mlap: int(get(i.mlap)),
			foreArmLength: num(get(i.fl)),
			upperArmLength: num(get(i.ul)),
			trainingSide: (get(i.side) ?? '').trim() || null,
			location: (get(i.loc) ?? '').trim() || null,
			group: (get(i.grp) ?? '').trim() || null
		});
	});
	out.homerIds = [...ids];
	return out;
}
