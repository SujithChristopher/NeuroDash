import { describe, expect, it } from 'vitest';
import {
	cleanId,
	groupSessions,
	isWatchedUpload,
	normalizeDevice,
	parseConfigCsv,
	parseCsv,
	parseDeviceDate,
	parseSessionsCsv,
	sessionSourceKey,
	trialTypeFor
} from './parse';

// Real files from a laptop upload (the "testr" patient on the local server).
export const SESSIONS_CSV = `﻿:Location: ranipet
:Device: MARS
:User: testr
SessionNumber,DateTime,TrialNumberDay,TrialNumberSession,TrialStartTime,TrialStopTime,TrialRawDataFile,Movement,TrainingPlaneAngle,GameName,ReachSpeed,GameParameter,GameDuration,SuccessRate,MoveTime,CurrentTargets,CurrentHits,CurrentMisses,CummulativeTargets,CummulativeHits,CummulativeMisses,currentStar,CummulativeStars,RawDataFileName
1,2026-09-28 10:56:02,1,1,2026-09-28 10:57:24,2026-09-28 10:58:25,testr,ML,-90,SS,0.025,18.72904,60,100,60,28,28,0,28,28,0,1,1,raw-sess01-trial001-SS-ML.csv
2,2026-09-28 11:21:24,2,1,2026-09-28 11:21:38,2026-09-28 11:22:40,testr,ML,-90,SS,0.025,18.72904,60,100,60,32,32,0,60,60,0,0,1,raw-sess02-trial002-SS-ML.csv
`;

export const CONFIG_CSV = `HomerID,StartDate,EndDate,TotalTime,ML,AP,MLAP,ForeArmLength,UpperArmLength,TrainingSide,Location,Group
testr,28-09-2026 10:55:52,26-10-2026 23:59:59,0,0,0,0,250,150,Right,ranipet,Experimental
testr,28-09-2026 10:57:18,26-10-2026 23:59:59,30,10,10,10,250,150,Right,ranipet,Experimental
`;

describe('ids and device names', () => {
	it('cleanId keeps folder-safe characters only', () => {
		expect(cleanId(' testr ')).toBe('testr');
		expect(cleanId('../../etc')).toBe('etc');
		expect(cleanId('P-0012_a')).toBe('P-0012_a');
		expect(cleanId('   ')).toBeNull();
		expect(cleanId(null)).toBeNull();
	});
	it('normalizeDevice strips the laptop number and case', () => {
		expect(normalizeDevice('PLUTO01')).toBe('PLUTO');
		expect(normalizeDevice('mars')).toBe('MARS');
		expect(normalizeDevice(' Hypercube2 ')).toBe('HYPERCUBE');
		expect(normalizeDevice('')).toBeNull();
	});
});

describe('parseCsv', () => {
	it('handles quotes, escaped quotes, CRLF, BOM and blank lines', () => {
		const rows = parseCsv('﻿a,b\r\n"x,y","he said ""hi"""\r\n\r\n1,2');
		expect(rows).toEqual([['a', 'b'], ['x,y', 'he said "hi"'], ['1', '2']]);
	});
	it('keeps embedded newlines inside quotes', () => {
		expect(parseCsv('a\n"line1\nline2"')).toEqual([['a'], ['line1\nline2']]);
	});
});

describe('parseDeviceDate', () => {
	it('reads both formats as UTC wall-clock time', () => {
		expect(parseDeviceDate('2026-09-28 10:56:02')?.toISOString()).toBe('2026-09-28T10:56:02.000Z');
		expect(parseDeviceDate('28-09-2026 10:55:52')?.toISOString()).toBe('2026-09-28T10:55:52.000Z');
		expect(parseDeviceDate('2026-09-28')?.toISOString()).toBe('2026-09-28T00:00:00.000Z');
	});
	it('rejects impossible or malformed values instead of rolling over', () => {
		expect(parseDeviceDate('2026-02-30 10:00:00')).toBeNull();
		expect(parseDeviceDate('31-04-2026 10:00:00')).toBeNull();
		expect(parseDeviceDate('yesterday')).toBeNull();
		expect(parseDeviceDate('')).toBeNull();
	});
});

