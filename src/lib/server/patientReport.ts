import { prisma } from './db';
import { patientScopeFor } from './scope';
import { getScale } from '$lib/scales/registry';
import { buildPatientReport, type PatientReportData, type ReportPeriod } from '$lib/patientReport';

type User = NonNullable<App.Locals['user']>;

/** Loads the patient within the caller's scope and builds their report; null when the patient is not visible. */
export async function loadPatientReport(user: User, patientId: string, period?: ReportPeriod): Promise<{ patientId: string; report: PatientReportData; sessions: SessionRow[] } | null> {
	const p = await prisma.patient.findFirst({
		where: { AND: [{ id: patientId }, patientScopeFor(user)] },
		include: {
			therapist: { select: { name: true } },
			therapyPlans: { include: { dayLog: true, devices: { include: { deviceType: { select: { id: true, name: true } } } } }, orderBy: { createdAt: 'desc' } },
			assessments: { orderBy: { assessmentDate: 'asc' }, select: { scaleId: true, assessmentDate: true, label: true, score: true, maxScore: true } },
			therapySessions: {
				orderBy: { startTime: 'asc' },
				include: {
					device: { select: { displayCode: true, deviceType: { select: { id: true, name: true, colorSeries: true } } } },
					trials: { select: { mechanism: true, durationSec: true } }
				}
			}
		}
	});
	if (!p) return null;

	const plan = p.therapyPlans.find((x) => x.status === 'Active') ?? p.therapyPlans[0] ?? null;
	const report = buildPatientReport({
		patient: { displayCode: p.displayCode, status: p.status, gender: p.gender, dob: p.dob, affectedSide: p.affectedSide, strokeDate: p.strokeDate, therapistName: p.therapist.name },
		plan: plan ? { ...plan, devices: plan.devices.map((d) => d.deviceType) } : null,
		sessions: p.therapySessions.map((s) => ({
			date: s.sessionDate,
			durationMinutes: s.durationMinutes == null ? null : Number(s.durationMinutes),
			device: { typeId: s.device.deviceType.id, typeName: s.device.deviceType.name, colorSeries: s.device.deviceType.colorSeries },
			trials: s.trials
		})),
		assessments: p.assessments.map((a) => ({
			scaleId: a.scaleId,
			title: getScale(a.scaleId)?.title ?? a.scaleId,
			date: a.assessmentDate,
			label: a.label,
			score: a.score == null ? null : Number(a.score),
			maxScore: a.maxScore == null ? null : Number(a.maxScore)
		})),
		now: new Date(),
		period
	});

	const inPeriod = (d: Date) => {
		const k = d.toISOString().slice(0, 10);
		return (!period?.from || k >= period.from) && (!period?.to || k <= period.to);
	};
	const sessions: SessionRow[] = p.therapySessions.filter((s) => inPeriod(s.sessionDate)).map((s) => ({
		date: s.sessionDate.toISOString().slice(0, 10),
		device: s.device.displayCode,
		minutes: s.durationMinutes == null ? null : Number(s.durationMinutes)
	}));
	return { patientId: p.id, report, sessions };
}

export interface SessionRow {
	date: string;
	device: string;
	minutes: number | null;
}
