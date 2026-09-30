// Pure intent detection for the rules-based AI Assistant (spec §7.11). No model, no guessing:
// a question either matches one of these intents or gets an honest "here's what I can do" reply.

export type AiIntent =
	| 'low-adherence'
	| 'device-ranking'
	| 'open-issues'
	| 'fallback'
	| 'patient-improvement'
	| 'patient-devices'
	| 'patient-hours'
	| 'patient-adherence'
	| 'patient-summary';

const has = (q: string, re: RegExp) => re.test(q);

export function detectIntent(question: string, hasPatient: boolean): AiIntent {
	const q = question.toLowerCase();

	if (!hasPatient) {
		if (has(q, /low adherence|poor adherence|lowest adherence|not following|behind on/)) return 'low-adherence';
		if (has(q, /utili[sz]ation|most used|highest|busiest/) && has(q, /device/)) return 'device-ranking';
		if (has(q, /unresolved|issue/)) return 'open-issues';
		return 'fallback';
	}

	if (has(q, /improv|baseline|\bnow\b|latest/)) return 'patient-improvement';
	if (has(q, /device/) && has(q, /most|which/)) return 'patient-devices';
	if (has(q, /hour|week/)) return 'patient-hours';
	if (has(q, /following|adherence|plan/)) return 'patient-adherence';
	return 'patient-summary';
}

export interface PatientRef {
	id: string;
	name: string;
	displayCode: string;
}

/** Finds the patient a question is about: display code, full name, or (failing that) a first name. */
export function findMentionedPatient(question: string, patients: PatientRef[]): PatientRef | null {
	const q = question.toLowerCase();
	const exact = patients.filter((p) => q.includes(p.displayCode.toLowerCase()) || q.includes(p.name.toLowerCase()));
	if (exact.length) return exact.sort((a, b) => b.name.length - a.name.length)[0];

	const byFirst = patients.filter((p) => {
		const first = p.name.split(/\s+/)[0]?.replace(/[.,]/g, '').toLowerCase();
		return first && first.length >= 3 && new RegExp(`\\b${first.replace(/[^a-z0-9]/g, '')}\\b`).test(q);
	});
	// Ambiguous first names are not guessed at.
	return byFirst.length === 1 ? byFirst[0] : null;
}

/** Plain-language adherence verdict; same 80/60 cut-offs as the adherence badges. */
export function adherenceVerdict(adherence: number): string {
	if (adherence >= 80) return 'on track';
	if (adherence >= 60) return 'moderately behind';
	return 'significantly behind';
}
