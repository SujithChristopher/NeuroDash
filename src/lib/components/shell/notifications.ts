import { DB, scopeUnits, OPEN_FAULT, daysToCal } from '$lib/data/db';
import { typeOf } from '$lib/data/reference';
import { userOf, type User } from '$lib/data/users';
import { addDays, esc } from '$lib/data/seed';
import { get } from 'svelte/store';
import { notificationsRead } from '$lib/stores/ui';

export interface NotificationItem {
	id: string;
	tone: 'crit' | 'warn' | 'accent' | 'good' | '';
	title: string;
	desc: string;
	date: Date;
	href: string;
}

export function notifications(user: User): NotificationItem[] {
	const out: NotificationItem[] = [];
	const add = (id: string, tone: NotificationItem['tone'], title: string, desc: string, date: Date, href: string) =>
		out.push({ id, tone, title, desc, date, href });

	// Therapist "Today" items (therapistActions()) depend on patientMetrics(),
	// which lands with the Therapist view sub-project. Empty here is correct, not a stub.
	if (user.role === 'consultant') {
		DB.patients
			.filter((p) => p.plan)
			.forEach((p) =>
				p.plan!.history
					.slice(1)
					.filter((h) => (+new Date() - +h.date) / 86400000 <= 7)
					.forEach((h, i) => add('pc' + p.id + i, 'accent', 'Plan changed · ' + esc(p.name), esc(h.text), h.date, '/patients/' + p.id))
			);
	}
	// Consultant/admin "declining patient" items also depend on patientMetrics() — deferred.

	if (user.role === 'engineer' || user.role === 'admin') {
		const ids = scopeUnits(user).map((u) => u.id);
		DB.faults
			.filter((f) => OPEN_FAULT(f) && ids.includes(f.unitId))
			.forEach((f) =>
				add(
					f.id + f.status,
					f.severity === 'Critical' || f.severity === 'High' ? 'crit' : 'warn',
					f.severity + ' ticket · ' + esc(f.unitId),
					esc(f.desc),
					f.opened,
					'/service'
				)
			);
		DB.requests
			.filter((q) => q.status === 'Pending' && (user.role === 'admin' || (user.owns ?? []).includes(q.typeId)))
			.forEach((q) => add(q.id, 'accent', 'Device request · ' + (typeOf(q.typeId)?.name ?? q.typeId), esc(userOf(q.requestedBy)!.name), q.date, '/requests'));
		DB.units
			.filter((u) => ids.includes(u.id) && daysToCal(u) <= 7)
			.forEach((u) =>
				add(
					'cal' + u.id,
					'warn',
					'Calibration ' + (daysToCal(u) < 0 ? 'overdue' : 'due') + ' · ' + u.id,
					daysToCal(u) < 0 ? -daysToCal(u) + ' days overdue' : 'Due in ' + daysToCal(u) + ' days',
					addDays(u.lastCal, u.calInterval - 7),
					'/fleet/' + u.id
				)
			);
	}
	return out.sort((a, b) => +b.date - +a.date);
}

export function unreadCount(user: User): number {
	const read = get(notificationsRead);
	return notifications(user).filter((n) => !read.has(n.id)).length;
}
