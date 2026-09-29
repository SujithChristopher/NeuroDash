import { DEVICE_TYPES, GAME_LABELS, ROOMS, SCALES, typeOf, type ScaleId } from './reference';
import { USERS, usersByRole, ownerOfType } from './users';
import { RNG, rand, randInt, pick, clamp, gauss, round1, DAY, TODAY, NOW, addDays, daysAgo, resetSeed, uid } from './seed';

export interface Unit {
	id: string;
	typeId: string;
	serial: string;
	room: string;
	firmware: string;
	commissioned: Date;
	lastCal: Date;
	calInterval: number;
	lastSync: Date;
	errBase: number;
	latBase: number;
	driftRate: number;
	anomaly?: boolean;
}

export interface PlanHistoryEntry {
	date: Date;
	by: string;
	text: string;
}
export interface Plan {
	typeId: string;
	unitId: string | null;
	mechanisms: string[];
	games: string[];
	minutes: number;
	daysPerWeek: number;
	weeks: number;
	start: Date;
	goal: string;
	history: PlanHistoryEntry[];
}
export interface Note {
	date: Date;
	by: string;
	text: string;
}
export interface Patient {
	id: string;
	code: string;
	name: string;
	age: number;
	sex: 'F' | 'M';
	diagnosis: string;
	side: string;
	onsetDays: number;
	admitted: Date;
	status: 'Active' | 'New' | 'Discharged';
	therapistId: string;
	consultantId: string;
	scale: ScaleId;
	profile: string;
	mrn: string;
	rate: number;
	adhP: number;
	plan: Plan | null;
	notes: Note[];
	slot: { time: Date; state: 'Done' | 'In progress' | 'Upcoming' } | null;
	discharged?: Date;
}

export interface Session {
	id: string;
	patientId: string;
	unitId: string;
	typeId: string;
	date: Date;
	minutes: number;
	trials: number;
	accuracy: number;
	stars: number;
	game: string;
	mechanism: string;
	rom: number;
	trackErr: number;
	latency: number;
	peakOut: number;
	flags: number;
	disconnects: number;
	today?: boolean;
}

export interface Assessment {
	id: string;
	patientId: string;
	date: Date;
	scale: ScaleId;
	score: number;
	by: string;
	note: string;
}

export type FaultStatus = 'Reported' | 'Investigating' | 'Resolved' | 'Cleared for use';
export interface FaultLogEntry {
	date: Date;
	by: string;
	text: string;
}
export interface Fault {
	id: string;
	unitId: string;
	severity: 'Critical' | 'High' | 'Medium' | 'Low';
	status: FaultStatus;
	opened: Date;
	desc: string;
	reportedBy: string;
	log: FaultLogEntry[];
}

export interface DeviceRequest {
	id: string;
	patientId: string;
	typeId: string;
	requestedBy: string;
	date: Date;
	status: 'Pending' | 'Assigned' | 'Declined';
	unitId: string | null;
	note: string;
}

export interface AuditEntry {
	id: string;
	date: Date;
	userId: string;
	action: string;
	target: string;
}

export interface DB {
	units: Unit[];
	patients: Patient[];
	sessions: Session[];
	assessments: Assessment[];
	faults: Fault[];
	requests: DeviceRequest[];
	audit: AuditEntry[];
}

const FIRST = [
	'Suresh', 'Meenal', 'Rajiv', 'Farhana', 'Vikrant', 'Ishita', 'Devendra', 'Kavya', 'Aslam', 'Rohit',
	'Sunita', 'Aarav', 'Priyanka', 'Naveen', 'Zoya', 'Harish', 'Lakshmi', 'Gautam', 'Nisha', 'Imran',
	'Deepa', 'Kiran', 'Tara', 'Mohan'
];
const LAST = ['R.', 'K.', 'T.', 'D.', 'B.', 'S.', 'P.', 'N.', 'M.', 'J.', 'V.', 'G.'];
const DIAG = [
	{ label: 'Ischaemic stroke, right MCA', side: 'Left' },
	{ label: 'Ischaemic stroke, left MCA', side: 'Right' },
	{ label: 'Haemorrhagic stroke, basal ganglia', side: 'Right' },
	{ label: 'Haemorrhagic stroke, thalamic', side: 'Left' },
	{ label: 'Traumatic brain injury', side: 'Bilateral' },
	{ label: 'Ischaemic stroke, pontine', side: 'Left' }
];
const PROFILES: Record<string, { rate: [number, number]; adh: [number, number] }> = {
	good: { rate: [3.5, 5.5], adh: [0.85, 0.98] },
	moderate: { rate: [1.8, 3.2], adh: [0.68, 0.86] },
	plateau: { rate: [0.2, 0.9], adh: [0.6, 0.8] },
	lowadh: { rate: [0.8, 2.0], adh: [0.35, 0.55] },
	decline: { rate: [1.5, 2.5], adh: [0.55, 0.75] }
};
const PROFILE_SEQ = [
	'good', 'moderate', 'plateau', 'good', 'moderate', 'lowadh', 'good', 'decline', 'moderate', 'good',
	'plateau', 'moderate', 'good', 'lowadh', 'moderate', 'good', 'moderate', 'good'
];
const TYPE_SEQ = [
	'PLUTO', 'MARS', 'ORION', 'VEGA', 'PLUTO', 'COSMOS', 'ATLAS', 'MARS', 'PLUTO', 'ORION', 'VEGA', 'COSMOS',
	'MARS', 'PLUTO', 'ATLAS', 'ORION', 'PLUTO', 'MARS', 'ORION', 'PLUTO', 'VEGA', 'MARS', 'PLUTO', 'COSMOS'
];