describe('parseSessionsCsv', () => {
	it('reads the header lines and every trial row', () => {
		const p = parseSessionsCsv(SESSIONS_CSV);
		expect([p.location, p.device, p.user]).toEqual(['ranipet', 'MARS', 'testr']);
		expect(p.problems).toEqual([]);
		expect(p.trials).toHaveLength(2);
		const t = p.trials[0];
		expect(t).toMatchObject({
			sessionNumber: 1,
			trialNumberDay: 1,
			trialNumberSession: 1,
			movement: 'ML',
			planeAngle: -90,
			gameCode: 'SS',
			reachSpeed: 0.025,
			durationSec: 60,
			successRate: 100,
			targets: 28,
			hits: 28,
			misses: 0,
			stars: 1,
			cumulativeStars: 1,
			rawDataRef: 'raw-sess01-trial001-SS-ML.csv'
		});
		expect(t.sessionStart.toISOString()).toBe('2026-09-28T10:56:02.000Z');
		expect(t.trialStop?.toISOString()).toBe('2026-09-28T10:58:25.000Z');
	});

	it('survives column re-ordering and the correct "Cumulative" spelling', () => {
		const p = parseSessionsCsv(':User: abc\n:Device: PLUTO01\nCurrentHits,CurrentTargets,DateTime,SessionNumber,CumulativeStars\n5,10,2026-10-01 09:00:00,3,7\n');
		expect(p.device).toBe('PLUTO');
		expect(p.trials[0]).toMatchObject({ sessionNumber: 3, targets: 10, hits: 5, misses: 5, cumulativeStars: 7 });
	});

	it('skips bad rows but keeps good ones, reporting the line', () => {
		const p = parseSessionsCsv(':User: abc\nSessionNumber,DateTime,CurrentTargets,CurrentHits\n1,2026-10-01 09:00:00,10,5\nx,not-a-date,1,1\n2,2026-10-01 10:00:00,10,9\n');
		expect(p.trials.map((t) => t.sessionNumber)).toEqual([1, 2]);
		expect(p.problems).toHaveLength(1);
		expect(p.problems[0].line).toBe(4);
	});

	it('refuses a file without the required columns', () => {
		const p = parseSessionsCsv(':User: abc\nFoo,Bar\n1,2\n');
		expect(p.trials).toEqual([]);
		expect(p.problems[0].message).toMatch(/required column/);
	});

	it('copes with a missing :User: line and an empty file', () => {
		expect(parseSessionsCsv('SessionNumber,DateTime,CurrentTargets,CurrentHits\n').user).toBeNull();
		expect(parseSessionsCsv('')).toMatchObject({ user: null, trials: [] });
	});

	it('never produces negative counts', () => {
		const p = parseSessionsCsv(':User: abc\nSessionNumber,DateTime,CurrentTargets,CurrentHits,CurrentMisses,currentStar\n1,2026-10-01 09:00:00,-5,-2,-1,-3\n');
		expect(p.trials[0]).toMatchObject({ targets: 0, hits: 0, misses: 0, stars: 0 });
	});
});

