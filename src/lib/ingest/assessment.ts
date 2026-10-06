// Parses one robotic-assessment package (what a device's assessment software wrote for one limb and timepoint, e.g. right/A0).
// Pure: it gets the files as text and returns plain data. No fs, no database.
//
//   PLUTO  <subject>_<limb>_<TP>_details.json  every mechanism (FPS, WFE, WURD, HOC) and task (AROM, PROM, APROM, DISC) with
//                                              its attempts and range of motion in degrees; the *_summary-*.csv files add detail
//   MARS   <session>/ml-rom.csv, ap-rom.csv, mlap-rom.csv   reach range per trial, in metres
//          <session>/armweight.csv, discrete-reach.csv      which targets were completed
//   <TP>.locked                                "Locked on 2026-07-07 12:30:55": the assessment is finished
import { parseCsv } from './parse';

export interface AssessmentFile {
	/** Relative to the package folder, forward slashes */
	path: string;
	text: string;
}

export type ResultStatus = 'Complete' | 'Rejected' | 'Skipped' | 'Excluded';
/** Active: the patient moved it themselves. Passive: only moved by the device. None: not measured. */
export type Ability = 'Active' | 'Passive' | 'None';

export interface ParsedResult {
	mechanism: string;
	task: string;
	status: ResultStatus;
	unit: 'deg' | 'cm' | null;
	romMin: number | null;
	romMax: number | null;
	romRange: number | null;
	attempts: number;
	comment: string | null;
	extra: Record<string, unknown> | null;
}

export interface ParsedAssessment {
	device: 'PLUTO' | 'MARS';
	limb: string | null;
	timepoint: string | null;
	assessedAt: Date | null;
	lockedAt: Date | null;
	mechanisms: { code: string; status: string; ability: Ability }[];
	results: ParsedResult[];
}

export const PLUTO_TASKS = ['AROM', 'PROM', 'APROM', 'DISC'] as const;
export const TIMEPOINT_PATTERN = /^[A-Za-z]\d{1,2}$/;

