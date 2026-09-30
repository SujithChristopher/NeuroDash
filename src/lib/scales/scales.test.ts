import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluate } from './expr';
import {
	allItems,
	answerableItems,
	computeScores,
	isVisible,
	maxScore,
	primaryScoreId,
	progress,
	pruneHidden,
	validateAnswers
} from './evaluate';
import type { ScaleDef } from './types';

const DIR = join(process.cwd(), 'clinical_scales', 'neuro');
const load = (id: string) => JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8')) as ScaleDef;
const ids = readdirSync(DIR)
	.filter((f) => f.endsWith('.json') && !['index.json', 'non_clickable_report.json'].includes(f))
	.map((f) => f.replace('.json', ''));

describe('expr', () => {
	const vars: Record<string, number | string> = { a: 2, b: 3, s: 'UN', z: 0 };
	const get = (n: string) => (n in vars ? vars[n] : null);
	it('does arithmetic with precedence and parentheses', () => {
		expect(evaluate('a + b * 2', get)).toBe(8);
		expect(evaluate('(a + b) / 5', get)).toBe(1);
		expect(evaluate('-a + b', get)).toBe(1);
	});
	it('propagates missing operands like REDCap (blank in, blank out)', () => {
		expect(evaluate('a + missing', get)).toBeNull();
		expect(evaluate('a / z', get)).toBeNull();
	});
	it('compares loosely for equality and numerically for ordering', () => {
		expect(evaluate("s = 'UN'", get)).toBe(true);
		expect(evaluate("z = '0'", get)).toBe(true);
		expect(evaluate('b > a and a >= 2', get)).toBe(true);
		expect(evaluate("s = 'X' or b = 3", get)).toBe(true);
	});
	it('resolves checkbox refs', () => {
		expect(evaluate("box(1) = '1'", (n, box) => (box === '1' ? '1' : '0'))).toBe(true);
	});
	it('never throws on garbage', () => {
		expect(evaluate('a +', get)).toBeNull();
		expect(evaluate('a $ b', get)).toBeNull();
	});
});

describe('every scale definition', () => {
	it.each(ids)('%s parses: showIf and computed expressions are evaluable', (id) => {
		const def = load(id);
		for (const it of allItems(def)) {
			if (it.showIf) expect(() => isVisible(it, {})).not.toThrow();
			if (it.type === 'computed') expect(it.expr, `${id}.${it.id}`).toBeTruthy();
		}
		// A computed item that references an unknown variable would silently never score.
		const known = new Set(allItems(def).map((i) => i.id));
		for (const it of allItems(def).filter((i) => i.type === 'computed')) {
			const refs = (it.expr ?? '').match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
			for (const r of refs) expect(known.has(r), `${id}.${it.id} references unknown "${r}"`).toBe(true);
		}
	});
});

describe('PHQ-9 (sum of 9 items, each 0–3)', () => {
	const def = load('phq9');
	const items = answerableItems(def).filter((i) => i.type === 'single_choice');
	it('scores a complete form and reports its maximum', () => {
		// The 10th item (functional difficulty) is deliberately not part of the PHQ-9 total.
		const scored = items.filter((i) => allItems(def).find((c) => c.id === 'phq9_total_score')!.expr!.includes(i.id));
		expect(scored).toHaveLength(9);
		const answers = Object.fromEntries(items.map((i) => [i.id, 2]));
		expect(computeScores(def, answers)['phq9_total_score']).toBe(18);
		expect(maxScore(def, 'phq9_total_score')).toBe(27);
	});
	it('has no score until every item is answered', () => {
		expect(computeScores(def, { [items[0].id]: 1 })['phq9_total_score']).toBeNull();
	});
});

describe('FMA upper extremity', () => {
	const def = load('fma');
	it('uses the motor total as its headline score, with a 66-point maximum', () => {
		expect(primaryScoreId(def)).toBe('fma_ue_total_motor');
		expect(maxScore(def, 'fma_ue_total_motor')).toBe(66);
	});
});

