import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole, requireUser } from '$lib/server/guard';
import { auditAs } from '$lib/server/audit';
import { deviceUsage, logDeviceEvent } from '$lib/server/devices';
import { MAINTENANCE_TYPES } from '$lib/deviceEvents';
import { utcDay } from '$lib/utils';

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = requireUser(locals.user);
	const d = await prisma.device.findUnique({
		where: { id: params.id },
		include: {
			deviceType: { include: { mechanisms: true, games: true } },
			currentPatient: { select: { id: true, name: true, displayCode: true } },
			assignments: {
				orderBy: { assignedDate: 'desc' },
				include: { patient: { select: { id: true, name: true, displayCode: true } } }
			},
			issues: {
				orderBy: { openedAt: 'desc' },
				include: {
					openedBy: { select: { name: true } },
					engineer: { select: { name: true } },
					troubleshootingLog: { orderBy: { loggedAt: 'asc' }, include: { loggedBy: { select: { name: true } } } }
				}
			},
			maintenance: { orderBy: { maintenanceDate: 'desc' }, include: { engineer: { select: { name: true } } } },
			events: { orderBy: { eventDate: 'desc' }, take: 30 }
		}
	});
	if (!d) throw error(404, 'Device not found');

	const since = utcDay();
	since.setUTCDate(since.getUTCDate() - 13);
	const isEngineer = user.role === 'ENGINEER';

	const [usage, recent, trialGroups, games, patientsUsing, recentSessions, patients] = await Promise.all([
		deviceUsage(d.id),
		prisma.therapySession.findMany({
			where: { deviceId: d.id, sessionDate: { gte: since } },
			select: { sessionDate: true, durationMinutes: true }
		}),
		prisma.sessionTrial.count({ where: { session: { deviceId: d.id } } }),
		prisma.sessionTrial.groupBy({
			by: ['gameId'],
			where: { session: { deviceId: d.id }, gameId: { not: null } },
			_count: { _all: true }
		}),
		prisma.therapySession.findMany({
			where: { deviceId: d.id },
			distinct: ['patientId'],
			select: { patient: { select: { id: true, name: true, displayCode: true } } }
		}),
		prisma.therapySession.findMany({
			where: { deviceId: d.id },
			orderBy: { startTime: 'desc' },
			take: 12,
			include: { patient: { select: { name: true, displayCode: true } } }
		}),
		isEngineer && d.status === 'Available'
			? prisma.patient.findMany({ select: { id: true, displayCode: true }, orderBy: { displayCode: 'asc' } })
			: Promise.resolve([])
	]);

	const u = usage.get(d.id);
	const label = (p: { name: string; displayCode: string }) => (isEngineer ? p.displayCode : p.name);

	// Utilization over the last 14 UTC days, minutes per day.
	const days = Array.from({ length: 14 }, (_, i) => {
		const x = new Date(since);
		x.setUTCDate(x.getUTCDate() + i);
		return x.toISOString().slice(0, 10);
	});
	const minutes = new Map(days.map((k) => [k, 0]));
	for (const s of recent) {
		const k = s.sessionDate.toISOString().slice(0, 10);
		minutes.set(k, (minutes.get(k) ?? 0) + Number(s.durationMinutes ?? 0));
	}

	const gameLabel = new Map(d.deviceType.games.map((g) => [g.id, g.displayLabel]));

	return {
		perms: {
			isEngineer,
			canReport: user.role === 'THERAPIST' || user.role === 'ENGINEER'
		},
		patients,
		maintenanceTypes: MAINTENANCE_TYPES,
		device: {
			id: d.id,
			displayCode: d.displayCode,
			serialNumber: d.serialNumber,
			firmwareVersion: d.firmwareVersion,
			status: d.status,
			location: d.location,
			registeredOn: d.registeredOn.toISOString(),
			lastSyncAt: d.lastSyncAt?.toISOString() ?? null,
			type: {
				id: d.deviceType.id,
				name: d.deviceType.name,
				category: d.deviceType.category,
				colorSeries: d.deviceType.colorSeries,
				mechanisms: d.deviceType.mechanisms.map((m) => m.mechanismName),
				games: d.deviceType.games.map((g) => g.displayLabel)
			},
			currentPatient: d.currentPatient ? { id: d.currentPatient.id, label: label(d.currentPatient) } : null
		},
		stats: {
			sessions: u?.sessions ?? 0,
			totalTrials: trialGroups,
			avgAccuracy: u?.avgAccuracy ?? 0,
			totalStars: u?.totalStars ?? 0,
			totalMin: u?.totalMin ?? 0,
			patientsUsing: patientsUsing.map((p) => ({ id: p.patient.id, label: label(p.patient), code: p.patient.displayCode }))
		},
		utilization: { labels: days, minutes: days.map((k) => Math.round(minutes.get(k) ?? 0)) },
		games: games.map((g) => ({ label: gameLabel.get(g.gameId!) ?? g.gameId!, count: g._count._all })),
		recentSessions: recentSessions.map((s) => ({
			id: s.id,
			patient: label(s.patient),
			startTime: s.startTime.toISOString(),
			durationMinutes: s.durationMinutes == null ? null : Number(s.durationMinutes),
			totalHits: s.totalHits,
			totalTargets: s.totalTargets,
			totalStars: s.totalStars
		})),
		assignments: d.assignments.map((a) => ({
			id: a.id,
			patient: label(a.patient),
			patientId: a.patient.id,
			assignedDate: a.assignedDate.toISOString(),
			returnedDate: a.returnedDate?.toISOString() ?? null,
			status: a.status
		})),
		issues: d.issues.map((i) => ({
			id: i.id,
			device: { id: d.id, displayCode: d.displayCode },
			description: i.description,
			severity: i.severity,
			status: i.status,
			openedAt: i.openedAt.toISOString(),
			openedBy: i.openedBy.name,
			engineer: i.engineer?.name ?? null,
			resolution: i.resolution,
			partsReplaced: i.partsReplaced,
			log: i.troubleshootingLog.map((l) => ({ id: l.id, at: l.loggedAt.toISOString(), by: l.loggedBy.name, note: l.note }))
		})),
		maintenance: d.maintenance.map((m) => ({
			id: m.id,
			date: m.maintenanceDate.toISOString(),
			type: m.maintenanceType,
			engineer: m.engineer.name,
			notes: m.notes
		})),
		events: d.events.map((e) => ({ id: e.id, date: e.eventDate.toISOString(), type: e.eventType, description: e.description }))
	};
};

