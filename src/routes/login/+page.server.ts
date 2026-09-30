import { dev } from '$app/environment';
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import {
	createSession,
	destroySession,
	getSession,
	hashPassword,
	verifyPassword
} from '$lib/server/auth';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from '$lib/server/session-cookie';
import { generateTempPassword } from '$lib/server/tempPassword';
import { notifyRole } from '$lib/server/notify';
import { logAudit } from '$lib/server/audit';

const DEMO_EMAILS = [
	['THERAPIST', 'priya.nair@neurodash.care'],
	['CONSULTANT', 'vikram.suresh@neurodash.care'],
	['ENGINEER', 'arjun.rao@neurodash.care'],
	['ADMIN', 'biorehabilitationgroup@gmail.com']
] as const;

export const load: PageServerLoad = async ({ locals, cookies }) => {
	if (locals.user) throw redirect(302, '/');

	// A valid password-reset session means the user already passed the temp-password step.
	const session = await getSession(cookies.get(SESSION_COOKIE));
	const mustResetPassword = session?.purpose === 'password-reset';

	const [patients, devices, deviceTypes, demoUsers] = await Promise.all([
		prisma.patient.count({ where: { status: 'Active' } }),
		prisma.device.count(),
		prisma.deviceType.count(),
		dev
			? prisma.user.findMany({
					where: { email: { in: DEMO_EMAILS.map(([, e]) => e) } },
					select: { name: true, email: true, role: true }
				})
			: Promise.resolve([])
	]);

	return {
		mustResetPassword,
		stats: { patients, devices, deviceTypes },
		demoUsers: DEMO_EMAILS.flatMap(([role]) => demoUsers.filter((u) => u.role === role)),
		showDemoHint: dev
	};
};

const loginSchema = z.object({
	email: z.string().trim().toLowerCase().min(1).max(254),
	password: z.string().min(1).max(200)
});

const setPasswordSchema = z
	.object({
		password: z.string().min(8, 'Use at least 8 characters.').max(200),
		confirm: z.string()
	})
	.refine((v) => v.password === v.confirm, { message: 'Passwords do not match.', path: ['confirm'] });

const forgotSchema = z.object({ email: z.string().trim().toLowerCase().min(1).max(254) });

const GENERIC_FORGOT =
	'If that email belongs to an account, a password reset has been requested. Your administrator will share a temporary password with you.';

export const actions: Actions = {
	login: async ({ request, cookies }) => {
		const form = loginSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!form.success) return fail(400, { error: 'Enter your email and password.' });

		const user = await prisma.user.findUnique({ where: { email: form.data.email } });
		const ok = user && user.isActive && (await verifyPassword(form.data.password, user.passwordHash));
		if (!user || !ok) {
			return fail(400, { error: 'Invalid email or password.', email: form.data.email });
		}

		if (user.mustResetPassword) {
			const s = await createSession(user.id, 'password-reset');
			setSessionCookie(cookies, s.id, s.expiresAt);
			return { mustResetPassword: true };
		}

		const s = await createSession(user.id, 'access');
		setSessionCookie(cookies, s.id, s.expiresAt);
		await logAudit({
			actorUserId: user.id,
			actorRole: user.role,
			action: 'Signed In',
			entityType: 'User',
			entityId: user.id
		});
		throw redirect(303, '/');
	},

	setPassword: async ({ request, cookies }) => {
		const session = await getSession(cookies.get(SESSION_COOKIE));
		if (!session || session.purpose !== 'password-reset') {
			clearSessionCookie(cookies);
			return fail(401, { error: 'Your reset session has expired. Sign in again.' });
		}

		const form = setPasswordSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!form.success) {
			return fail(400, { mustResetPassword: true, error: form.error.issues[0].message });
		}

		const user = session.user;
		if (await verifyPassword(form.data.password, user.passwordHash)) {
			return fail(400, {
				mustResetPassword: true,
				error: 'Choose a password different from your temporary one.'
			});
		}

		await prisma.user.update({
			where: { id: user.id },
			data: { passwordHash: await hashPassword(form.data.password), mustResetPassword: false }
		});
		await destroySession(session.id);
		const s = await createSession(user.id, 'access');
		setSessionCookie(cookies, s.id, s.expiresAt);
		await logAudit({
			actorUserId: user.id,
			actorRole: user.role,
			action: 'Password Set',
			entityType: 'User',
			entityId: user.id
		});
		throw redirect(303, '/');
	},

	forgotPassword: async ({ request }) => {
		const form = forgotSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!form.success) return fail(400, { forgotError: 'Enter your email address.' });

		const user = await prisma.user.findUnique({ where: { email: form.data.email } });
		// Unknown emails get the same reply — no account-enumeration leak.
		if (user && user.isActive) {
			const temp = generateTempPassword();
			await prisma.user.update({
				where: { id: user.id },
				data: { passwordHash: await hashPassword(temp), mustResetPassword: true }
			});
			await notifyRole('ADMIN', {
				notifType: 'system',
				tone: 'warning',
				icon: 'shield',
				title: `Password reset requested — ${user.name}`,
				description: `${user.name} (${user.email}) requested a password reset. Temporary password: ${temp}`,
				link: { page: 'users' }
			});
			await logAudit({
				actorUserId: null,
				actorRole: 'SYSTEM',
				action: 'Password Reset Requested',
				entityType: 'User',
				entityId: user.id
			});
		}
		return { forgotMessage: GENERIC_FORGOT };
	}
};
