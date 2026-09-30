import { describe, expect, it } from 'vitest';
import { adherenceVerdict, detectIntent, findMentionedPatient } from './aiIntents';

describe('detectIntent (no patient)', () => {
	it('routes the supported questions', () => {
		expect(detectIntent('Which patients have low adherence?', false)).toBe('low-adherence');
		expect(detectIntent('Which device has the highest utilization', false)).toBe('device-ranking');
		expect(detectIntent('Show unresolved device issues', false)).toBe('open-issues');
	});
	it('never guesses: anything else is a fallback', () => {
		expect(detectIntent('What is the meaning of life?', false)).toBe('fallback');
		expect(detectIntent('', false)).toBe('fallback');
	});
});

describe('detectIntent (patient)', () => {
	it.each([
		['Has she improved since baseline?', 'patient-improvement'],
		['How is she doing now', 'patient-improvement'],
		['Which device does she use most?', 'patient-devices'],
		['How many hours this week', 'patient-hours'],
		['Is he following the plan?', 'patient-adherence'],
		['Tell me about them', 'patient-summary']
	])('%s → %s', (q, intent) => {
		expect(detectIntent(q, true)).toBe(intent);
	});
	it('does not treat "know" as "now"', () => {
		expect(detectIntent('I want to know more', true)).toBe('patient-summary');
	});
});

describe('findMentionedPatient', () => {
	const ps = [
		{ id: '1', name: 'Ananya R.', displayCode: 'P-10124' },
		{ id: '2', name: 'Rajiv K.', displayCode: 'P-20551' },
		{ id: '3', name: 'Rajiv S.', displayCode: 'P-30001' }
	];
	it('matches by code, full name, or unique first name', () => {
		expect(findMentionedPatient('status of p-20551', ps)?.id).toBe('2');
		expect(findMentionedPatient('how is Ananya R. doing', ps)?.id).toBe('1');
		expect(findMentionedPatient('how is ananya doing', ps)?.id).toBe('1');
	});
	it('refuses ambiguous first names and unknowns', () => {
		expect(findMentionedPatient('how is rajiv doing', ps)).toBeNull();
		expect(findMentionedPatient('how is zoe doing', ps)).toBeNull();
	});
});

describe('adherenceVerdict', () => {
	it('uses 80/60 cut-offs', () => {
		expect(adherenceVerdict(90)).toBe('on track');
		expect(adherenceVerdict(70)).toBe('moderately behind');
		expect(adherenceVerdict(40)).toBe('significantly behind');
	});
});
