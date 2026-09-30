import crypto from 'node:crypto';

// No 0/O/1/I/l — a human relays this verbally or by chat.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function generateTempPassword(length = 12) {
	return Array.from({ length }, () => ALPHABET[crypto.randomInt(0, ALPHABET.length)]).join('');
}
