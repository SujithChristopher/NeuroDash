import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole, requireUser } from '$lib/server/guard';
import { deviceScopeFor } from '$lib/server/scope';
import { auditAs } from '$lib/server/audit';
import { deviceUsage, logDeviceEvent } from '$lib/server/devices';
import { MAINTENANCE_TYPES } from '$lib/deviceEvents';
import { utcDay } from '$lib/utils';

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = requireUser(locals.user);
	const d = await prisma.device.findFirst({
		where: { AND: [{ id: params.id }, deviceScopeFor(user)] }, // out-of-centre devices are a 404 for therapists

		include: {
			deviceType: { include: { mechanisms: true, games: true } },
			centre: { select: { id: true, name: true } },
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

	const [usage, recent, games, patientsUsing, recentSessions, centres] = await Promise.all([
		deviceUsage(d.id),
		prisma.therapySession.findMany({
			where: { deviceId: d.id, sessionDate: { gte: since } },
			select: { sessionDate: true, durationMinutes: true }
		}),
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
		isEngineer ? prisma.location.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }) : Promise.resolve([])
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
		centres,
		maintenanceTypes: MAINTENANCE_TYPES,
		device: {
			id: d.id,
			displayCode: d.displayCode,
			serialNumber: d.serialNumber,
			firmwareVersion: d.firmwareVersion,
			status: d.status,
			location: d.location,
			centre: d.centre ? { id: d.centre.id, name: d.centre.name } : null,
			registeredOn: d.registeredOn.toISOString(),
			lastSyncAt: d.lastSyncAt?.toISOString() ?? null,
			type: {
				id: d.deviceType.id,
				name: d.deviceType.name,
				category: d.deviceType.category,
				colorSeries: d.deviceType.colorSeries,
				mechanisms: d.deviceType.mechanisms.map((m) => m.mechanismName),
				games: d.deviceType.games.map((g) => g.displayLabel)
			}
		},
		stats: {
			sessions: u?.sessions ?? 0,
			totalMin: u?.totalMin ?? 0,
			patients: u?.patients ?? 0,
			sessionsPerWeek: u?.sessionsPerWeek ?? 0,
			activeDays30: u?.activeDays30 ?? 0,
			firstDay: u?.firstDay ?? null,
			lastDay: u?.lastDay ?? null,
			patientsUsing: patientsUsing.map((p) => ({ id: p.patient.id, label: label(p.patient), code: p.patient.displayCode }))
		},
		utilization: { labels: days, minutes: days.map((k) => Math.round(minutes.get(k) ?? 0)) },
		games: games.map((g) => ({ label: gameLabel.get(g.gameId!) ?? g.gameId!, count: g._count._all })),
		recentSessions: recentSessions.map((s) => ({
			id: s.id,
			patient: label(s.patient),
			startTime: s.startTime.toISOString(),
			durationMinutes: s.durationMinutes == null ? null : Number(s.durationMinutes)
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
	// Engineers set a unit up at a centre (or return it to stock with an empty centre).
	setCentre: async ({ request, locals, params }) => {
		const user = requireRole(locals.user, 'ENGINEER');
		const locationId = String((await request.formData()).get('locationId') ?? '');
		const device = await prisma.device.findUnique({ where: { id: params.id }, include: { centre: { select: { name: true } } } });
		if (!device) throw error(404, 'Device not found');
		const centre = locationId ? await prisma.location.findUnique({ where: { id: locationId } }) : null;
		if (locationId && !centre) return fail(400, { error: 'Choose a centre.' });
		if ((device.locationId ?? '') === locationId) return fail(400, { error: 'The device is already there.' });

		await prisma.device.update({ where: { id: device.id }, data: { locationId: centre?.id ?? null } });
		const text = centre ? `Set up at ${centre.name} by ${user.name}.` : `Returned to stock by ${user.name}.`;
		await logDeviceEvent(device.id, 'assigned', text);
		await auditAs(user)({
			action: centre ? 'Device Set Up' : 'Device Returned to Stock',
			entityType: 'Device',
			entityId: device.id,
			previousValue: device.centre?.name ?? 'In stock',
			newValue: centre?.name ?? 'In stock'
		});
		return { ok: true, message: centre ? `${device.displayCode} set up at ${centre.name}.` : `${device.displayCode} returned to stock.` };
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