const base = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** "Locked on 2026-07-07 12:30:55" → a Date (the device's clock, read as UTC like every other time here) */
export function parseLocked(text: string): Date | null {
	const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text);
	return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

/** "20260917_142835" (PLUTO task time) → a Date */
function parseTaskTime(s: unknown): Date | null {
	const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(String(s ?? ''));
	return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

/** "2026-07-07 12:21:09.215440" → a Date */
function parseStamp(s: string | undefined): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec((s ?? '').trim());
	return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

/** The first data row of a CSV as { column: value } */
function firstRow(text: string): Record<string, string> | null {
	const rows = parseCsv(text);
	if (rows.length < 2) return null;
	return Object.fromEntries(rows[0].map((h, i) => [h.trim(), (rows[1][i] ?? '').trim()]));
}

const asNum = (v: string | undefined) => {
	const n = Number(v);
	return v != null && v !== '' && Number.isFinite(n) ? n : null;
};

// ------------------------------------------------------------------------------------------------------------- PLUTO

interface PlutoAttempt {
	tasktime?: string | null;
	summaryfile?: string | null;
	taskcomment?: string | null;
	status?: string;
	rom?: number[] | null;
}

/** What the summary CSV of an accepted attempt adds (rest position and cycles for AROM, start position and time for the others). */
function plutoExtra(task: string, summary: string | null): Record<string, unknown> | null {
	const r = summary ? firstRow(summary) : null;
	if (!r) return null;
	if (task === 'AROM') return { restPosition: asNum(r.rest_position), cycles: asNum(r.cycles_completed) };
	if (task === 'PROM') return { startPosition: asNum(r.startpos) };
	if (task === 'APROM') return { startPosition: asNum(r.startpos), durationSec: asNum(r.duration), assist: r.apromtype || null };
	return null;
}

const asStatus = (s: unknown): ResultStatus => (s === 'Complete' || s === 'Rejected' || s === 'Skipped' || s === 'Excluded' ? s : 'Skipped');

function parsePluto(files: AssessmentFile[], detailsText: string): ParsedAssessment {
	const details = JSON.parse(detailsText) as Record<string, unknown>;
	const byName = new Map(files.map((f) => [base(f.path), f.text]));
	const times: Date[] = [];
	const results: ParsedResult[] = [];
	const mechanisms: ParsedAssessment['mechanisms'] = [];

	for (const [code, value] of Object.entries(details)) {
		if (!value || typeof value !== 'object' || !('tasks' in value)) continue; // subj, mode, limbs...
		const m = value as { status?: string; tasks: Record<string, PlutoAttempt[]> };
		const ok = new Set<string>();

		for (const [task, attempts] of Object.entries(m.tasks ?? {})) {
			const list = Array.isArray(attempts) ? attempts : [];
			const real = list.filter((a) => a.tasktime);
			for (const a of real) {
				const d = parseTaskTime(a.tasktime);
				if (d) times.push(d);
			}
			const complete = [...list].reverse().find((a) => a.status === 'Complete');
			const shown = complete ?? list[list.length - 1] ?? null;
			if (!shown) continue;
			const [lo, hi] = Array.isArray(shown.rom) ? [num(shown.rom[0]), num(shown.rom[1])] : [null, null];
			const status: ResultStatus = complete ? 'Complete' : asStatus(shown.status);
			const hasRom = !!complete && lo != null && hi != null;
			if (status === 'Complete') ok.add(task);
			results.push({
				mechanism: code,
				task,
				status,
				unit: hasRom && code !== 'HOC' ? 'deg' : null, // hand open / close is a displacement, not an angle
				romMin: hasRom ? round(lo!) : null,
				romMax: hasRom ? round(hi!) : null,
				romRange: hasRom ? round(hi! - lo!) : null,
				attempts: real.length || 1,
				comment: shown.taskcomment?.trim() || null,
				extra: complete ? plutoExtra(task, byName.get(base(complete.summaryfile ?? '')) ?? null) : null
			});
		}
		mechanisms.push({ code, status: m.status ?? 'Unknown', ability: ok.has('AROM') ? 'Active' : ok.has('PROM') || ok.has('APROM') ? 'Passive' : 'None' });
	}

	const info = files.find((f) => base(f.path) === 'subject_info.json');
	let limb = typeof details.limb === 'string' ? details.limb : null;
	let timepoint: string | null = null;
	if (info) {
		try {
			const i = JSON.parse(info.text) as Record<string, unknown>;
			limb = typeof i.limb === 'string' ? i.limb : limb;
			timepoint = typeof i.timepoint === 'string' ? i.timepoint : null;
		} catch {
			/* a malformed subject_info.json is not fatal: the upload header names the limb and timepoint */
		}
	}
	return {
		device: 'PLUTO',
		limb: limb?.toLowerCase() ?? null,
		timepoint,
		assessedAt: times.length ? new Date(Math.min(...times.map((d) => d.getTime()))) : null,
		lockedAt: null,
		mechanisms,
		results
	};
}

// -------------------------------------------------------------------------------------------------------------- MARS

const MARS_FILES: Record<string, 'ML' | 'AP' | 'MLAP'> = { 'ml-rom.csv': 'ML', 'ap-rom.csv': 'AP', 'mlap-rom.csv': 'MLAP' };

/** The rows of a "Name,Header..." table that follows a title line, up to the next blank line. */
function tableAfter(text: string, title: RegExp): Record<string, string>[] {
	const lines = text.split(/\r?\n/);
	const at = lines.findIndex((l) => title.test(l));
	if (at < 0) return [];
	const header = (lines[at + 1] ?? '').split(',').map((h) => h.trim());
	const rows: Record<string, string>[] = [];
	for (let i = at + 2; i < lines.length && lines[i].trim() !== ''; i++) {
		const cells = lines[i].split(',');
		rows.push(Object.fromEntries(header.map((h, k) => [h, (cells[k] ?? '').trim()])));
	}
	return rows;
}

function targetCheck(mechanism: 'ARMWEIGHT' | 'DISCRETE', rows: Record<string, string>[]): ParsedResult | null {
	if (!rows.length) return null;
	const targets = rows.map((r) => ({ name: r.Target, completed: /^yes$/i.test(r.Completed ?? '') }));
	const done = targets.filter((t) => t.completed).length;
	return {
		mechanism,
		task: 'CHECK',
		status: done === targets.length ? 'Complete' : 'Rejected',
		unit: null,
		romMin: null,
		romMax: null,
		romRange: null,
		attempts: 1,
		comment: `${done} of ${targets.length} targets completed`,
		extra: { targets }
	};
}

function parseMars(files: AssessmentFile[]): ParsedAssessment {
	const times: Date[] = [];
	type Trial = { session: string; trial: string; mlCm: number; apCm: number };
	// Each file ends with AVERAGE and MAXIMUM rows the device computed itself: they are the headline figures
	const data: Record<'ML' | 'AP' | 'MLAP', { trials: Trial[]; max: { ml: number; ap: number }[]; avg: { ml: number; ap: number }[] }> = {
		ML: { trials: [], max: [], avg: [] },
		AP: { trials: [], max: [], avg: [] },
		MLAP: { trials: [], max: [], avg: [] }
	};
	let timepoint: string | null = null;
	const results: ParsedResult[] = [];

	for (const f of files) {
		const movement = MARS_FILES[base(f.path).toLowerCase()];
		if (!movement) continue;
		const rows = parseCsv(f.text);
		if (rows.length < 2) continue;
		const head = rows[0].map((h) => h.trim());
		const col = (name: string) => head.indexOf(name);
		const session = f.path.includes('/') ? f.path.split('/')[0] : '';
		for (const r of rows.slice(1)) {
			const ml = asNum(r[col('MLRange')]);
			const ap = asNum(r[col('APRange')]);
			if (ml == null || ap == null) continue;
			const label = (r[col('TrialNumber')] ?? '').trim();
			const cm = { ml: round(ml * 100, 1), ap: round(ap * 100, 1) };
			if (/^maximum$/i.test(label)) data[movement].max.push(cm);
			else if (/^average$/i.test(label)) data[movement].avg.push(cm);
			else {
				data[movement].trials.push({ session, trial: label, mlCm: cm.ml, apCm: cm.ap });
				const d = parseStamp(r[col('DateTime')]);
				if (d) times.push(d);
			}
			timepoint ??= (r[col('TimePoint')] ?? '').trim() || null;
		}
	}

	const mechanisms: ParsedAssessment['mechanisms'] = [];
	const mean = (xs: number[]) => (xs.length ? round(xs.reduce((n, x) => n + x, 0) / xs.length, 1) : null);
	for (const code of ['ML', 'AP', 'MLAP'] as const) {
		const { trials: t, max, avg } = data[code];
		if (!t.length) continue;
		// The best range reached (the device's MAXIMUM over each session, else the best trial) and the typical one
		const best = (key: 'ml' | 'ap') => Math.max(...(max.length ? max.map((x) => x[key]) : t.map((x) => (key === 'ml' ? x.mlCm : x.apCm))));
		const typical = (key: 'ml' | 'ap') => mean(avg.length ? avg.map((x) => x[key]) : t.map((x) => (key === 'ml' ? x.mlCm : x.apCm)));
		const mlCm = best('ml');
		const apCm = best('ap');
		// The movement's own direction is its headline: sideways (ML) and forwards (AP); a combined reach shows both
		const main = code === 'AP' ? apCm : mlCm;
		results.push({
			mechanism: code,
			task: 'ROM',
			status: main > 0 ? 'Complete' : 'Rejected',
			unit: 'cm',
			romMin: null,
			romMax: null,
			romRange: main,
			attempts: t.length,
			comment: null,
			extra: { mlCm, apCm, avgMlCm: typical('ml'), avgApCm: typical('ap'), sessions: new Set(t.map((x) => x.session)).size, trials: t.slice(0, 60) }
		});
		mechanisms.push({ code, status: main > 0 ? 'Complete' : 'Rejected', ability: main > 0 ? 'Passive' : 'None' });
	}

	// Which targets were reached (arm weight support, discrete reaching): shown as a tick list, no graph
	const arm = files.find((f) => base(f.path).toLowerCase() === 'armweight.csv');
	const disc = files.find((f) => base(f.path).toLowerCase() === 'discrete-reach.csv');
	for (const [code, file, title] of [
		['ARMWEIGHT', arm, /^Target Positions/i],
		['DISCRETE', disc, /^Target Summary/i]
	] as const) {
		if (!file) continue;
		const r = targetCheck(code, tableAfter(file.text, title));
		if (r) {
			results.push(r);
			mechanisms.push({ code, status: r.status, ability: 'Passive' });
			const stamp = /^Timestamp,(.+)$/m.exec(file.text);
			const d = parseStamp(stamp?.[1]);
			if (d) times.push(d);
		}
	}

	return {
		device: 'MARS',
		limb: null,
		timepoint,
		assessedAt: times.length ? new Date(Math.min(...times.map((d) => d.getTime()))) : null,
		lockedAt: null,
		mechanisms,
		results
	};
}

// ------------------------------------------------------------------------------------------------------------- entry

/** Detects the device from the files and parses the package; an error message when it is neither a PLUTO nor a MARS package. */
export function parseAssessmentPackage(files: AssessmentFile[]): ParsedAssessment | { error: string } {
	const locked = files.find((f) => /\.locked$/i.test(f.path));
	const lockedAt = locked ? parseLocked(locked.text) : null;
	try {
		const details = files.find((f) => /_details\.json$/i.test(f.path));
		let parsed: ParsedAssessment;
		if (details) parsed = parsePluto(files, details.text);
		else if (files.some((f) => base(f.path).toLowerCase() in MARS_FILES || /^(armweight|discrete-reach)\.csv$/i.test(base(f.path)))) parsed = parseMars(files);
		else return { error: 'No PLUTO details.json or MARS range-of-motion files in the package.' };
		if (!parsed.results.length) return { error: 'The package holds no assessment results.' };
		parsed.lockedAt = lockedAt;
		parsed.assessedAt ??= lockedAt;
		return parsed;
	} catch (e) {
		return { error: `Could not read the assessment: ${e instanceof Error ? e.message : String(e)}` };
	}
}
