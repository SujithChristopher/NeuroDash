export function initials(name: string) {
	return name
		.split(' ')
		.filter(Boolean)
		.slice(0, 2)
		.map((p) => p[0])
		.join('')
		.toUpperCase();
}

const pad = (n: number) => String(n).padStart(2, '0');

export function fmtDate(d: Date | string | null | undefined, opts?: Intl.DateTimeFormatOptions) {
	if (!d) return '—';
	return new Date(d).toLocaleDateString(
		'en-US',
		opts ?? { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
	);
}
export function fmtDateShort(d: Date | string) {
	return new Date(d).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC'
	});
}
export function fmtTime(d: Date | string) {
	return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
export function fmtDateTime(d: Date | string) {
	const x = new Date(d);
	return x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + fmtTime(x);
}
export function timeAgo(d: Date | string) {
	const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
	if (m < 1) return 'just now';
	if (m < 60) return m + 'm ago';
	const h = Math.floor(m / 60);
	if (h < 24) return h + 'h ago';
	const days = Math.floor(h / 24);
	if (days < 7) return days + 'd ago';
	return fmtDateShort(d);
}
export function fmtMin(mins: number) {
	mins = Math.round(mins);
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	if (h <= 0) return m + 'm';
	return h + 'h ' + (m ? pad(m) + 'm' : '');
}
export function fmtHrsFromMin(mins: number) {
	return (mins / 60).toFixed(1) + 'h';
}
export function pct(n: number, d: number) {
	return d ? Math.round((n / d) * 100) : 0;
}
export function ageFrom(dob: Date | string | null | undefined) {
	if (!dob) return null;
	const b = new Date(dob);
	const now = new Date();
	let a = now.getUTCFullYear() - b.getUTCFullYear();
	if (
		now.getUTCMonth() < b.getUTCMonth() ||
		(now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())
	)
		a--;
	return a;
}

export type Tone = 'good' | 'info' | 'warning' | 'serious' | 'critical' | 'neutral' | 'accent';

/** Status string → badge tone (the literal status strings are the DB values). */
const TONE_BY_STATUS: Record<string, Tone> = {
	Active: 'accent',
	Ongoing: 'good',
	Completed: 'info',
	Paused: 'warning',
	Discontinued: 'critical',
	Available: 'good',
	Assigned: 'info',
	'In Use': 'good',
	Maintenance: 'warning',
	'Issue Detected': 'critical',
	'Awaiting Engineer': 'warning',
	Cleared: 'good',
	'Pending Engineer Review': 'warning',
	'Cleared — Ready to Assign': 'accent',
	Declined: 'critical',
	Open: 'critical',
	Investigating: 'warning',
	Resolved: 'info',
	Returned: 'neutral',
	Critical: 'critical',
	High: 'serious',
	Medium: 'warning',
	Low: 'neutral',
	'On Track': 'good',
	'At Risk': 'warning',
	Behind: 'critical',
	done: 'good',
	missed: 'critical',
	upcoming: 'neutral'
};
export const statusTone = (s: string): Tone => TONE_BY_STATUS[s] ?? 'neutral';

export function adherenceTone(p: number): Tone {
	return p >= 80 ? 'good' : p >= 60 ? 'warning' : 'critical';
}

export const ROLE_LABEL = {
	THERAPIST: 'Therapist',
	CONSULTANT: 'Consultant',
	ENGINEER: 'Engineer',
	ADMIN: 'Admin'
} as const;

/** UTC-midnight start of a calendar day (sessionDate etc. are plain DATE columns). */
export function utcDay(d = new Date()) {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