function generateUnits(): Unit[] {
	const units: Unit[] = [];
	DEVICE_TYPES.forEach((t) => {
		for (let i = 1; i <= t.units; i++) {
			units.push({
				id: t.id + '-0' + i,
				typeId: t.id,
				serial: 'SN-' + t.id.slice(0, 2) + randInt(20400, 20999),
				room: t.id === 'VEGA' ? 'Gait & Balance Lab' : pick(ROOMS.slice(0, 3)),
				firmware: 'v' + pick(['2.3.1', '2.3.1', '2.4.0', '2.2.7']),
				commissioned: addDays(TODAY, -randInt(200, 640)),
				lastCal: addDays(TODAY, -randInt(8, 50)),
				calInterval: 60,
				lastSync: new Date(NOW.getTime() - randInt(5, 90) * 60000),
				errBase: rand(1.0, 1.6),
				latBase: rand(20, 28),
				driftRate: rand(0.02, 0.05)
			});
		}
	});
	const unitOf = (id: string) => units.find((u) => u.id === id)!;
	unitOf('VEGA-01').lastCal = addDays(TODAY, -74);
	unitOf('VEGA-01').driftRate = 0.07;
	unitOf('COSMOS-01').lastSync = new Date(NOW.getTime() - 26 * 3600000);
	unitOf('MARS-02').anomaly = true;
	unitOf('PLUTO-03').lastCal = addDays(TODAY, -57);
	return units;
}

