import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { parse as devalueParse, unflatten } from 'devalue';

export const BASE = () => process.env.TEST_BASE_URL ?? 'http://localhost:5198';
export const PASSWORD = 'neurodash123';

export const USERS = {
	priya: 'priya.nair@neurodash.care', // therapist, Ranipet
	rohan: 'rohan.mehta@neurodash.care', // therapist, CMC Vellore
	vikram: 'vikram.suresh@neurodash.care', // consultant, Ranipet
	arjun: 'arjun.rao@neurodash.care', // engineer
	admin: 'biorehabilitationgroup@gmail.com'
} as const;

let _prisma: PrismaClient | undefined;
export const db = () =>
	(_prisma ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }) }));

export interface ActionResult<T = Record<string, unknown>> {
	type: 'success' | 'failure' | 'redirect' | 'error';
	status: number;
	data?: T;
	location?: string;
	raw: Response;
}

/** A tiny cookie-jar HTTP client that speaks SvelteKit form actions and JSON endpoints. */
export class Client {
	private cookies = new Map<string, string>();
	constructor(private origin = true) {}

	get sessionCookie() {
		return this.cookies.get('session');
	}
	setSession(id: string) {
		this.cookies.set('session', id);
	}

	private headers(extra: Record<string, string> = {}) {
		const h: Record<string, string> = { ...extra };
		if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
		if (this.origin) h.origin = BASE();
		return h;
	}

	private store(res: Response) {
		for (const c of res.headers.getSetCookie()) {
			const [pair] = c.split(';');
			const i = pair.indexOf('=');
			const name = pair.slice(0, i);
			const value = pair.slice(i + 1);
			if (!value || /max-age=0|expires=thu, 01 jan 1970/i.test(c)) this.cookies.delete(name);
			else this.cookies.set(name, value);
		}
	}

	async get(path: string): Promise<Response> {
		const res = await fetch(BASE() + path, { headers: this.headers(), redirect: 'manual' });
		this.store(res);
		return res;
	}

	async json<T = any>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<{ status: number; body: T; res: Response }> {
		const res = await fetch(BASE() + path, {
			method,
			headers: this.headers({ 'content-type': 'application/json' }),
			body: body === undefined ? undefined : JSON.stringify(body),
			redirect: 'manual'
		});
		this.store(res);
		const text = await res.text();
		let parsed: any = null;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			parsed = text;
		}
		return { status: res.status, body: parsed, res };
	}

	/** POSTs a SvelteKit form action (`path` like `/patients/ID?/setStatus`) and decodes the result. */
	async action<T = Record<string, unknown>>(path: string, fields: Record<string, string | Blob | (string | Blob)[]> = {}): Promise<ActionResult<T>> {
		const fd = new FormData();
		for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
		const res = await fetch(BASE() + path, {
			method: 'POST',
			headers: this.headers({ 'x-sveltekit-action': 'true', accept: 'application/json' }),
			body: fd,
			redirect: 'manual'
		});
		this.store(res);

		// Actions that throw error()/redirect() may answer with a plain HTTP status instead of an action envelope.
		const text = await res.text();
		let env: any = null;
		try {
			env = JSON.parse(text);
		} catch {
			/* not JSON */
		}
		if (!env || typeof env.type !== 'string') {
			return { type: res.status >= 300 && res.status < 400 ? 'redirect' : 'error', status: res.status, location: res.headers.get('location') ?? undefined, raw: res };
		}
		return {
			type: env.type,
			status: env.type === 'redirect' ? env.status : env.status ?? res.status,
			location: env.location,
			data: env.data ? (devalueParse(env.data) as T) : undefined,
			raw: res
		};
	}

	async login(email: string, password = PASSWORD) {
		return this.action('/login?/login', { email, password });
	}
}

export async function loginAs(email: string, password = PASSWORD) {
	const c = new Client();
	const r = await c.login(email, password);
	if (r.type !== 'redirect' && !(r.data as { mustResetPassword?: boolean } | undefined)?.mustResetPassword) {
		throw new Error(`Login as ${email} failed: ${JSON.stringify(r.data)} (${r.status})`);
	}
	return c;
}

/** Signs in once per role for the suite. */
export async function signInAll() {
	return {
		priya: await loginAs(USERS.priya),
		rohan: await loginAs(USERS.rohan),
		vikram: await loginAs(USERS.vikram),
		arjun: await loginAs(USERS.arjun),
		admin: await loginAs(USERS.admin),
		anon: new Client()
	};
}
export type Sessions = Awaited<ReturnType<typeof signInAll>>;

let n = 0;
export const uniq = (p = 'x') => `${p}${Date.now().toString(36)}${(n++).toString(36)}`;

export const PDF = (label = 'scan') => new File([`%PDF-1.4\n% ${label}\n`], `${label}.pdf`, { type: 'application/pdf' });
export const PNG = () =>
	new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], 'photo.png', { type: 'image/png' });

/** Creates a patient as Priya (Ranipet) and returns its id. */
export async function createPatient(therapist: Client, code = uniq('Pat')): Promise<string> {
	// The Patient ID doubles as the patient's label (no name is collected).
	const r = await therapist.action('/patients/new', { patientId: code, dob: '1970-01-01', gender: 'Female', affectedSide: 'Left' });
	if (r.type !== 'redirect' || !r.location) throw new Error(`createPatient failed: ${JSON.stringify(r.data)} ${r.status}`);
	return r.location.split('/patients/')[1].split('?')[0];
}

/** Creates an active user via the admin API and completes the forced password reset. */
export async function createUser(admin: Client, opts: { role: 'THERAPIST' | 'CONSULTANT' | 'ENGINEER'; locationId?: string; name?: string }) {
	const email = `${uniq('u')}@test.neurodash`;
	const r = await admin.action<{ tempPassword: string }>('/users?/create', {
		name: opts.name ?? `Test ${opts.role}`,
		email,
		role: opts.role,
		...(opts.locationId ? { locationId: opts.locationId } : {})
	});
	if (r.type !== 'success' || !r.data?.tempPassword) throw new Error(`createUser failed: ${JSON.stringify(r.data)}`);
	const c = new Client();
	await c.login(email, r.data.tempPassword);
	const s = await c.action('/login?/setPassword', { password: PASSWORD, confirm: PASSWORD });
	if (s.type !== 'redirect') throw new Error(`setPassword failed: ${JSON.stringify(s.data)}`);
	return { email, client: c, tempPassword: r.data.tempPassword };
}

export const downtownId = async () => (await db().location.findUniqueOrThrow({ where: { name: 'CMC Ranipet' } })).id;
export const northId = async () => (await db().location.findUniqueOrThrow({ where: { name: 'CMC Vellore' } })).id;

/** Reads a page's server `load` data (merged layout + page) via SvelteKit's __data.json endpoint. */
export async function pageData<T = any>(client: Client, path: string): Promise<T> {
	const [pathname, query] = path.split('?');
	const res = await client.get(`${pathname.replace(/\/$/, '')}/__data.json${query ? `?${query}` : ''}`);
	if (res.status !== 200) throw new Error(`pageData ${path} -> ${res.status}`);
	const body = (await res.json()) as { nodes: { type: string; data?: unknown[] }[] };
	const merged: Record<string, unknown> = {};
	for (const n of body.nodes) if (n?.type === 'data' && n.data) Object.assign(merged, unflatten(n.data));
	return merged as T;
}
