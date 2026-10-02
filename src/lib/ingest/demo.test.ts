import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupSessions, parseSessionsCsv, trialTypeFor } from './parse';

// The demo uploads for one patient on two devices (localserver/testdata). They have different column layouts.
const demo = (f: string) => readFileSync(join(process.cwd(), 'localserver', 'testdata', f), 'utf8');

describe('real MARS and PLUTO uploads (different layouts, one patient)', () => {
	const mars = parseSessionsCsv(demo('mars_sessions.csv'));
	const pluto = parseSessionsCsv(demo('pluto_sessions.csv'));

	it('reads every row of both files without problems', () => {
		expect([mars.user, mars.device, mars.location]).toEqual(['HOCMCV002', 'MARS', 'ranipet']);
		expect([pluto.user, pluto.device]).toEqual(['HOCMCV002', 'PLUTO']);
		expect(mars.problems).toEqual([]);
		expect(pluto.problems).toEqual([]);
		expect(mars.trials).toHaveLength(1342);
		expect(pluto.trials).toHaveLength(1491);
	});

	it('groups them into the sessions the laptops recorded', () => {
		expect(groupSessions(mars.trials)).toHaveLength(38);
		expect(groupSessions(pluto.trials)).toHaveLength(43);
	});

	it('MARS: movement, games and the raw file name', () => {
		expect(new Set(mars.trials.map((t) => t.movement))).toEqual(new Set(['ML', 'AP', 'MLAP']));
		expect(new Set(mars.trials.map((t) => t.gameCode))).toEqual(new Set(['MC', 'TT', 'TW', 'DC', 'SS', 'PP']));
		expect(mars.trials[0].rawDataRef).toBe('raw-sess01-trial001-SS-ML.csv'); // not the user id that sits in TrialRawDataFile
		expect(mars.trials[0]).toMatchObject({ targets: 29, hits: 27, misses: 3, stars: 1, trialKind: null });
	});

	it('PLUTO: mechanism, trial kind, assist mode and the raw file name from TrialRawDataFile', () => {
		expect(new Set(pluto.trials.map((t) => t.movement))).toEqual(new Set(['WURD', 'FPS', 'WFE']));
		expect(new Set(pluto.trials.map((t) => t.trialKind))).toEqual(new Set(['TRAIN', 'SR85PCTRAIN', 'SR85PCCATCH']));
		expect(new Set(pluto.trials.map((t) => t.assistMode))).toEqual(new Set(['AAN', 'ACTIVE']));
		expect(new Set(pluto.trials.map((t) => t.gameCode))).toEqual(new Set(['TUK', 'HAT', 'PONG', 'RNR', 'FRUITCH']));
		expect(pluto.trials[0].rawDataRef).toBe('raw-sess01-trial001-HAT-WURD.csv');
		expect(pluto.trials[0]).toMatchObject({ targets: 13, hits: 11, stars: 1, trialKind: 'SR85PCTRAIN', assistMode: 'AAN' });
	});

	it('uses the device’s active MoveTime as therapy time (PLUTO has no GameDuration)', () => {
		const minutes = (t: { durationSec: number | null }[]) => t.reduce((s, x) => s + (x.durationSec ?? 0), 0) / 60;
		expect(minutes(mars.trials)).toBeCloseTo(1325.6, 0);
		// One PLUTO trial reports MoveTime 0 although it ran for 38 s: that row falls back to its start/stop times.
		expect(pluto.trials.find((t) => t.sessionNumber === 29 && t.trialNumberSession === 1)?.durationSec).toBe(38);
		expect(minutes(pluto.trials)).toBeCloseTo(1471.8, 0);
		expect(mars.trials.every((t) => t.durationSec !== null && t.durationSec > 0)).toBe(true);
		expect(pluto.trials.every((t) => t.durationSec !== null && t.durationSec > 0)).toBe(true);
	});

	it('falls back to GameDuration, then a sane stop − start, when MoveTime is absent', () => {
		const base = ':User: u\nSessionNumber,DateTime,CurrentTargets,CurrentHits,TrialStartTime,TrialStopTime';
		expect(parseSessionsCsv(`${base},GameDuration\n1,2026-10-01 09:00:00,5,5,2026-10-01 09:00:10,2026-10-01 09:01:10,45\n`).trials[0].durationSec).toBe(45);
		expect(parseSessionsCsv(`${base}\n1,2026-10-01 09:00:00,5,5,2026-10-01 09:00:10,2026-10-01 09:01:10\n`).trials[0].durationSec).toBe(60);
		// A pause of hours is not therapy time.
		expect(parseSessionsCsv(`${base}\n1,2026-10-01 09:00:00,5,5,2026-10-01 09:00:10,2026-10-01 14:00:10\n`).trials[0].durationSec).toBeNull();
	});

	it('treats AROM/PROM/APROM as range-of-motion trials, whether named by game or trial kind', () => {
		expect(trialTypeFor('TUK', 'SR85PCCATCH')).toBe('GAME');
		expect(trialTypeFor('HAT', 'AROM')).toBe('AROM');
		expect(trialTypeFor('APROM', null)).toBe('APROM');
	});
});