const maintenanceSchema = z.object({
	maintenanceType: z.string().trim().min(1, 'Choose a maintenance type.').max(120),
	maintenanceDate: z
		.string()
		.min(1, 'Choose a date.')
		.transform((v) => new Date(v))
		.refine((d) => !Number.isNaN(d.getTime()), 'Invalid date.'),
	notes: z.string().trim().max(2000).optional()
});

export const actions: Actions = {
	assign: async ({ request, locals, params }) => {
		const user = requireRole(locals.user, 'ENGINEER');
		const patientId = String((await request.formData()).get('patientId') ?? '');
		const device = await prisma.device.findUnique({ where: { id: params.id } });
		if (!device) throw error(404, 'Device not found');
		if (device.status !== 'Available') return fail(409, { error: `${device.displayCode} is not available.` });
		const patient = await prisma.patient.findUnique({ where: { id: patientId } });
		if (!patient) return fail(400, { error: 'Choose a patient.' });

		await prisma.$transaction([
			prisma.device.update({ where: { id: device.id }, data: { status: 'In Use', currentPatientId: patient.id } }),
			prisma.deviceAssignment.create({
				data: { deviceId: device.id, patientId: patient.id, assignedDate: new Date(), status: 'In Use', assignedById: user.id }
			})
		]);
		await logDeviceEvent(device.id, 'assigned', `Assigned to patient ${patient.displayCode} by ${user.name}.`);
		await auditAs(user)({
			action: 'Device Assigned',
			entityType: 'Device',
			entityId: device.id,
			newValue: `Assigned to ${patient.displayCode}`
		});
		return { ok: true, message: `${device.displayCode} assigned to ${patient.displayCode}.` };
	},

	returnDevice: async ({ locals, params }) => {
		const user = requireRole(locals.user, 'ENGINEER');
		const device = await prisma.device.findUnique({ where: { id: params.id } });
		if (!device) throw error(404, 'Device not found');
		if (device.status !== 'In Use' || !device.currentPatientId) return fail(409, { error: 'This device is not assigned.' });

		await prisma.$transaction([
			prisma.deviceAssignment.updateMany({
				where: { deviceId: device.id, status: 'In Use' },
				data: { status: 'Returned', returnedDate: new Date() }
			}),
			prisma.device.update({ where: { id: device.id }, data: { status: 'Available', currentPatientId: null } })
		]);
		await logDeviceEvent(device.id, 'assigned', `Returned to inventory by ${user.name}.`);
		await auditAs(user)({ action: 'Device Returned', entityType: 'Device', entityId: device.id });
		return { ok: true, message: `${device.displayCode} returned to inventory.` };
	},

	logMaintenance: async ({ request, locals, params }) => {
		const user = requireRole(locals.user, 'ENGINEER');
		const parsed = maintenanceSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		const v = parsed.data;
		const device = await prisma.device.findUnique({ where: { id: params.id } });
		if (!device) throw error(404, 'Device not found');

		const day = new Date(Date.UTC(v.maintenanceDate.getUTCFullYear(), v.maintenanceDate.getUTCMonth(), v.maintenanceDate.getUTCDate()));
		const rec = await prisma.deviceMaintenance.create({
			data: { deviceId: device.id, maintenanceDate: day, maintenanceType: v.maintenanceType, engineerId: user.id, notes: v.notes || null }
		});
		await logDeviceEvent(device.id, 'maintenance', `${v.maintenanceType} by ${user.name}.`);
		await auditAs(user)({
			action: 'Maintenance Logged',
			entityType: 'Device Maintenance',
			entityId: rec.id,
			newValue: `${device.displayCode} · ${v.maintenanceType}`
		});
		return { ok: true, message: 'Maintenance logged.' };
	}
};
