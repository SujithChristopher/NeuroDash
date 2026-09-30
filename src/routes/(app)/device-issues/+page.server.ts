import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { requireRole } from '$lib/server/guard';
import { auditAs } from '$lib/server/audit';
import { notifyRole, notifyUser } from '$lib/server/notify';
import { logDeviceEvent } from '$lib/server/devices';
import { ISSUE_SEVERITIES, REQUEST_PENDING } from '$lib/constants';

const issueInclude = {
	device: { select: { id: true, displayCode: true } },
	openedBy: { select: { name: true } },
	engineer: { select: { name: true } },
	troubleshootingLog: { orderBy: { loggedAt: 'asc' }, include: { loggedBy: { select: { name: true } } } }
} as const;

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireRole(locals.user, 'ENGINEER', 'ADMIN');

	const [issues, pending, available, devices] = await Promise.all([
		prisma.deviceIssue.findMany({ orderBy: { openedAt: 'desc' }, include: issueInclude }),
		prisma.deviceRequest.findMany({
			where: { status: REQUEST_PENDING },
			orderBy: { requestedAt: 'asc' },
			include: {
				patient: { select: { displayCode: true } },
				therapist: { select: { name: true } },
				deviceType: { select: { id: true, name: true } }
			}
		}),
		prisma.device.findMany({
			where: { status: 'Available' },
			select: { id: true, displayCode: true, deviceTypeId: true }
		}),
		prisma.device.findMany({ select: { id: true, displayCode: true }, orderBy: { displayCode: 'asc' } })
	]);

	const shape = (i: (typeof issues)[number]) => ({
		id: i.id,
		device: i.device,
		description: i.description,
		severity: i.severity,
		status: i.status,
		openedAt: i.openedAt.toISOString(),
		openedBy: i.openedBy.name,
		engineer: i.engineer?.name ?? null,
		resolution: i.resolution,
		partsReplaced: i.partsReplaced,
		clearedAt: i.clearedAt?.toISOString() ?? null,
		log: i.troubleshootingLog.map((l) => ({ id: l.id, at: l.loggedAt.toISOString(), by: l.loggedBy.name, note: l.note }))
	});

	return {
		canAct: user.role === 'ENGINEER',
		devices,
		available,
		pending: pending.map((r) => ({
			id: r.id,
			status: r.status,
			therapist: r.therapist.name,
			patientCode: r.patient.displayCode,
			deviceType: r.deviceType,
			requestedAt: r.requestedAt.toISOString()
		})),
		open: issues.filter((i) => !['Resolved', 'Cleared'].includes(i.status)).map(shape),
		closed: issues.filter((i) => ['Resolved', 'Cleared'].includes(i.status)).slice(0, 10).map(shape)
	};
};

async function loadIssue(id: string) {
	const issue = await prisma.deviceIssue.findUnique({ where: { id }, include: { device: true } });
	if (!issue) throw error(404, 'Issue not found');
	return issue;
}

const reportSchema = z.object({
	deviceId: z.string().min(1, 'Choose a device.'),
	severity: z.enum(ISSUE_SEVERITIES),
	issueType: z.string().trim().max(200).optional(),
	description: z.string().trim().max(2000).optional()
});

