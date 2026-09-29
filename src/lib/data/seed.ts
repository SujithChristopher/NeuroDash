let _seed = 20260918;

export function resetSeed(v: number) {
	_seed = v;
}

export function RNG(): number {
	_seed |= 0;
	_seed = (_seed + 0x6d2b79f5) | 0;
	let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const rand = (a: number, b: number) => a + RNG() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
export const pick = <T>(a: T[]): T => a[Math.floor(RNG() * a.length)];
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export function gauss(): number {
	let u = 0;
	while (!u) u = RNG();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * RNG());
}
export const round1 = (v: number) => Math.round(v * 10) / 10;

export const DAY = 86400000;
export const TODAY: Date = (() => {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d;
})();
export const NOW = new Date();

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
export const dayKey = (d: Date) =>
	d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const daysAgo = (d: Date) => Math.floor((+TODAY - +startOfDay(d)) / DAY);
export function startOfDay(d: Date): Date {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const fmtD = (d: Date) => d.getDate() + ' ' + MONTHS[d.getMonth()];
export const fmtDY = (d: Date) => d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
export const fmtT = (d: Date) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

export function rel(d: Date): string {
	const ms = +NOW - +d,
		h = ms / 3600000;
	if (h < 0) {
		const dd = Math.ceil(-ms / DAY);
		return 'in ' + dd + ' d';
	}
	if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min ago';
	if (h < 24) return Math.round(h) + ' h ago';
	const dd = Math.round(h / 24);
	return dd === 1 ? 'yesterday' : dd + ' d ago';
}

export const esc = (s: unknown) =>
	String(s == null ? '' : s).replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
	);
export const pct = (v: number) => Math.round(v * 100) + '%';

let _uid = 1000;
export const uid = (p: string) => p + '-' + ++_uid;
