// Types for the clinical scale definitions in clinical_scales/neuro/*.json.
// Scales are data, not hand-written screens: one generic renderer + evaluator handles all of them.

export type ScalarValue = number | string;
export type AnswerValue = ScalarValue | ScalarValue[];
export type Answers = Record<string, AnswerValue>;

export interface Choice {
	value: ScalarValue;
	label: string;
}

export type ItemType =
	| 'single_choice'
	| 'multi_choice'
	| 'yesno'
	| 'number'
	| 'date'
	| 'examiner'
	| 'subject_ref'
	| 'text'
	| 'computed'
	| 'info';

export interface ScaleItem {
	id: string;
	type: ItemType;
	widget?: string;
	label?: string;
	labelHtml?: string;
	choices?: Choice[];
	required?: boolean;
	showIf?: string;
	expr?: string;
	min?: number;
	max?: number;
	note?: string;
	source?: string;
}

export interface ScaleSection {
	id: string;
	title?: string;
	items: ScaleItem[];
}

export interface ScaleDef {
	id: string;
	version: number;
	title: string;
	redcapForm?: string;
	kind: 'scale' | 'bookkeeping';
	sections: ScaleSection[];
}

export interface ScaleSummary {
	id: string;
	title: string;
	version: number;
	answerable: number;
	computed: number;
}