export const actions: Actions = {
	report: async ({ request, locals }) => {
		const user = requireRole(locals.user, 'THERAPIST', 'ENGINEER');
		const parsed = reportSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		const v = parsed.data;

		const description = [v.issueType, v.description].filter(Boolean).join(' — ');
		if (!description) return fail(400, { error: 'Describe the issue.' });
		const device = await prisma.device.findUnique({ where: { id: v.deviceId } });
		if (!device) return fail(404, { error: 'Device not found.' });

		const issue = await prisma.deviceIssue.create({
			data: { deviceId: device.id, description, severity: v.severity, openedById: user.id }
		});
		await prisma.device.update({ where: { id: device.id }, data: { status: 'Issue Detected' } });
		await logDeviceEvent(device.id, 'issue', `Issue reported (${v.severity}) by ${user.name}: ${description}`);
		await notifyRole('ENGINEER', {
			notifType: 'issue',
			tone: v.severity === 'High' || v.severity === 'Critical' ? 'critical' : 'warning',
			icon: 'alert',
			title: 'New device issue reported',
			description: `${user.name} reported a ${v.severity.toLowerCase()}-severity issue on ${device.displayCode}: ${description}`,
			link: { page: 'device-issues' }
		});
		await auditAs(user)({
			action: 'Issue Reported',
			entityType: 'Device Issue',
			entityId: issue.id,
			newValue: `${device.displayCode} · ${v.severity} — ${description}`
		});
		return { ok: true, message: `Issue reported for ${device.displayCode}. Engineering has been notified.` };
	},

	investigate: async ({ request, locals }) => {
		const user = requireRole(locals.user, 'ENGINEER');
		const issue = await loadIssue(String((await request.formData()).get('id')));
		if (issue.status !== 'Open') return fail(409, { error: `Issue is already ${issue.status}.` });

		await prisma.deviceIssue.update({ where: { id: issue.id }, data: { status: 'Investigating', engineerId: user.id } });
		await prisma.issueTroubleshootingLog.create({
			data: { issueId: issue.id, loggedById: user.id, note: 'Investigation started.' }
		});
		await prisma.device.update({ where: { id: issue.deviceId }, data: { status: 'Awaiting Engineer' } });
		await logDeviceEvent(issue.deviceId, 'investigating', `${user.name} began investigation.`);
		await auditAs(user)({
			action: 'Issue Investigation Started',
			entityType: 'Device Issue',
			entityId: issue.id,
			previousValue: 'Open',
			newValue: 'Investigating'
		});
		return { ok: true, message: `Investigation started on ${issue.device.displayCode}.` };
	},

	log: async ({ request, locals }) => {
		const user = requireRole(locals.user, 'ENGINEER');
		const fd = await request.formData();
		const issue = await loadIssue(String(fd.get('id')));
		const note = String(fd.get('note') ?? '').trim();
		if (!note) return fail(400, { error: 'Write a troubleshooting note first.' });
		if (['Resolved', 'Cleared'].includes(issue.status)) return fail(409, { error: 'This issue is closed.' });
		await prisma.issueTroubleshootingLog.create({
			data: { issueId: issue.id, loggedById: user.id, note: note.slice(0, 2000) }
		});
		return { ok: true, message: 'Troubleshooting note added.' };
	},

	resolve: async ({ request, locals }) => {
		const user = requireRole(locals.user, 'ENGINEER');
		const fd = await request.formData();
		const issue = await loadIssue(String(fd.get('id')));
		const resolution = String(fd.get('resolution') ?? '').trim();
		const parts = String(fd.get('partsReplaced') ?? '').trim();
		if (!resolution) return fail(400, { error: 'Describe how the issue was resolved.' });
		if (issue.status !== 'Investigating') return fail(409, { error: 'Start an investigation before resolving.' });

		await prisma.deviceIssue.update({
			where: { id: issue.id },
			data: { status: 'Resolved', resolution: resolution.slice(0, 2000), partsReplaced: parts.slice(0, 500) || null, resolvedAt: new Date() }
		});
		await prisma.issueTroubleshootingLog.create({
			data: { issueId: issue.id, loggedById: user.id, note: `Resolved: ${resolution}`.slice(0, 2000) }
		});
		await logDeviceEvent(issue.deviceId, 'resolved', `Issue resolved by ${user.name}: ${resolution}`);
		await auditAs(user)({
			action: 'Issue Resolved',
			entityType: 'Device Issue',
			entityId: issue.id,
			previousValue: 'Investigating',
			newValue: 'Resolved',
			notes: resolution
		});
		return { ok: true, message: 'Issue marked resolved. Verify and clear the device to return it to service.' };
	},

	clear: async ({ request, locals }) => {
		// Engineers only — consultants are read-only apart from adding notes.
		const user = requireRole(locals.user, 'ENGINEER');
		const issue = await loadIssue(String((await request.formData()).get('id')));
		if (issue.status !== 'Resolved') return fail(409, { error: 'Only resolved issues can be cleared.' });

		await prisma.deviceIssue.update({
			where: { id: issue.id },
			data: { status: 'Cleared', clearedAt: new Date(), verifiedById: user.id }
		});
		await prisma.device.update({
			where: { id: issue.deviceId },
			data: { status: issue.device.currentPatientId ? 'In Use' : 'Available' }
		});
		await logDeviceEvent(issue.deviceId, 'cleared', `Device cleared for patient use by ${user.name}.`);
		await notifyUser(issue.openedById, {
			notifType: 'issue',
			tone: 'good',
			icon: 'check',
			title: 'Device issue cleared',
			description: `${issue.device.displayCode} — the issue you reported has been resolved and the device cleared by ${user.name}.`,
			link: { page: `devices/${issue.deviceId}` }
		});
		await auditAs(user)({
			action: 'Device Cleared',
			entityType: 'Device Issue',
			entityId: issue.id,
			previousValue: 'Resolved',
			newValue: 'Cleared'
		});
		return { ok: true, message: `${issue.device.displayCode} cleared and returned to service.` };
	}
};
