// Pure scale logic: visibility (showIf), scoring (computed), max scores and validation.
// Kept free of Svelte/Kit imports so the server, the browser, the seed script and vitest all share it.
import { evaluate, referencedVars, type Value } from './expr';
import type { Answers, AnswerValue, ScaleDef, ScaleItem } from './types';

export const DEFAULT_NUMBER_MAX = 300;

const ANSWERABLE = new Set(['single_choice', 'multi_choice', 'yesno', 'number', 'date']);

export const allItems = (def: ScaleDef): ScaleItem[] => def.sections.flatMap((s) => s.items);

/** Items a clinician actually answers (not info/computed/subject/examiner/free text). */
export const answerableItems = (def: ScaleDef) => allItems(def).filter((i) => ANSWERABLE.has(i.type));

/**
 * Free-text items are deliberately not rendered (clinical-scale-ui: no typed notes — privacy risk,
 * unstructured, untranslatable). Scanned documents can be attached instead.
 */
export const isRenderable = (item: ScaleItem) => item.type !== 'text';

function answerToValue(a: AnswerValue | undefined): Value {
	if (a === undefined || a === '') return null;
	if (Array.isArray(a)) return a.join(',');
	return a;
}

function resolver(answers: Answers, computed?: Record<string, number | null>) {
	return (name: string, box?: string): Value => {
		if (box !== undefined) {
			const a = answers[name];
			return Array.isArray(a) && a.map(String).includes(box) ? '1' : '0';
		}
		if (computed && name in computed) return computed[name];
		return answerToValue(answers[name]);
	};
}

export function isVisible(item: ScaleItem, answers: Answers): boolean {
	if (!item.showIf) return true;
	const res = evaluate(item.showIf, resolver(answers));
	// Fail open: a condition we can't evaluate must never hide a clinical question.
	return res === null ? true : !!res;
}

/** Drops answers to items that are hidden (and, transitively, items hidden because of those drops). */
export function pruneHidden(def: ScaleDef, answers: Answers): Answers {
	const items = allItems(def);
	let current = { ...answers };
	for (let pass = 0; pass < 5; pass++) {
		let changed = false;
		for (const it of items) {
			if (it.id in current && !isVisible(it, current)) {
				delete current[it.id];
				changed = true;
			}
		}
		if (!changed) break;
	}
	return current;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Recomputes every computed item from the definition, in document order. Null = not yet computable. */
export function computeScores(def: ScaleDef, answers: Answers): Record<string, number | null> {
	const out: Record<string, number | null> = {};
	for (const it of allItems(def)) {
		if (it.type !== 'computed' || !it.expr) continue;
		const v = evaluate(it.expr, resolver(answers, out));
		out[it.id] = typeof v === 'number' && Number.isFinite(v) ? round2(v) : null;
	}
	return out;
}

const numericChoiceMax = (item: ScaleItem): number | null => {
	if (item.type === 'number') return item.max ?? DEFAULT_NUMBER_MAX;
	const nums = (item.choices ?? []).map((c) => c.value).filter((v): v is number => typeof v === 'number');
	return nums.length ? Math.max(...nums) : null;
};

/** The highest value a computed item can take: every feeding item at its maximum. */
export function maxScore(def: ScaleDef, computedId: string): number | null {
	const items = allItems(def);
	const byId = new Map(items.map((i) => [i.id, i]));
	const maxAnswers: Answers = {};
	for (const it of answerableItems(def)) {
		const m = numericChoiceMax(it);
		if (m !== null) maxAnswers[it.id] = m;
	}
	const v = computeScores(def, maxAnswers)[computedId];
	// Only meaningful if every referenced item is a scored one.
	const refs = referencedVars(byId.get(computedId)?.expr ?? '');
	const scored = refs.every((r) => byId.get(r)?.type === 'computed' || r in maxAnswers);
	return scored ? (v ?? null) : null;
}

/**
 * The headline score for a scale. FMA reports the motor total; bilateral scales (ARAT) report the
 * affected side; otherwise the last "total"/"mean" computed item, else the last computed item.
 */
export function primaryScoreId(def: ScaleDef, affectedSide?: string | null): string | null {
	const computed = allItems(def).filter((i) => i.type === 'computed').map((i) => i.id);
	if (!computed.length) return null;
	if (def.id === 'fma' && computed.includes('fma_ue_total_motor')) return 'fma_ue_total_motor';

	const left = computed.filter((c) => /_l$/.test(c));
	const right = computed.filter((c) => /_r$/.test(c));
	if (left.length && right.length) {
		const pool = affectedSide?.toLowerCase() === 'right' ? right : left;
		return pool.filter((c) => /total/.test(c)).pop() ?? pool[pool.length - 1];
	}
	return computed.filter((c) => /total|mean/.test(c)).pop() ?? computed[computed.length - 1];
}

export interface ValidationError {
	id: string;
	message: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateOne(item: ScaleItem, value: AnswerValue): string | null {
	switch (item.type) {
		case 'single_choice':
		case 'yesno': {
			if (Array.isArray(value)) return 'Choose one option.';
			return (item.choices ?? []).some((c) => String(c.value) === String(value)) ? null : 'Not a valid option.';
		}
		case 'multi_choice': {
			if (!Array.isArray(value)) return 'Expected a list of options.';
			const ok = value.every((v) => (item.choices ?? []).some((c) => String(c.value) === String(v)));
			return ok ? null : 'Not a valid option.';
		}
		case 'number': {
			const n = typeof value === 'number' ? value : Number(value);
			const lo = item.min ?? 0;
			const hi = item.max ?? DEFAULT_NUMBER_MAX;
			if (Array.isArray(value) || !Number.isInteger(n)) return 'Must be a whole number.';
			return n >= lo && n <= hi ? null : `Must be between ${lo} and ${hi}.`;
		}
		case 'date':
			return typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value)) ? null : 'Invalid date.';
		default:
			return null;
	}
}

/**
 * Validates answers against the definition. Unknown ids, answers to hidden items, out-of-range values and
 * missing required visible items are all reported. Never trusts the client.
 */
export function validateAnswers(def: ScaleDef, answers: Answers): ValidationError[] {
	const errors: ValidationError[] = [];
	const items = allItems(def);
	const byId = new Map(items.map((i) => [i.id, i]));

	for (const [id, value] of Object.entries(answers)) {
		const item = byId.get(id);
		if (!item || !ANSWERABLE.has(item.type)) {
			errors.push({ id, message: 'Unknown item.' });
			continue;
		}
		if (!isVisible(item, answers)) {
			errors.push({ id, message: 'This item is not applicable.' });
			continue;
		}
		const bad = validateOne(item, value);
		if (bad) errors.push({ id, message: bad });
	}

	for (const item of answerableItems(def)) {
		if (item.required && isVisible(item, answers) && answers[item.id] === undefined) {
			errors.push({ id: item.id, message: 'Required.' });
		}
	}
	return errors;
}

export interface Progress {
	answered: number;
	total: number;
}

export function progress(def: ScaleDef, answers: Answers): Progress {
	const visible = answerableItems(def).filter((i) => i.type !== 'date' && isVisible(i, answers));
	return { total: visible.length, answered: visible.filter((i) => answers[i.id] !== undefined).length };
}
