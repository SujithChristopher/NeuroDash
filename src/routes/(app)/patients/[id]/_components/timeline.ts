// Timeline = client-merged, date-sorted feed of what the page already fetched (no dedicated table — spec §7.1).
import { fmtMin } from '$lib/utils';

export interface TimelineEvent {
	date: string;
	icon: string;
	tone: string;
	title: string;
	desc: string;
}

interface Input {
	patient: { registrationDate: string; therapist: { name: string } };
	plans: { createdAt: string; name: string; createdBy: string }[];
	assessments: { date: string; typeName: string; score: number | null; maxScore: number | null; percentage: number | null }[];
	sessions: { date: string; durationMinutes: number | null; device: { displayCode: string } }[];
	documents: { uploadDate: string; name: string }[];
	notes: { date: string; author: string }[];
}

export function buildTimeline(d: Input): TimelineEvent[] {
	const evs: TimelineEvent[] = [
		{ date: d.patient.registrationDate, icon: 'users', tone: 'accent', title: 'Patient registered', desc: `Registered by ${d.patient.therapist.name}` }
	];
	for (const a of d.assessments)
		evs.push({ date: a.date, icon: 'clipboard', tone: 'info', title: `${a.typeName} completed`, desc: a.score == null ? 'Recorded' : `Score: ${a.score}${a.maxScore != null ? `/${a.maxScore}` : ''}${a.percentage != null ? ` (${a.percentage}%)` : ''}` });
	for (const p of d.plans)
		evs.push({ date: p.createdAt, icon: 'target', tone: 'accent', title: 'Therapy plan created', desc: `${p.name} (by ${p.createdBy})` });
	for (const x of d.documents)
		evs.push({ date: x.uploadDate, icon: 'file', tone: 'neutral', title: 'Document uploaded', desc: x.name });
	for (const n of d.notes)
		evs.push({ date: n.date, icon: 'edit', tone: 'neutral', title: 'Note added', desc: `By ${n.author}` });

	const byDay = new Map<string, { min: number; device: string; n: number }>();
	for (const s of d.sessions) {
		const k = s.date.slice(0, 10);
		const v = byDay.get(k) ?? { min: 0, device: s.device.displayCode, n: 0 };
		v.min += s.durationMinutes ?? 0;
		v.n++;
		byDay.set(k, v);
	}
	for (const [k, v] of byDay)
		evs.push({ date: new Date(k).toISOString(), icon: 'activity', tone: 'good', title: v.n > 1 ? 'Therapy sessions' : 'Therapy session', desc: `${v.device} · ${fmtMin(v.min)}` });

	return evs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
