// Scanned-document uploads: bytes live in Postgres (no object store). The type is decided by the file's
// magic bytes, never by its name or the browser-supplied MIME type.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);

export function sniffMime(b: Uint8Array): string | null {
	if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
	if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
	if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
	if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'; // GIF8
	if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
	return null;
}

const EXT: Record<string, string> = {
	'application/pdf': 'PDF',
	'image/png': 'PNG',
	'image/jpeg': 'JPEG',
	'image/gif': 'GIF',
	'image/webp': 'WEBP'
};

export type UploadCheck =
	| { ok: true; name: string; mimeType: string; docType: string; sizeKb: number; data: Uint8Array<ArrayBuffer> }
	| { ok: false; error: string };

/** Validates a browser File: non-empty, ≤10MB, and a real PDF/PNG/JPEG/GIF/WebP. */
export async function checkUpload(file: File): Promise<UploadCheck> {
	if (file.size === 0) return { ok: false, error: 'That file is empty.' };
	if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: `${file.name} is larger than 10 MB.` };
	const data = new Uint8Array(await file.arrayBuffer());
	const mimeType = sniffMime(data);
	if (!mimeType) return { ok: false, error: `${file.name} must be a PDF or an image (PNG, JPEG, GIF, WebP).` };
	const name = file.name.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f]/g, '').slice(0, 200) || 'scan';
	return { ok: true, name, mimeType, docType: EXT[mimeType], sizeKb: Math.max(1, Math.ceil(data.length / 1024)), data };
}
