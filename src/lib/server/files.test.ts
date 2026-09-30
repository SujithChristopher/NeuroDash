import { describe, expect, it } from 'vitest';
import { checkUpload, MAX_UPLOAD_BYTES, sniffMime } from './files';

const bytes = (...n: number[]) => new Uint8Array(n);
const file = (data: Uint8Array | string, name = 'scan.pdf') => new File([data as BlobPart], name);

describe('sniffMime', () => {
	it('recognises the allowed types by signature', () => {
		expect(sniffMime(new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf');
		expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
		expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
		expect(sniffMime(new TextEncoder().encode('GIF89a'))).toBe('image/gif');
		expect(sniffMime(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
	});
	it('rejects everything else', () => {
		expect(sniffMime(new TextEncoder().encode('<html><script>alert(1)</script>'))).toBeNull();
		expect(sniffMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
		expect(sniffMime(bytes())).toBeNull();
	});
});

describe('checkUpload', () => {
	it('accepts a real PDF and reports type and size', async () => {
		const r = await checkUpload(file('%PDF-1.4 hello'));
		expect(r.ok && r.mimeType).toBe('application/pdf');
		expect(r.ok && r.docType).toBe('PDF');
		expect(r.ok && r.sizeKb).toBe(1);
	});
	it('ignores a lying extension and rejects HTML renamed to .pdf', async () => {
		const r = await checkUpload(file('<html>evil</html>', 'report.pdf'));
		expect(r.ok).toBe(false);
	});
	it('rejects empty and oversize files', async () => {
		expect((await checkUpload(file(new Uint8Array(0)))).ok).toBe(false);
		const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
		big.set(new TextEncoder().encode('%PDF-'));
		expect((await checkUpload(file(big))).ok).toBe(false);
	});
	it('sanitises path separators in the name', async () => {
		const r = await checkUpload(file('%PDF-1', '..\\..\\etc/passwd.pdf'));
		expect(r.ok && r.name).toBe('.._.._etc_passwd.pdf');
	});
});
