import { describe, it, expect } from 'vitest';
import { icon, IC } from './icons';

describe('icon', () => {
	it('renders a known icon as an svg string', () => {
		const s = icon('home');
		expect(s).toContain('<svg');
		expect(s).toContain('viewBox="0 0 24 24"');
		expect(s).toContain(IC.home);
	});

	it('respects the size parameter', () => {
		expect(icon('home', 24)).toContain('width="24" height="24"');
	});

	it('falls back to an empty inner path for an unknown name, never throws', () => {
		expect(() => icon('nope')).not.toThrow();
		expect(icon('nope')).toContain('<svg');
	});
});
