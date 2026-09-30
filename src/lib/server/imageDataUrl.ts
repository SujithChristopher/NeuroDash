// Session-note photos are stored as base64 data URLs in Postgres (spec §7.5): no object storage.
const MAX_DECODED_BYTES = 2 * 1024 * 1024;
const PATTERN = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export function validateImageDataUrl(value: string): { ok: true } | { ok: false; error: string } {
	const m = PATTERN.exec(value);
	if (!m) return { ok: false, error: 'Photo must be a PNG, JPEG, GIF or WebP image.' };
	const b64 = m[2];
	const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
	const decoded = Math.floor((b64.length * 3) / 4) - padding;
	if (decoded > MAX_DECODED_BYTES) return { ok: false, error: 'Photo must be 2 MB or smaller.' };
	return { ok: true };
}
