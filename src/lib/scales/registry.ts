// Loads every scale definition from clinical_scales/neuro/*.json (the source of truth).
// Import from server code only — the larger scales (MAL) are not meant for the client bundle.
import { answerableItems, allItems } from './evaluate';
import type { ScaleDef, ScaleSummary } from './types';

const modules = import.meta.glob('../../../clinical_scales/neuro/*.json', {
	eager: true,
	import: 'default'
}) as Record<string, unknown>;

const NOT_SCALES = new Set(['index', 'non_clickable_report']);

// Definitions kept so already-recorded assessments still render, but not offered for new assessments.
const NOT_OFFERED = new Set(['adverse_event', 'exit_questionnaire_control', 'exit_questionnaire_intervention']);

export const isOffered = (id: string) => !NOT_OFFERED.has(id);

const scales = new Map<string, ScaleDef>();
for (const [path, mod] of Object.entries(modules)) {
	const id = path.split('/').pop()!.replace(/\.json$/, '');
	if (NOT_SCALES.has(id)) continue;
	scales.set(id, mod as ScaleDef);
}

/** Real scales only — `kind: "bookkeeping"` (consent, completion forms) are not assessments. */
export function listScales(): ScaleSummary[] {
	return [...scales.values()]
		.filter((s) => s.kind === 'scale' && isOffered(s.id))
		.map((s) => ({
			id: s.id,
			title: s.title,
			version: s.version,
			answerable: answerableItems(s).filter((i) => i.type !== 'date').length,
			computed: allItems(s).filter((i) => i.type === 'computed').length
		}))
		.sort((a, b) => a.title.localeCompare(b.title));
}

export function getScale(id: string): ScaleDef | null {
	const s = scales.get(id);
	return s && s.kind === 'scale' ? s : null;
}