function generatePatients(units: Unit[]): Patient[] {
	const patients: Patient[] = [];
	const THERAPISTS = usersByRole('therapist');
	for (let i = 0; i < 24; i++) {
		const status: Patient['status'] = i < 18 ? 'Active' : i < 21 ? 'New' : 'Discharged';
		const typeId = TYPE_SEQ[i];
		const t = typeOf(typeId)!;
		const dg = typeId === 'VEGA' ? pick(DIAG) : DIAG[i % DIAG.length];
		const profName = status === 'Discharged' ? 'good' : status === 'New' ? 'moderate' : PROFILE_SEQ[i];
		const prof = PROFILES[profName];
		const admitted =
			status === 'Active'
				? addDays(TODAY, -randInt(16, 62))
				: status === 'New'
					? addDays(TODAY, -randInt(0, 4))
					: addDays(TODAY, -randInt(90, 130));
		const p: Patient = {
			id: 'PT-' + (1001 + i),
			code: 'P-' + String(randInt(100, 999)) + String.fromCharCode(65 + i),
			name: FIRST[i] + ' ' + pick(LAST),
			age: randInt(38, 78),
			sex: pick(['F', 'M']),
			diagnosis: dg.label,
			side: dg.side,
			onsetDays: randInt(14, 120),
			admitted,
			status,
			therapistId: THERAPISTS[i % 4].id,
			consultantId: i % 2 ? 'U-C2' : 'U-C1',
			scale: t.scale,
			profile: profName,
			mrn: String(4000000 + i * 7919 + 31337).replace(/(\d{3})(\d{4})/, '$1-$2'),
			rate: rand(prof.rate[0], prof.rate[1]),
			adhP: rand(prof.adh[0], prof.adh[1]),
			plan: null,
			notes: [],
			slot: null
		};
		if (status === 'Discharged') p.discharged = addDays(admitted, randInt(45, 60));
		const typeUnits = units.filter((u) => u.typeId === typeId);
		if (status !== 'New' || i === 18 || i === 19) {
			const start = status === 'New' ? addDays(TODAY, 1) : addDays(admitted, randInt(2, 4));
			p.plan = {
				typeId,
				unitId:
					status === 'New'
						? i === 18
							? typeUnits[typeUnits.length - 1].id
							: null
						: pick(typeUnits.length > 2 ? typeUnits.slice(0, -1) : typeUnits).id,
				mechanisms: t.mechanisms.slice(0, randInt(2, t.mechanisms.length)),
				games: t.games.slice(0, randInt(1, t.games.length)),
				minutes: pick([30, 30, 40, 45, 25]),
				daysPerWeek: 6,
				weeks: 10,
				start,
				goal:
					typeId === 'VEGA'
						? 'Independent sit-to-stand and safer weight transfer'
						: 'Improve reach and grasp for self-care tasks',
				history: [{ date: start, by: p.therapistId, text: 'Plan created: ' + t.name + ', ' + '{MIN} min/day' }]
			};
			p.plan.history[0].text = p.plan.history[0].text.replace('{MIN}', String(p.plan.minutes));
		}
		patients.push(p);
	}
	patients
		.filter((p) => p.plan && p.plan.typeId === 'ATLAS')
		.forEach((p) => (p.plan!.unitId = 'ATLAS-01'));

	patients
		.filter((p) => p.status === 'Active')
		.forEach((p) => {
			const n = p.profile === 'plateau' || p.profile === 'lowadh' ? 2 : randInt(0, 1);
			let d = p.plan!.start;
			for (let k = 0; k < n; k++) {
				d = addDays(d, randInt(6, 14));
				if (d >= TODAY) break;
				const old = p.plan!.minutes;
				const t = typeOf(p.plan!.typeId)!;
				const opt = randInt(0, 2);
				let text: string;
				if (opt === 0) {
					p.plan!.minutes = Math.min(60, old + 10);
					text = 'Daily minutes ' + old + ' → ' + p.plan!.minutes;
				} else if (opt === 1) {
					const g = t.games.find((x) => !p.plan!.games.includes(x)) || t.games[0];
					if (!p.plan!.games.includes(g)) p.plan!.games.push(g);
					text = 'Added game: ' + GAME_LABELS[g];
				} else {
					const m = t.mechanisms.find((x) => !p.plan!.mechanisms.includes(x)) || t.mechanisms[0];
					if (!p.plan!.mechanisms.includes(m)) p.plan!.mechanisms.push(m);
					text = 'Added movement: ' + m;
				}
				p.plan!.history.push({ date: d, by: p.therapistId, text });
			}
		});
	return patients;
}

function generateAssessments(patients: Patient[]): Assessment[] {
	const assessments: Assessment[] = [];
	patients.forEach((p) => {
		const sc = SCALES[p.scale];
		if (p.status === 'New') {
			if (p.id !== 'PT-1021') {
				assessments.push({
					id: uid('AS'),
					patientId: p.id,
					date: addDays(p.admitted, 0),
					scale: p.scale,
					score: randInt(14, 30),
					by: p.therapistId,
					note: 'Baseline'
				});
			}
			return;
		}
		const end = p.status === 'Discharged' ? p.discharged! : TODAY;
		let score = p.scale === 'BBS' ? randInt(18, 30) : randInt(12, 34);
		const dates: Date[] = [];
		for (let d = addDays(p.admitted, 1); d <= end; d = addDays(d, 14)) dates.push(d);
		dates.forEach((d, k) => {
			if (k > 0) {
				let inc = p.rate + gauss() * 0.8;
				if (p.profile === 'decline' && k === dates.length - 1) inc = -rand(2, 3.5);
				score = clamp(score + inc, 0, sc.max);
			}
			assessments.push({
				id: uid('AS'),
				patientId: p.id,
				date: d,
				scale: p.scale,
				score: Math.round(score),
				by: p.therapistId,
				note: k === 0 ? 'Baseline' : k === dates.length - 1 && p.status === 'Discharged' ? 'Discharge' : 'Review'
			});
		});
	});
	return assessments;
}

