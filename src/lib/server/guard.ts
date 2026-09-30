import { error, redirect } from '@sveltejs/kit';

type Role = 'THERAPIST' | 'CONSULTANT' | 'ENGINEER' | 'ADMIN';
type User = NonNullable<App.Locals['user']>;

/** Throws a redirect to /login when signed out, 403 when the role isn't allowed. */
export function requireRole(user: App.Locals['user'], ...roles: Role[]): User {
	if (!user) throw redirect(302, '/login');
	if (roles.length && !roles.includes(user.role)) throw error(403, 'You do not have access to this.');
	return user;
}

export function requireUser(user: App.Locals['user']): User {
	if (!user) throw redirect(302, '/login');
	return user;
}

/** Like requireRole, but for JSON/file endpoints: a signed-out caller gets 401, never a redirect to the login page. */
export function requireApiRole(user: App.Locals['user'], ...roles: Role[]): User {
	if (!user) throw error(401, 'Sign in required.');
	if (roles.length && !roles.includes(user.role)) throw error(403, 'You do not have access to this.');
	return user;
}
