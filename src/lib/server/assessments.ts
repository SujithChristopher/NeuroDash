import type { Assessment, PatientDocument } from '@prisma/client';
import { getScale } from '$lib/scales/registry';
import { describeAnswers } from '$lib/scales/describe';
import type { Answers } from '$lib/scales/types';

type AssessmentRow = Assessment & {
	administeredBy: { name: string } | null;
	documents?: Pick<PatientDocument, 'id' | 'name' | 'docType' | 'sizeKb'>[];
};

/** Client-safe view of a stored assessment: labels and percentage resolved from the scale definition. */
export function assessmentView(a: AssessmentRow) {
	const def = getScale(a.scaleId);
	const described = def ? describeAnswers(def, a.answers as Answers) : { sections: [], scores: [] };
	return {
		id: a.id,
		typeId: a.scaleId,
		typeName: def?.title ?? a.scaleId,
		version: String(a.scaleVersion),
		date: a.assessmentDate.toISOString(),
		label: a.label,
		score: a.score,
		maxScore: a.maxScore,
		percentage: a.score != null && a.maxScore ? Math.round((a.score / a.maxScore) * 100) : null,
		by: a.administeredBy?.name ?? '—',
		sections: described.sections,
		scores: described.scores,
		documents: (a.documents ?? []).map((d) => ({ id: d.id, name: d.name, docType: d.docType, sizeKb: d.sizeKb }))
	};
}

export type AssessmentView = ReturnType<typeof assessmentView>;