function makeSession(p: Patient, units: Unit[], d: Date, idx: number, totalDays: number): Session {
	const u = units.find((x) => x.id === p.plan!.unitId)!;
	const t = typeOf(p.plan!.typeId)!;
	const minutes = Math.round(p.plan!.minutes * rand(0.7, 1.1));
	const prog = clamp(idx / Math.max(20, totalDays), 0, 1);
	const agoD = daysAgo(d);
	const drift = u.anomaly && agoD < 10 ? (10 - agoD) * 0.12 : 0;
	const trials = Math.round(minutes * rand(1.5, 2.3));
	const accuracy = clamp(52 + prog * 26 * (p.rate / 3) + gauss() * 6, 20, 98);
	const flags = u.anomaly && agoD < 10 ? randInt(1, 4) : RNG() < 0.05 ? 1 : 0;
	return {
		id: uid('SS'),
		patientId: p.id,
		unitId: u.id,
		typeId: t.id,
		date: d,
		minutes,
		trials,
		accuracy: round1(accuracy),
		stars: Math.round((trials * accuracy) / 100 / 3),
		game: pick(p.plan!.games),
		mechanism: pick(p.plan!.mechanisms),
		rom: round1(clamp(35 + prog * 25 * (p.rate / 3) + gauss() * 4, 10, 120)),
		trackErr: round1(u.errBase + Math.abs(gauss()) * 0.35 + drift),
		latency: Math.round(u.latBase + gauss() * 3 + (u.anomaly && agoD < 10 ? 6 : 0)),
		peakOut: round1(t.outLimit * clamp(rand(0.42, 0.8) + (u.anomaly && agoD < 5 ? 0.15 : 0), 0.2, 0.99)),
		flags,
		disconnects: RNG() < 0.04 ? 1 : 0
	};
}

function generateSessions(patients: Patient[], units: Unit[]): Session[] {
	const sessions: Session[] = [];
	patients
		.filter((p) => p.plan && p.status !== 'New')
		.forEach((p) => {
			const end = p.status === 'Discharged' ? p.discharged! : addDays(TODAY, -1);
			const total = Math.round((+end - +p.plan!.start) / DAY);
			let idx = 0;
			for (let d = new Date(p.plan!.start); d <= end; d = addDays(d, 1)) {
				idx++;
				if (d.getDay() === 0) continue;
				let adh = p.adhP;
				if (p.profile === 'lowadh' && daysAgo(d) < 7) adh -= 0.1;
				if (daysAgo(d) === 1 && (p.profile === 'lowadh' || p.id === 'PT-1003')) adh = 0;
				if (RNG() > adh) continue;
				const pi = +p.id.slice(3) - 1001;
				const at = new Date(d.getTime() + (9 * 60 + ((pi * 75) % 450) + 35 + ((idx * 7) % 15)) * 60000);
				sessions.push(makeSession(p, units, at, idx, total));
			}
		});

	const THERAPISTS = usersByRole('therapist');
	THERAPISTS.forEach((th) => {
		const mine = patients.filter((p) => p.status === 'Active' && p.therapistId === th.id);
		const doneN = Math.ceil(mine.length * 0.4);
		mine.forEach((p, k) => {
			const t = new Date(TODAY);
			t.setHours(9 + Math.floor(k * 1.25), (k * 75) % 60, 0, 0);
			p.slot = { time: t, state: k < doneN ? 'Done' : k === doneN ? 'In progress' : 'Upcoming' };
			if (k < doneN && p.plan!.unitId !== 'ATLAS-01') {
				const s = makeSession(p, units, new Date(t), 99, 100);
				s.date = new Date(t.getTime() + 35 * 60000);
				s.today = true;
				sessions.push(s);
			}
		});
	});
	sessions.sort((a, b) => +a.date - +b.date);
	return sessions;
}

const FAULT_STEPS: FaultStatus[] = ['Reported', 'Investigating', 'Resolved', 'Cleared for use'];

function generateFaults(units: Unit[]): Fault[] {
	const faults: Fault[] = [];
	const unitOf = (id: string) => units.find((u) => u.id === id)!;
	function addFault(
		unitId: string,
		severity: Fault['severity'],
		status: FaultStatus,
		hoursAgo: number,
		desc: string,
		reportedBy: string
	) {
		const opened = new Date(NOW.getTime() - hoursAgo * 3600000);
		const f: Fault = {
			id: uid('FLT'),
			unitId,
			severity,
			status,
			opened,
			desc,
			reportedBy,
			log: [{ date: opened, by: reportedBy, text: 'Reported: ' + desc }]
		};
		const eng = ownerOfType(unitOf(unitId).typeId)!;
		const steps = FAULT_STEPS.indexOf(status);
		for (let k = 1; k <= steps; k++) {
			f.log.push({ date: new Date(opened.getTime() + k * 20 * 3600000), by: eng.id, text: FAULT_STEPS[k] });
		}
		faults.push(f);
	}
	addFault('ATLAS-01', 'Critical', 'Reported', 5, 'Motor overheating during shoulder abduction; safety stop triggered', 'U-T3');
	addFault('ORION-01', 'Medium', 'Investigating', 50, 'Grip force sensor intermittently reads zero', 'U-T2');
	addFault('MARS-02', 'Low', 'Reported', 20, 'Tracking error above normal range for 5 sessions (auto-detected)', 'system');
	addFault('COSMOS-01', 'Low', 'Reported', 26, 'No data sync for 26 h — check network link', 'system');
	addFault('PLUTO-02', 'High', 'Resolved', 120, 'Handle loose; play in wrist axis', 'U-T1');
	addFault('VEGA-02', 'Medium', 'Cleared for use', 300, 'Force plate zero offset after move', 'U-T4');
	addFault('PLUTO-01', 'Low', 'Cleared for use', 480, 'HAT game crashed on launch', 'U-T1');
	return faults;
}

