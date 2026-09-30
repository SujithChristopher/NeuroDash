import { describe, expect, it } from 'vitest';
import { validateImageDataUrl } from './imageDataUrl';

const png = (n: number) => 'data:image/png;base64,' + 'A'.repeat(n);

describe('validateImageDataUrl', () => {
	it('accepts small images of allowed types', () => {
		expect(validateImageDataUrl(png(100)).ok).toBe(true);
		expect(validateImageDataUrl('data:image/jpeg;base64,AAAA').ok).toBe(true);
		expect(validateImageDataUrl('data:image/webp;base64,AAAA').ok).toBe(true);
	});
	it('rejects non-image or disallowed types and junk', () => {
		expect(validateImageDataUrl('data:text/html;base64,AAAA').ok).toBe(false);
		expect(validateImageDataUrl('data:image/svg+xml;base64,AAAA').ok).toBe(false);
		expect(validateImageDataUrl('not a data url').ok).toBe(false);
		expect(validateImageDataUrl('data:image/png;base64,***').ok).toBe(false);
	});
	it('caps decoded size at 2MB', () => {
		expect(validateImageDataUrl(png(2_800_000)).ok).toBe(false); // ~2.1MB decoded
		expect(validateImageDataUrl(png(2_600_000)).ok).toBe(true); // ~1.95MB decoded
	});
});