describe('ARAT (bilateral)', () => {
	const def = load('arat');
	it('picks the affected side and the 57-point maximum', () => {
		expect(primaryScoreId(def, 'Right')).toBe('arat_total_r');
		expect(primaryScoreId(def, 'Left')).toBe('arat_total_l');
		expect(maxScore(def, 'arat_total_l')).toBe(57);
	});
});

describe('mean scores (MAL, FSS)', () => {
	it('computes the FSS mean over 9 items', () => {
		const def = load('fss');
		const nine = answerableItems(def).filter((i) => i.id.startsWith('fss_') && i.type === 'single_choice').slice(0, 9);
		const answers = Object.fromEntries(nine.map((i) => [i.id, 4]));
		expect(computeScores(def, answers)['fss_mean_score']).toBe(4);
	});
});

describe('showIf (NIHSS "UN" = amputation/fusion)', () => {
	const def = load('nihss');
	const explain = allItems(def).find((i) => i.showIf?.includes('nihss_5a'));
	it('shows the follow-up only when a limb is marked UN, and prunes it otherwise', () => {
		expect(explain).toBeTruthy();
		expect(isVisible(explain!, { nihss_5a: 'UN' })).toBe(true);
		expect(isVisible(explain!, { nihss_5a: 1 })).toBe(false);
		const pruned = pruneHidden(def, { nihss_5a: 1, [explain!.id]: 'x' });
		expect(explain!.id in pruned).toBe(false);
	});
});

describe('validateAnswers', () => {
	const def = load('phq9');
	const first = answerableItems(def).find((i) => i.type === 'single_choice')!;
	it('accepts valid choices', () => {
		expect(validateAnswers(def, { [first.id]: 1 })).toEqual([]);
	});
	it('rejects values outside the closed set, unknown ids and computed/info ids', () => {
		expect(validateAnswers(def, { [first.id]: 99 })[0].message).toMatch(/valid option/);
		expect(validateAnswers(def, { nope: 1 })[0].message).toMatch(/Unknown/);
		expect(validateAnswers(def, { phq9_total_score: 27 })[0].message).toMatch(/Unknown/);
		expect(validateAnswers(def, { [first.id]: [1, 2] })[0].message).toMatch(/one option/);
	});
	it('rejects answers to hidden items', () => {
		const nihss = load('nihss');
		const explain = allItems(nihss).find((i) => i.showIf?.includes('nihss_5a') && i.type !== 'text');
		if (explain) {
			expect(validateAnswers(nihss, { nihss_5a: 1, [explain.id]: 1 }).some((e) => e.id === explain.id)).toBe(true);
		}
	});
	it('bounds steppers (EQ-5D VAS 0–100, block counts default 0–300)', () => {
		const eq = load('eq5d');
		expect(validateAnswers(eq, { eq5d_vas: 100 })).toEqual([]);
		expect(validateAnswers(eq, { eq5d_vas: 101 })).not.toEqual([]);
		expect(validateAnswers(eq, { eq5d_vas: 1.5 })).not.toEqual([]);
		const bbt = load('bbt');
		expect(validateAnswers(bbt, { bnb_left_trial_1: 301 })).not.toEqual([]);
		expect(validateAnswers(bbt, { bnb_left_trial_1: 57 })).toEqual([]);
	});
	it('validates dates as ISO yyyy-mm-dd', () => {
		const dated = allItems(def).find((i) => i.type === 'date');
		if (dated) {
			expect(validateAnswers(def, { [dated.id]: '2026-09-30' })).toEqual([]);
			expect(validateAnswers(def, { [dated.id]: '30/09/2026' })).not.toEqual([]);
		}
	});
});

describe('progress', () => {
	it('counts answered vs visible answerable items', () => {
		const def = load('phq9');
		const items = answerableItems(def).filter((i) => i.type === 'single_choice');
		expect(progress(def, { [items[0].id]: 1 })).toEqual({ answered: 1, total: items.length });
	});
});

describe('no scale needs a free-text field to be completed', () => {
	it('every free-text item is skipped by the renderer, never required', () => {
		for (const id of ids) {
			for (const it of allItems(load(id)).filter((i) => i.type === 'text')) {
				expect(it.required, `${id}.${it.id}`).toBeFalsy();
			}
		}
	});
});