describe('groupSessions', () => {
	it('rolls trial rows up into per-session totals', () => {
		const g = groupSessions(parseSessionsCsv(SESSIONS_CSV).trials);
		expect(g).toHaveLength(2);
		expect(g[0]).toMatchObject({ sessionNumber: 1, durationMinutes: 1, totalTargets: 28, totalHits: 28, totalMisses: 0, totalStars: 1 });
		expect(g[0].end?.toISOString()).toBe('2026-09-28T10:58:25.000Z');
		expect(g[1]).toMatchObject({ sessionNumber: 2, totalTargets: 32, totalHits: 32, totalStars: 0 });
	});

	it('sums several trials of one session in trial order', () => {
		const csv =
			':User: u\nSessionNumber,DateTime,TrialNumberSession,CurrentTargets,CurrentHits,GameDuration,currentStar\n' +
			'1,2026-10-01 09:00:00,2,10,8,30,1\n1,2026-10-01 09:00:00,1,20,10,90,2\n';
		const g = groupSessions(parseSessionsCsv(csv).trials)[0];
		expect(g.trials.map((t) => t.trialNumberSession)).toEqual([1, 2]);
		expect([g.totalTargets, g.totalHits, g.totalStars, g.durationMinutes]).toEqual([30, 18, 3, 2]);
	});

	it('gives a stable source key so re-uploads update rather than duplicate', () => {
		const [a] = groupSessions(parseSessionsCsv(SESSIONS_CSV).trials);
		const [b] = groupSessions(parseSessionsCsv(SESSIONS_CSV).trials);
		expect(sessionSourceKey('testr', 'MARS', a)).toBe(sessionSourceKey('testr', 'MARS', b));
		expect(sessionSourceKey('testr', 'MARS', a)).toBe('testr:MARS:1:2026-09-28T10:56:02.000Z');
	});
});

describe('trialTypeFor', () => {
	it('maps range-of-motion codes and defaults to GAME', () => {
		expect(trialTypeFor('arom')).toBe('AROM');
		expect(trialTypeFor('PROM')).toBe('PROM');
		expect(trialTypeFor('APROM')).toBe('APROM');
		expect(trialTypeFor('SS')).toBe('GAME');
		expect(trialTypeFor(null)).toBe('GAME');
	});
});

describe('parseConfigCsv', () => {
	it('reads each configuration row', () => {
		const p = parseConfigCsv(CONFIG_CSV);
		expect(p.problems).toEqual([]);
		expect(p.homerIds).toEqual(['testr']);
		expect(p.rows).toHaveLength(2);
		expect(p.rows[1]).toMatchObject({ totalTime: 30, ml: 10, ap: 10, mlap: 10, foreArmLength: 250, upperArmLength: 150, trainingSide: 'Right', location: 'ranipet', group: 'Experimental' });
		expect(p.rows[0].startDate.toISOString()).toBe('2026-09-28T10:55:52.000Z');
		expect(p.rows[0].endDate?.toISOString()).toBe('2026-10-26T23:59:59.000Z');
	});
	it('reports several different HomerIDs (the server rejects such a file)', () => {
		const p = parseConfigCsv('HomerID,StartDate\na,01-10-2026 10:00:00\nb,01-10-2026 11:00:00\n');
		expect(p.homerIds.sort()).toEqual(['a', 'b']);
	});
	it('rejects a file without HomerID/StartDate and skips rows with a bad date', () => {
		expect(parseConfigCsv('Foo\n1').problems).toHaveLength(1);
		const p = parseConfigCsv('HomerID,StartDate\na,nope\na,01-10-2026 10:00:00\n');
		expect(p.rows).toHaveLength(1);
		expect(p.problems[0].line).toBe(2);
	});
});

describe('isWatchedUpload (which file events trigger an import)', () => {
	it('accepts the two CSVs under a patient/laptop folder, with Windows or POSIX separators', () => {
		for (const f of ['testr\\MARS01\\sessions.csv', 'testr/MARS01/sessions.csv', 'testr\\PLUTO\\configdata.csv', 'testr/PLUTO/CONFIGDATA.CSV', 'sessions.csv']) {
			expect(isWatchedUpload(f), f).toBe(true);
		}
	});
	it('ignores partial uploads, backups and other files', () => {
		for (const f of ['_incoming\\PLUTO_2026.tmp', '_incoming/MARS01/sessions.csv', 'testr\\MARS01\\backup\\sessions_2026-10-01.csv', 'testr/MARS01/backup/sessions.csv', 'testr/MARS01/raw-sess01.csv', 'patients.json', 'devices.json', 'testr', 'mysessions.csv', 'sessions.csv.tmp']) {
			expect(isWatchedUpload(f), f).toBe(false);
		}
	});
});