export const OPEN_FAULT = (f: Fault) => f.status !== 'Cleared for use';

function generateRequests(patients: Patient[]): DeviceRequest[] {
	const requests: DeviceRequest[] = [];
	const patientOf = (id: string) => patients.find((p) => p.id === id)!;
	function addRequest(
		patientId: string,
		typeId: string,
		status: DeviceRequest['status'],
		hoursAgo: number,
		note: string,
		unitId?: string | null
	) {
		const p = patientOf(patientId);
		requests.push({
			id: uid('REQ'),
			patientId,
			typeId,
			requestedBy: p.therapistId,
			date: new Date(NOW.getTime() - hoursAgo * 3600000),
			status,
			unitId: unitId || null,
			note
		});
	}
	addRequest('PT-1019', TYPE_SEQ[18], 'Assigned', 30, 'New patient, plan starts tomorrow', patientOf('PT-1019').plan!.unitId);
	addRequest('PT-1020', typeOf(TYPE_SEQ[19])!.id, 'Pending', 6, 'New patient, baseline done');
	const atl = patients.find((p) => p.plan && p.plan.unitId === 'ATLAS-01' && p.status === 'Active');
	if (atl) addRequest(atl.id, 'MARS', 'Pending', 4, 'Atlas out of service — need a temporary shoulder unit');
	return requests;
}

function generateNotes(patients: Patient[]) {
	patients
		.filter((p) => p.status === 'Active' && p.profile === 'good')
		.slice(0, 3)
		.forEach((p) => {
			p.notes.push({
				date: addDays(TODAY, -randInt(3, 9)),
				by: 'U-C1',
				text: 'Good trajectory. Continue current plan; consider increasing task difficulty.'
			});
		});
}

function generateAudit(patients: Patient[], assessments: Assessment[], faults: Fault[], requests: DeviceRequest[]): AuditEntry[] {
	const audit: AuditEntry[] = [];
	function log(userId: string, action: string, target: string, date?: Date) {
		audit.push({ id: uid('AU'), date: date || new Date(), userId, action, target });
	}
	patients.forEach((p) => {
		log(p.therapistId, 'Registered patient', p.id, p.admitted);
		if (p.plan) {
			p.plan.history.forEach((h, k) => {
				if (h.date <= NOW) log(h.by, k === 0 ? 'Created therapy plan' : 'Modified therapy plan', p.id + ' · ' + h.text, h.date);
			});
		}
	});
	assessments.forEach((a) => log(a.by, 'Recorded assessment', a.patientId + ' · ' + a.scale + ' ' + a.score, a.date));
	faults.forEach((f) =>
		f.log.forEach((l) => log(l.by, l.text.startsWith('Reported') ? 'Reported fault' : 'Fault → ' + l.text, f.unitId, l.date))
	);
	requests.forEach((r) => log(r.requestedBy, 'Requested device', r.patientId + ' · ' + typeOf(r.typeId)!.name, r.date));
	USERS.forEach((u) => log(u.id, 'Signed in', 'Web dashboard', new Date(NOW.getTime() - randInt(1, 40) * 3600000)));
	return audit;
}

export function generateDB(): DB {
	resetSeed(20260918);
	const units = generateUnits();
	const patients = generatePatients(units);
	const assessments = generateAssessments(patients);
	const sessions = generateSessions(patients, units);
	const faults = generateFaults(units);
	const requests = generateRequests(patients);
	generateNotes(patients);
	const audit = generateAudit(patients, assessments, faults, requests);
	return { units, patients, sessions, assessments, faults, requests, audit };
}
