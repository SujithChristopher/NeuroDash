// Turns stored answers into human-readable rows (labels come from the definition, never hard-coded).
import { allItems, computeScores, isVisible } from './evaluate';
import type { Answers, ScaleDef, ScaleItem } from './types';

export interface DescribedRow {
	label: string;
	value: string;
}
export interface DescribedSection {
	title: string;
	rows: DescribedRow[];
}

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function valueLabel(item: ScaleItem, raw: unknown): string {
	if (Array.isArray(raw)) return raw.map((v) => valueLabel(item, v)).join(', ');
	const hit = item.choices?.find((c) => String(c.value) === String(raw));
	return clean(hit?.label) || String(raw);
}

export function describeAnswers(def: ScaleDef, answers: Answers): { sections: DescribedSection[]; scores: DescribedRow[] } {
	const sections: DescribedSection[] = [];
	for (const s of def.sections) {
		const rows: DescribedRow[] = [];
		for (const it of s.items) {
			if (it.id in answers && it.type !== 'date' && isVisible(it, answers)) {
				rows.push({ label: clean(it.label) || it.id, value: valueLabel(it, answers[it.id]) });
			}
		}
		if (rows.length) sections.push({ title: clean(s.title), rows });
	}

	const computed = computeScores(def, answers);
	const byId = new Map(allItems(def).map((i) => [i.id, i]));
	const scores = Object.entries(computed)
		.filter(([, v]) => v !== null)
		.map(([id, v]) => ({ label: clean(byId.get(id)?.label) || id, value: String(v) }));

	return { sections, scores };
}
