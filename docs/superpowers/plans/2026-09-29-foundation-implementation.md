# NeuroDash Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the shared foundation of the NeuroDash prototype (`backup/neurodash-v2 (1).html`) into the SvelteKit app: design system, deterministic fake-data layer, demo auth, and role-aware app shell (nav, command palette, notifications), with placeholder pages proving every route/role combination works end-to-end.

**Architecture:** Real SvelteKit routes (SSR disabled app-wide) replace the prototype's hash router. A plain TS module (`src/lib/data/`) builds the same deterministic fake dataset the original generated client-side. Svelte stores (`src/lib/stores/`) replace the original's global mutable `STATE`. CSS custom properties + component classes are ported near-verbatim into global stylesheets. Reusable UI is built as Svelte components under `src/lib/components/`.

**Tech Stack:** SvelteKit (Svelte 5, runes mode), TypeScript, Vitest (data-layer unit tests only — no UI test framework, per spec).

**Spec:** `docs/superpowers/specs/2026-09-29-foundation-design.md`

## Global Constraints

- SSR is disabled app-wide (`export const ssr = false` in root layout) — the app is fully client-rendered, matching the original SPA.
- The fake dataset must be built with the same seed (`20260918`) and same generation logic as the original, so output is deterministic and matches the prototype's numbers/dates.
- CSS is ported near-verbatim (custom properties + component classes) — no Tailwind, no CSS-in-JS.
- Auth is demo-only: one shared password (`neuro@123`) across all seeded users, no real backend. This is intentional, not a shortcut to fix later.
- No automated UI test suite. The data layer (pure TS, no DOM) gets real Vitest unit tests. UI components are verified manually via the dev server.
- Foundation does not implement `patientMetrics()` / `therapistActions()` / `reviewReasons()` (patient-trend-derived logic) — those belong to the Therapist/Consultant view sub-projects. Anywhere the original's shell chrome depended on them (nav count badges for "Today"/"Clinical review", therapist/declining-patient notifications), this plan uses `0` / an empty list with an inline comment pointing at the sub-project that will complete it. This is real, correct behavior for what data currently exists — not a placeholder.
- `unitStatus`/`liveStatus`/`daysToCal` **are** included in Foundation's data layer (unlike patient metrics) because they only depend on fault/request/unit data, which Foundation owns, and the Command Palette / Notifications components need them to work correctly now.

## Review Focus

- **Wrong/empty login credentials** — must show the inline error and clear the password field, never throw. Test added to Task 7.
- **Unauthenticated direct navigation to a protected route** (typed URL, refresh) — must redirect to `/login`, never flash protected content. Test added to Task 22.
- **Role visiting a page outside their `NAV`** (e.g. therapist typing `/audit`) — `allowed(user, page)` is ported and unit-tested in Task 5, but wiring it into per-route SvelteKit navigation (vs. the original's single central router) is deferred — see "Known gap carried forward" at the end of this plan. Task 23's manual smoke test step 4 exercises and documents the current (404, not a "not allowed" card) behavior explicitly rather than silently missing it.
- **Stale persisted user id** (localStorage has a user id that no longer exists in `USERS`, e.g. after a seed change) — boot must not crash on `userOf(id)` returning `undefined`. Test added to Task 7.
- **Empty scoped lists** (e.g. admin with zero pending requests, engineer who owns a type with zero open faults) — Command Palette and Notifications must render their empty state, not throw on `[].reduce`/`Math.max()`-style edge cases. Test added to Tasks 5, 19, 20.

---

## File Structure

```
src/lib/data/
  seed.ts          # RNG + date/format utils
  reference.ts     # SCALES, DEVICE_TYPES, GAME_LABELS, ROOMS
  users.ts         # USERS, DEMO_PASSWORD, NAV, HOME, DENSITY, ROLE_LABEL, DETAIL
  generate.ts       # generateUnits/Patients/Assessments/Sessions/Faults/Requests/Audit
  db.ts             # assembled DB + scoping/access-control helpers
  icons.ts          # icon path registry + icon(name,size) svg-string helper
src/lib/stores/
  auth.ts           # currentUser store, login(), logout()
  theme.ts          # theme store (light/dark), density derived store
  ui.ts             # toasts, modal, commandPaletteOpen, notificationsRead stores
src/lib/styles/
  tokens.css        # custom properties, light/dark, role accents, density
  base.css          # component classes ported from the prototype
src/lib/components/ui/
  Icon.svelte, Avatar.svelte, Pill.svelte, Tag.svelte, Severity.svelte, ProgressBar.svelte
  Card.svelte, StatsStrip.svelte, KeyValueList.svelte, Banner.svelte
  Tabs.svelte, SegmentedControl.svelte, SearchBox.svelte, Toolbar.svelte, IconButton.svelte
  DataTable.svelte
  Modal.svelte, ToastHost.svelte, Tooltip.svelte
src/lib/components/shell/
  Sidebar.svelte, CommandPalette.svelte, NotificationsPopover.svelte, UserMenu.svelte, TopBar.svelte
src/routes/
  +layout.svelte, +layout.ts (ssr=false)
  login/+page.svelte
  (app)/+layout.ts, (app)/+layout.svelte, (app)/+page.svelte
  (app)/today/+page.svelte ... (app)/audit/+page.svelte  (11 placeholder pages)
  (app)/patients/[id]/+page.svelte, (app)/fleet/[id]/+page.svelte (stubs)
```

---

### Task 1: Add Vitest for the data layer

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: `npm run test` command, usable by every later task that adds a `*.test.ts` file under `src/lib/data/`.

- [ ] **Step 1: Install Vitest**

Run: `npm install -D vitest`

- [ ] **Step 2: Add the Vitest config**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts']
	}
});
```

- [ ] **Step 3: Add the test script**

Edit `package.json` scripts block to add:
```json
"test": "vitest run"
```

- [ ] **Step 4: Verify it runs with zero tests**

Run: `npm run test`
Expected: exits 0, "No test files found" is acceptable at this point (no `*.test.ts` exists yet) — if it errors instead of exiting cleanly, fix the config before continuing.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest for data-layer unit tests"
```

---

### Task 2: Seed / RNG / date / format utilities

**Files:**
- Create: `src/lib/data/seed.ts`
- Test: `src/lib/data/seed.test.ts`

**Interfaces:**
- Produces: `RNG()`, `rand(a,b)`, `randInt(a,b)`, `pick(arr)`, `clamp(v,a,b)`, `gauss()`, `round1(v)`, `DAY`, `TODAY`, `NOW`, `addDays(d,n)`, `dayKey(d)`, `daysAgo(d)`, `startOfDay(d)`, `MONTHS`, `WD`, `fmtD(d)`, `fmtDY(d)`, `fmtT(d)`, `rel(d)`, `esc(s)`, `pct(v)`, `uid(prefix)` — all consumed by Tasks 3–5.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/data/seed.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetSeed, RNG, rand, randInt, pick, clamp, gauss, round1, addDays, dayKey, startOfDay, fmtD, esc, uid } from './seed';

describe('RNG', () => {
	beforeEach(() => resetSeed(20260918));

	it('is deterministic for a given seed', () => {
		const a = [RNG(), RNG(), RNG()];
		resetSeed(20260918);
		const b = [RNG(), RNG(), RNG()];
		expect(a).toEqual(b);
	});

	it('rand stays within bounds', () => {
		for (let i = 0; i < 50; i++) {
			const v = rand(2, 5);
			expect(v).toBeGreaterThanOrEqual(2);
			expect(v).toBeLessThanOrEqual(5);
		}
	});

	it('randInt stays within inclusive bounds', () => {
		for (let i = 0; i < 50; i++) {
			const v = randInt(1, 3);
			expect([1, 2, 3]).toContain(v);
		}
	});

	it('pick returns an element from the array', () => {
		const arr = ['a', 'b', 'c'];
		expect(arr).toContain(pick(arr));
	});

	it('clamp bounds a value', () => {
		expect(clamp(10, 0, 5)).toBe(5);
		expect(clamp(-10, 0, 5)).toBe(0);
		expect(clamp(3, 0, 5)).toBe(3);
	});

	it('gauss returns a finite number', () => {
		expect(Number.isFinite(gauss())).toBe(true);
	});

	it('round1 rounds to one decimal', () => {
		expect(round1(1.2345)).toBe(1.2);
	});
});

describe('date helpers', () => {
	it('addDays advances by whole days', () => {
		const d = new Date(2026, 0, 1);
		expect(dayKey(addDays(d, 5))).toBe('2026-01-06');
	});

	it('startOfDay zeroes the time', () => {
		const d = new Date(2026, 0, 1, 13, 45);
		const s = startOfDay(d);
		expect(s.getHours()).toBe(0);
		expect(s.getMinutes()).toBe(0);
	});

	it('fmtD formats as "D Mon"', () => {
		expect(fmtD(new Date(2026, 8, 29))).toBe('29 Sep');
	});
});

describe('esc', () => {
	it('escapes html-significant characters', () => {
		expect(esc('<b>&"\'</b>')).toBe('&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
	});

	it('handles null/undefined as empty string', () => {
		expect(esc(null)).toBe('');
		expect(esc(undefined)).toBe('');
	});
});

describe('uid', () => {
	it('produces unique, prefixed ids', () => {
		const a = uid('AS'), b = uid('AS');
		expect(a).not.toBe(b);
		expect(a.startsWith('AS-')).toBe(true);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- seed`
Expected: FAIL — `./seed` module does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/data/seed.ts
let _seed = 20260918;

export function resetSeed(v: number) {
	_seed = v;
}

export function RNG(): number {
	_seed |= 0;
	_seed = (_seed + 0x6d2b79f5) | 0;
	let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const rand = (a: number, b: number) => a + RNG() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
export const pick = <T>(a: T[]): T => a[Math.floor(RNG() * a.length)];
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export function gauss(): number {
	let u = 0;
	while (!u) u = RNG();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * RNG());
}
export const round1 = (v: number) => Math.round(v * 10) / 10;

export const DAY = 86400000;
export const TODAY: Date = (() => {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d;
})();
export const NOW = new Date();

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
export const dayKey = (d: Date) =>
	d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const daysAgo = (d: Date) => Math.floor((+TODAY - +startOfDay(d)) / DAY);
export function startOfDay(d: Date): Date {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const fmtD = (d: Date) => d.getDate() + ' ' + MONTHS[d.getMonth()];
export const fmtDY = (d: Date) => d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
export const fmtT = (d: Date) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

export function rel(d: Date): string {
	const ms = +NOW - +d,
		h = ms / 3600000;
	if (h < 0) {
		const dd = Math.ceil(-ms / DAY);
		return 'in ' + dd + ' d';
	}
	if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min ago';
	if (h < 24) return Math.round(h) + ' h ago';
	const dd = Math.round(h / 24);
	return dd === 1 ? 'yesterday' : dd + ' d ago';
}

export const esc = (s: unknown) =>
	String(s == null ? '' : s).replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
	);
export const pct = (v: number) => Math.round(v * 100) + '%';

let _uid = 1000;
export const uid = (p: string) => p + '-' + ++_uid;
```

Note: `resetSeed` is a test-only addition (the original had no equivalent since it never needed to reset mid-run); production code calls `RNG()` without ever calling `resetSeed` again after module load.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- seed`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/seed.ts src/lib/data/seed.test.ts
git commit -m "feat: port RNG and date/format utilities"
```

---

### Task 3: Reference data & users

**Files:**
- Create: `src/lib/data/reference.ts`
- Create: `src/lib/data/users.ts`
- Test: `src/lib/data/users.test.ts`

**Interfaces:**
- Consumes: nothing (pure data).
- Produces: `SCALES`, `DEVICE_TYPES`, `GAME_LABELS`, `ROOMS`, `typeOf(id)` from `reference.ts`; `USERS`, `DEMO_PASSWORD`, `userOf(id)`, `usersByRole(role)`, `ownerOfType(typeId)`, `ROLE_LABEL`, `DENSITY`, `HOME`, `NAV`, `DETAIL` from `users.ts` — consumed by Tasks 4, 5, and every shell component.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/data/users.test.ts
import { describe, it, expect } from 'vitest';
import { USERS, DEMO_PASSWORD, userOf, usersByRole, ownerOfType, NAV, HOME, DENSITY } from './users';

describe('USERS', () => {
	it('has 10 seeded users across 4 roles', () => {
		expect(USERS).toHaveLength(10);
		const roles = new Set(USERS.map((u) => u.role));
		expect(roles).toEqual(new Set(['therapist', 'consultant', 'engineer', 'admin']));
	});

	it('derives login/email/status for every user', () => {
		for (const u of USERS) {
			expect(u.login).toMatch(/^[a-z.]+$/);
			expect(u.email.endsWith('@neurorehab.org')).toBe(true);
			expect(u.status).toBe('Active');
		}
	});

	it('userOf finds by id, undefined for unknown id', () => {
		expect(userOf('U-T1')?.name).toBe('Priya Nair');
		expect(userOf('U-NOPE')).toBeUndefined();
	});

	it('usersByRole filters correctly', () => {
		expect(usersByRole('engineer')).toHaveLength(3);
	});

	it('ownerOfType finds the engineer who owns a device type', () => {
		expect(ownerOfType('PLUTO')?.id).toBe('U-E1');
		expect(ownerOfType('NOPE')).toBeUndefined();
	});

	it('DEMO_PASSWORD is shared and non-empty', () => {
		expect(DEMO_PASSWORD.length).toBeGreaterThan(0);
	});
});

describe('NAV / HOME / DENSITY', () => {
	it('every role has a HOME page listed in its own NAV', () => {
		for (const role of Object.keys(HOME) as (keyof typeof HOME)[]) {
			const pages = NAV[role].filter((n): n is [string, string, string] => Array.isArray(n)).map((n) => n[0]);
			expect(pages).toContain(HOME[role]);
		}
	});

	it('every role has a density', () => {
		for (const role of Object.keys(HOME) as (keyof typeof HOME)[]) {
			expect(DENSITY[role]).toBeTruthy();
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- users`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Write `reference.ts`**

```ts
// src/lib/data/reference.ts
export const SCALES = {
	'FMA-UE': { name: 'Fugl-Meyer Upper Extremity', max: 66, mcid: 5 },
	BBS: { name: 'Berg Balance Scale', max: 56, mcid: 4 }
} as const;
export type ScaleId = keyof typeof SCALES;

export interface DeviceType {
	id: string;
	name: string;
	category: string;
	scale: ScaleId;
	outUnit: string;
	outLimit: number;
	units: number;
	mechanisms: string[];
	games: string[];
}

export const DEVICE_TYPES: DeviceType[] = [
	{
		id: 'PLUTO',
		name: 'Pluto',
		category: 'Wrist & Hand Robot',
		scale: 'FMA-UE',
		outUnit: 'Nm',
		outLimit: 1.2,
		units: 4,
		mechanisms: ['Wrist Flex/Ext', 'Pronation/Supination', 'Hand Open/Close'],
		games: ['HAT', 'FruitBasket', 'PongGame']
	},
	{
		id: 'MARS',
		name: 'Mars',
		category: 'Arm Support Robot',
		scale: 'FMA-UE',
		outUnit: 'Nm',
		outLimit: 8.0,
		units: 3,
		mechanisms: ['Shoulder Flexion', 'Elbow Extension', 'Reach & Grasp'],
		games: ['PongGame', 'TukTuk']
	},
	{
		id: 'ORION',
		name: 'Orion',
		category: 'Grip & Pinch Trainer',
		scale: 'FMA-UE',
		outUnit: 'N',
		outLimit: 60,
		units: 2,
		mechanisms: ['Cylindrical Grip', 'Pinch Grip', 'Finger Extension'],
		games: ['RNR', 'HatRick']
	},
	{
		id: 'VEGA',
		name: 'Vega',
		category: 'Balance & Lower-Limb Trainer',
		scale: 'BBS',
		outUnit: 'N',
		outLimit: 400,
		units: 2,
		mechanisms: ['Weight Shift', 'Ankle Dorsiflexion', 'Sit-to-Stand'],
		games: ['TukTuk', 'PongGame']
	},
	{
		id: 'COSMOS',
		name: 'Cosmos',
		category: 'Fine Motor Game Station',
		scale: 'FMA-UE',
		outUnit: 'N',
		outLimit: 25,
		units: 2,
		mechanisms: ['Precision Reach', 'Bimanual Coordination'],
		games: ['FruitBasket', 'HatRick']
	},
	{
		id: 'ATLAS',
		name: 'Atlas',
		category: 'Shoulder & Scapular Robot',
		scale: 'FMA-UE',
		outUnit: 'Nm',
		outLimit: 12,
		units: 1,
		mechanisms: ['Shoulder Abduction', 'Scapular Stabilisation'],
		games: ['HAT', 'RNR']
	}
];

export const GAME_LABELS: Record<string, string> = {
	HAT: 'Hand Trainer Arcade',
	PongGame: 'Pong',
	FruitBasket: 'Fruit Basket',
	RNR: 'Reach & Retrieve',
	TukTuk: 'TukTuk Drive',
	HatRick: 'HatRick Precision'
};

export const typeOf = (id: string) => DEVICE_TYPES.find((t) => t.id === id);

export const ROOMS = ['Therapy Bay 1', 'Therapy Bay 2', 'Therapy Bay 3', 'Gait & Balance Lab'];
```

- [ ] **Step 4: Write `users.ts`**

```ts
// src/lib/data/users.ts
export type Role = 'therapist' | 'consultant' | 'engineer' | 'admin';

export interface User {
	id: string;
	role: Role;
	name: string;
	title: string;
	initials: string;
	owns?: string[];
	login: string;
	email: string;
	status: 'Active';
}

const RAW_USERS: Omit<User, 'login' | 'email' | 'status'>[] = [
	{ id: 'U-T1', role: 'therapist', name: 'Priya Nair', title: 'Senior Occupational Therapist', initials: 'PN' },
	{ id: 'U-T2', role: 'therapist', name: 'Rohan Mehta', title: 'Physiotherapist', initials: 'RM' },
	{ id: 'U-T3', role: 'therapist', name: 'Ananya Kapoor', title: 'Occupational Therapist', initials: 'AK' },
	{ id: 'U-T4', role: 'therapist', name: 'Farah Sheikh', title: 'Physiotherapist', initials: 'FS' },
	{
		id: 'U-C1',
		role: 'consultant',
		name: 'Vikram Suresh',
		title: 'Neuro-rehabilitation Consultant',
		initials: 'VS'
	},
	{ id: 'U-C2', role: 'consultant', name: 'Leela Menon', title: 'Consultant, Stroke Recovery', initials: 'LM' },
	{
		id: 'U-E1',
		role: 'engineer',
		name: 'Arjun Rao',
		title: 'Device engineer · Pluto, Mars',
		initials: 'AR',
		owns: ['PLUTO', 'MARS']
	},
	{
		id: 'U-E2',
		role: 'engineer',
		name: "Kevin D'Souza",
		title: 'Device engineer · Orion, Vega',
		initials: 'KD',
		owns: ['ORION', 'VEGA']
	},
	{
		id: 'U-E3',
		role: 'engineer',
		name: 'Meera Iyer',
		title: 'Device engineer · Cosmos, Atlas',
		initials: 'MI',
		owns: ['COSMOS', 'ATLAS']
	},
	{ id: 'U-A1', role: 'admin', name: 'Sam Thomas', title: 'System administrator', initials: 'ST' }
];

export const USERS: User[] = RAW_USERS.map((u) => {
	const login = u.name.toLowerCase().replace(/[^a-z ]/g, '').replace(' ', '.');
	return { ...u, login, email: login + '@neurorehab.org', status: 'Active' as const };
});

export const DEMO_PASSWORD = 'neuro@123';

export const userOf = (id: string) => USERS.find((u) => u.id === id);
export const usersByRole = (r: Role) => USERS.filter((u) => u.role === r);
export const ownerOfType = (typeId: string) => USERS.find((u) => u.owns && u.owns.includes(typeId));

export const ROLE_LABEL: Record<Role, string> = {
	therapist: 'Therapist',
	consultant: 'Consultant',
	engineer: 'Device engineer',
	admin: 'Administrator'
};
export const DENSITY: Record<Role, 'low' | 'medium' | 'high'> = {
	therapist: 'low',
	consultant: 'medium',
	engineer: 'high',
	admin: 'medium'
};
export const HOME: Record<Role, string> = { therapist: 'today', consultant: 'review', engineer: 'fleet', admin: 'overview' };

export type NavEntry = [page: string, label: string, icon: string] | `#${string}`;
export const NAV: Record<Role, NavEntry[]> = {
	therapist: [
		['today', 'Today', 'today'],
		['patients', 'My patients', 'users'],
		['equipment', 'Equipment', 'robot']
	],
	consultant: [
		['review', 'Clinical review', 'review'],
		['outcomes', 'Outcomes', 'trend']
	],
	engineer: [
		['fleet', 'Fleet', 'grid'],
		['service', 'Service', 'wrench'],
		['requests', 'Requests', 'inbox']
	],
	admin: [
		['overview', 'Overview', 'home'],
		'#Clinical',
		['review', 'Patients', 'users'],
		['outcomes', 'Outcomes', 'trend'],
		'#Devices',
		['fleet', 'Fleet', 'grid'],
		['service', 'Service', 'wrench'],
		['requests', 'Requests', 'inbox'],
		'#Organisation',
		['members', 'Members', 'user'],
		['audit', 'Audit log', 'shield']
	]
};

export const DETAIL: Record<string, Role[]> = {
	patient: ['therapist', 'consultant', 'admin'],
	device: ['engineer', 'admin']
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- users`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/data/reference.ts src/lib/data/users.ts src/lib/data/users.test.ts
git commit -m "feat: port reference data and seeded users"
```

---

### Task 4: Data generation (units, patients, plans, assessments, sessions, faults, requests, audit)

**Files:**
- Create: `src/lib/data/generate.ts`
- Test: `src/lib/data/generate.test.ts`

**Interfaces:**
- Consumes: everything from `seed.ts`, `reference.ts`, `users.ts`.
- Produces: `generateDB(): DB` where `DB` has shape `{ units: Unit[]; patients: Patient[]; sessions: Session[]; assessments: Assessment[]; faults: Fault[]; requests: DeviceRequest[]; audit: AuditEntry[] }`. Consumed by Task 5 (`db.ts`), which calls `generateDB()` exactly once at module load.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/data/generate.test.ts
import { describe, it, expect } from 'vitest';
import { generateDB } from './generate';

describe('generateDB', () => {
	it('is deterministic', () => {
		const a = generateDB();
		const b = generateDB();
		expect(a.patients.map((p) => p.id)).toEqual(b.patients.map((p) => p.id));
		expect(a.patients[0].rate).toBeCloseTo(b.patients[0].rate, 10);
	});

	it('produces 14 device units across 6 types', () => {
		const db = generateDB();
		expect(db.units).toHaveLength(14);
	});

	it('produces 24 patients with 18 active, 3 new, 3 discharged', () => {
		const db = generateDB();
		expect(db.patients).toHaveLength(24);
		expect(db.patients.filter((p) => p.status === 'Active')).toHaveLength(18);
		expect(db.patients.filter((p) => p.status === 'New')).toHaveLength(3);
		expect(db.patients.filter((p) => p.status === 'Discharged')).toHaveLength(3);
	});

	it('generates sessions only for patients with a plan who are not New', () => {
		const db = generateDB();
		expect(db.sessions.length).toBeGreaterThan(0);
		const sessionPatientIds = new Set(db.sessions.map((s) => s.patientId));
		for (const id of sessionPatientIds) {
			const p = db.patients.find((p) => p.id === id)!;
			expect(p.status).not.toBe('New');
			expect(p.plan).not.toBeNull();
		}
	});

	it('generates at least one assessment per active/discharged patient', () => {
		const db = generateDB();
		for (const p of db.patients.filter((p) => p.status !== 'New')) {
			expect(db.assessments.some((a) => a.patientId === p.id)).toBe(true);
		}
	});

	it('generates the 7 scripted faults with correct lifecycle logs', () => {
		const db = generateDB();
		expect(db.faults).toHaveLength(7);
		const critical = db.faults.find((f) => f.unitId === 'ATLAS-01')!;
		expect(critical.status).toBe('Reported');
		expect(critical.log).toHaveLength(1);
		const cleared = db.faults.find((f) => f.unitId === 'PLUTO-01')!;
		expect(cleared.status).toBe('Cleared for use');
		expect(cleared.log.length).toBeGreaterThan(1);
	});

	it('generates audit entries for every patient registration', () => {
		const db = generateDB();
		for (const p of db.patients) {
			expect(db.audit.some((a) => a.action === 'Registered patient' && a.target === p.id)).toBe(true);
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- generate`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/data/generate.ts
import { DEVICE_TYPES, GAME_LABELS, ROOMS, SCALES, typeOf, type ScaleId } from './reference';
import { USERS, usersByRole, ownerOfType, type Role } from './users';
import {
	RNG,
	rand,
	randInt,
	pick,
	clamp,
	gauss,
	round1,
	DAY,
	TODAY,
	NOW,
	addDays,
	dayKey,
	daysAgo,
	startOfDay,
	uid
} from './seed';

export interface Unit {
	id: string;
	typeId: string;
	serial: string;
	room: string;
	firmware: string;
	commissioned: Date;
	lastCal: Date;
	calInterval: number;
	lastSync: Date;
	errBase: number;
	latBase: number;
	driftRate: number;
	anomaly?: boolean;
}

export interface PlanHistoryEntry {
	date: Date;
	by: string;
	text: string;
}
export interface Plan {
	typeId: string;
	unitId: string | null;
	mechanisms: string[];
	games: string[];
	minutes: number;
	daysPerWeek: number;
	weeks: number;
	start: Date;
	goal: string;
	history: PlanHistoryEntry[];
}
export interface Note {
	date: Date;
	by: string;
	text: string;
}
export interface Patient {
	id: string;
	code: string;
	name: string;
	age: number;
	sex: 'F' | 'M';
	diagnosis: string;
	side: string;
	onsetDays: number;
	admitted: Date;
	status: 'Active' | 'New' | 'Discharged';
	therapistId: string;
	consultantId: string;
	scale: ScaleId;
	profile: string;
	mrn: string;
	rate: number;
	adhP: number;
	plan: Plan | null;
	notes: Note[];
	slot: { time: Date; state: 'Done' | 'In progress' | 'Upcoming' } | null;
	discharged?: Date;
}

export interface Session {
	id: string;
	patientId: string;
	unitId: string;
	typeId: string;
	date: Date;
	minutes: number;
	trials: number;
	accuracy: number;
	stars: number;
	game: string;
	mechanism: string;
	rom: number;
	trackErr: number;
	latency: number;
	peakOut: number;
	flags: number;
	disconnects: number;
	today?: boolean;
}

export interface Assessment {
	id: string;
	patientId: string;
	date: Date;
	scale: ScaleId;
	score: number;
	by: string;
	note: string;
}

export type FaultStatus = 'Reported' | 'Investigating' | 'Resolved' | 'Cleared for use';
export interface FaultLogEntry {
	date: Date;
	by: string;
	text: string;
}
export interface Fault {
	id: string;
	unitId: string;
	severity: 'Critical' | 'High' | 'Medium' | 'Low';
	status: FaultStatus;
	opened: Date;
	desc: string;
	reportedBy: string;
	log: FaultLogEntry[];
}

export interface DeviceRequest {
	id: string;
	patientId: string;
	typeId: string;
	requestedBy: string;
	date: Date;
	status: 'Pending' | 'Assigned' | 'Declined';
	unitId: string | null;
	note: string;
}

export interface AuditEntry {
	id: string;
	date: Date;
	userId: string;
	action: string;
	target: string;
}

export interface DB {
	units: Unit[];
	patients: Patient[];
	sessions: Session[];
	assessments: Assessment[];
	faults: Fault[];
	requests: DeviceRequest[];
	audit: AuditEntry[];
}

const FIRST = [
	'Suresh', 'Meenal', 'Rajiv', 'Farhana', 'Vikrant', 'Ishita', 'Devendra', 'Kavya', 'Aslam', 'Rohit',
	'Sunita', 'Aarav', 'Priyanka', 'Naveen', 'Zoya', 'Harish', 'Lakshmi', 'Gautam', 'Nisha', 'Imran',
	'Deepa', 'Kiran', 'Tara', 'Mohan'
];
const LAST = ['R.', 'K.', 'T.', 'D.', 'B.', 'S.', 'P.', 'N.', 'M.', 'J.', 'V.', 'G.'];
const DIAG = [
	{ label: 'Ischaemic stroke, right MCA', side: 'Left' },
	{ label: 'Ischaemic stroke, left MCA', side: 'Right' },
	{ label: 'Haemorrhagic stroke, basal ganglia', side: 'Right' },
	{ label: 'Haemorrhagic stroke, thalamic', side: 'Left' },
	{ label: 'Traumatic brain injury', side: 'Bilateral' },
	{ label: 'Ischaemic stroke, pontine', side: 'Left' }
];
const PROFILES: Record<string, { rate: [number, number]; adh: [number, number] }> = {
	good: { rate: [3.5, 5.5], adh: [0.85, 0.98] },
	moderate: { rate: [1.8, 3.2], adh: [0.68, 0.86] },
	plateau: { rate: [0.2, 0.9], adh: [0.6, 0.8] },
	lowadh: { rate: [0.8, 2.0], adh: [0.35, 0.55] },
	decline: { rate: [1.5, 2.5], adh: [0.55, 0.75] }
};
const PROFILE_SEQ = [
	'good', 'moderate', 'plateau', 'good', 'moderate', 'lowadh', 'good', 'decline', 'moderate', 'good',
	'plateau', 'moderate', 'good', 'lowadh', 'moderate', 'good', 'moderate', 'good'
];
const TYPE_SEQ = [
	'PLUTO', 'MARS', 'ORION', 'VEGA', 'PLUTO', 'COSMOS', 'ATLAS', 'MARS', 'PLUTO', 'ORION', 'VEGA', 'COSMOS',
	'MARS', 'PLUTO', 'ATLAS', 'ORION', 'PLUTO', 'MARS', 'ORION', 'PLUTO', 'VEGA', 'MARS', 'PLUTO', 'COSMOS'
];

function generateUnits(): Unit[] {
	const units: Unit[] = [];
	DEVICE_TYPES.forEach((t) => {
		for (let i = 1; i <= t.units; i++) {
			units.push({
				id: t.id + '-0' + i,
				typeId: t.id,
				serial: 'SN-' + t.id.slice(0, 2) + randInt(20400, 20999),
				room: t.id === 'VEGA' ? 'Gait & Balance Lab' : pick(ROOMS.slice(0, 3)),
				firmware: 'v' + pick(['2.3.1', '2.3.1', '2.4.0', '2.2.7']),
				commissioned: addDays(TODAY, -randInt(200, 640)),
				lastCal: addDays(TODAY, -randInt(8, 50)),
				calInterval: 60,
				lastSync: new Date(NOW.getTime() - randInt(5, 90) * 60000),
				errBase: rand(1.0, 1.6),
				latBase: rand(20, 28),
				driftRate: rand(0.02, 0.05)
			});
		}
	});
	const unitOf = (id: string) => units.find((u) => u.id === id)!;
	unitOf('VEGA-01').lastCal = addDays(TODAY, -74);
	unitOf('VEGA-01').driftRate = 0.07;
	unitOf('COSMOS-01').lastSync = new Date(NOW.getTime() - 26 * 3600000);
	unitOf('MARS-02').anomaly = true;
	unitOf('PLUTO-03').lastCal = addDays(TODAY, -57);
	return units;
}

function generatePatients(units: Unit[]): Patient[] {
	const patients: Patient[] = [];
	const THERAPISTS = usersByRole('therapist');
	for (let i = 0; i < 24; i++) {
		const status: Patient['status'] = i < 18 ? 'Active' : i < 21 ? 'New' : 'Discharged';
		const typeId = TYPE_SEQ[i];
		const t = typeOf(typeId)!;
		const dg = typeId === 'VEGA' ? pick(DIAG) : DIAG[i % DIAG.length];
		const profName = status === 'Discharged' ? 'good' : status === 'New' ? 'moderate' : PROFILE_SEQ[i];
		const prof = PROFILES[profName];
		const admitted =
			status === 'Active'
				? addDays(TODAY, -randInt(16, 62))
				: status === 'New'
					? addDays(TODAY, -randInt(0, 4))
					: addDays(TODAY, -randInt(90, 130));
		const p: Patient = {
			id: 'PT-' + (1001 + i),
			code: 'P-' + String(randInt(100, 999)) + String.fromCharCode(65 + i),
			name: FIRST[i] + ' ' + pick(LAST),
			age: randInt(38, 78),
			sex: pick(['F', 'M']),
			diagnosis: dg.label,
			side: dg.side,
			onsetDays: randInt(14, 120),
			admitted,
			status,
			therapistId: THERAPISTS[i % 4].id,
			consultantId: i % 2 ? 'U-C2' : 'U-C1',
			scale: t.scale,
			profile: profName,
			mrn: String(4000000 + i * 7919 + 31337).replace(/(\d{3})(\d{4})/, '$1-$2'),
			rate: rand(prof.rate[0], prof.rate[1]),
			adhP: rand(prof.adh[0], prof.adh[1]),
			plan: null,
			notes: [],
			slot: null
		};
		if (status === 'Discharged') p.discharged = addDays(admitted, randInt(45, 60));
		const typeUnits = units.filter((u) => u.typeId === typeId);
		if (status !== 'New' || i === 18 || i === 19) {
			const start = status === 'New' ? addDays(TODAY, 1) : addDays(admitted, randInt(2, 4));
			p.plan = {
				typeId,
				unitId:
					status === 'New'
						? i === 18
							? typeUnits[typeUnits.length - 1].id
							: null
						: pick(typeUnits.length > 2 ? typeUnits.slice(0, -1) : typeUnits).id,
				mechanisms: t.mechanisms.slice(0, randInt(2, t.mechanisms.length)),
				games: t.games.slice(0, randInt(1, t.games.length)),
				minutes: pick([30, 30, 40, 45, 25]),
				daysPerWeek: 6,
				weeks: 10,
				start,
				goal:
					typeId === 'VEGA'
						? 'Independent sit-to-stand and safer weight transfer'
						: 'Improve reach and grasp for self-care tasks',
				history: [{ date: start, by: p.therapistId, text: 'Plan created: ' + t.name + ', ' + '{MIN} min/day' }]
			};
			p.plan.history[0].text = p.plan.history[0].text.replace('{MIN}', String(p.plan.minutes));
		}
		patients.push(p);
	}
	patients
		.filter((p) => p.plan && p.plan.typeId === 'ATLAS')
		.forEach((p) => (p.plan!.unitId = 'ATLAS-01'));

	patients
		.filter((p) => p.status === 'Active')
		.forEach((p) => {
			const n = p.profile === 'plateau' || p.profile === 'lowadh' ? 2 : randInt(0, 1);
			let d = p.plan!.start;
			for (let k = 0; k < n; k++) {
				d = addDays(d, randInt(6, 14));
				if (d >= TODAY) break;
				const old = p.plan!.minutes;
				const t = typeOf(p.plan!.typeId)!;
				const opt = randInt(0, 2);
				let text: string;
				if (opt === 0) {
					p.plan!.minutes = Math.min(60, old + 10);
					text = 'Daily minutes ' + old + ' → ' + p.plan!.minutes;
				} else if (opt === 1) {
					const g = t.games.find((x) => !p.plan!.games.includes(x)) || t.games[0];
					if (!p.plan!.games.includes(g)) p.plan!.games.push(g);
					text = 'Added game: ' + GAME_LABELS[g];
				} else {
					const m = t.mechanisms.find((x) => !p.plan!.mechanisms.includes(x)) || t.mechanisms[0];
					if (!p.plan!.mechanisms.includes(m)) p.plan!.mechanisms.push(m);
					text = 'Added movement: ' + m;
				}
				p.plan!.history.push({ date: d, by: p.therapistId, text });
			}
		});
	return patients;
}

function generateAssessments(patients: Patient[]): Assessment[] {
	const assessments: Assessment[] = [];
	patients.forEach((p) => {
		const sc = SCALES[p.scale];
		if (p.status === 'New') {
			if (p.id !== 'PT-1021') {
				assessments.push({
					id: uid('AS'),
					patientId: p.id,
					date: addDays(p.admitted, 0),
					scale: p.scale,
					score: randInt(14, 30),
					by: p.therapistId,
					note: 'Baseline'
				});
			}
			return;
		}
		const end = p.status === 'Discharged' ? p.discharged! : TODAY;
		let score = p.scale === 'BBS' ? randInt(18, 30) : randInt(12, 34);
		const dates: Date[] = [];
		for (let d = addDays(p.admitted, 1); d <= end; d = addDays(d, 14)) dates.push(d);
		dates.forEach((d, k) => {
			if (k > 0) {
				let inc = p.rate + gauss() * 0.8;
				if (p.profile === 'decline' && k === dates.length - 1) inc = -rand(2, 3.5);
				score = clamp(score + inc, 0, sc.max);
			}
			assessments.push({
				id: uid('AS'),
				patientId: p.id,
				date: d,
				scale: p.scale,
				score: Math.round(score),
				by: p.therapistId,
				note: k === 0 ? 'Baseline' : k === dates.length - 1 && p.status === 'Discharged' ? 'Discharge' : 'Review'
			});
		});
	});
	return assessments;
}

function makeSession(p: Patient, units: Unit[], d: Date, idx: number, totalDays: number): Session {
	const u = units.find((x) => x.id === p.plan!.unitId)!;
	const t = typeOf(p.plan!.typeId)!;
	const minutes = Math.round(p.plan!.minutes * rand(0.7, 1.1));
	const prog = clamp(idx / Math.max(20, totalDays), 0, 1);
	const agoD = daysAgo(d);
	const drift = u.anomaly && agoD < 10 ? (10 - agoD) * 0.12 : 0;
	const trials = Math.round(minutes * rand(1.5, 2.3));
	const accuracy = clamp(52 + prog * 26 * (p.rate / 3) + gauss() * 6, 20, 98);
	const flags = u.anomaly && agoD < 10 ? randInt(1, 4) : RNG() < 0.05 ? 1 : 0;
	return {
		id: uid('SS'),
		patientId: p.id,
		unitId: u.id,
		typeId: t.id,
		date: d,
		minutes,
		trials,
		accuracy: round1(accuracy),
		stars: Math.round((trials * accuracy) / 100 / 3),
		game: pick(p.plan!.games),
		mechanism: pick(p.plan!.mechanisms),
		rom: round1(clamp(35 + prog * 25 * (p.rate / 3) + gauss() * 4, 10, 120)),
		trackErr: round1(u.errBase + Math.abs(gauss()) * 0.35 + drift),
		latency: Math.round(u.latBase + gauss() * 3 + (u.anomaly && agoD < 10 ? 6 : 0)),
		peakOut: round1(t.outLimit * clamp(rand(0.42, 0.8) + (u.anomaly && agoD < 5 ? 0.15 : 0), 0.2, 0.99)),
		flags,
		disconnects: RNG() < 0.04 ? 1 : 0
	};
}

function generateSessions(patients: Patient[], units: Unit[]): Session[] {
	const sessions: Session[] = [];
	patients
		.filter((p) => p.plan && p.status !== 'New')
		.forEach((p) => {
			const end = p.status === 'Discharged' ? p.discharged! : addDays(TODAY, -1);
			const total = Math.round((+end - +p.plan!.start) / DAY);
			let idx = 0;
			for (let d = new Date(p.plan!.start); d <= end; d = addDays(d, 1)) {
				idx++;
				if (d.getDay() === 0) continue;
				let adh = p.adhP;
				if (p.profile === 'lowadh' && daysAgo(d) < 7) adh -= 0.1;
				if (daysAgo(d) === 1 && (p.profile === 'lowadh' || p.id === 'PT-1003')) adh = 0;
				if (RNG() > adh) continue;
				const pi = +p.id.slice(3) - 1001;
				const at = new Date(d.getTime() + (9 * 60 + ((pi * 75) % 450) + 35 + ((idx * 7) % 15)) * 60000);
				sessions.push(makeSession(p, units, at, idx, total));
			}
		});

	const THERAPISTS = usersByRole('therapist');
	THERAPISTS.forEach((th) => {
		const mine = patients.filter((p) => p.status === 'Active' && p.therapistId === th.id);
		const doneN = Math.ceil(mine.length * 0.4);
		mine.forEach((p, k) => {
			const t = new Date(TODAY);
			t.setHours(9 + Math.floor(k * 1.25), (k * 75) % 60, 0, 0);
			p.slot = { time: t, state: k < doneN ? 'Done' : k === doneN ? 'In progress' : 'Upcoming' };
			if (k < doneN && p.plan!.unitId !== 'ATLAS-01') {
				const s = makeSession(p, units, new Date(t), 99, 100);
				s.date = new Date(t.getTime() + 35 * 60000);
				s.today = true;
				sessions.push(s);
			}
		});
	});
	sessions.sort((a, b) => +a.date - +b.date);
	return sessions;
}

const FAULT_STEPS: FaultStatus[] = ['Reported', 'Investigating', 'Resolved', 'Cleared for use'];

function generateFaults(units: Unit[]): Fault[] {
	const faults: Fault[] = [];
	const unitOf = (id: string) => units.find((u) => u.id === id)!;
	function addFault(
		unitId: string,
		severity: Fault['severity'],
		status: FaultStatus,
		hoursAgo: number,
		desc: string,
		reportedBy: string
	) {
		const opened = new Date(NOW.getTime() - hoursAgo * 3600000);
		const f: Fault = {
			id: uid('FLT'),
			unitId,
			severity,
			status,
			opened,
			desc,
			reportedBy,
			log: [{ date: opened, by: reportedBy, text: 'Reported: ' + desc }]
		};
		const eng = ownerOfType(unitOf(unitId).typeId)!;
		const steps = FAULT_STEPS.indexOf(status);
		for (let k = 1; k <= steps; k++) {
			f.log.push({ date: new Date(opened.getTime() + k * 20 * 3600000), by: eng.id, text: FAULT_STEPS[k] });
		}
		faults.push(f);
	}
	addFault('ATLAS-01', 'Critical', 'Reported', 5, 'Motor overheating during shoulder abduction; safety stop triggered', 'U-T3');
	addFault('ORION-01', 'Medium', 'Investigating', 50, 'Grip force sensor intermittently reads zero', 'U-T2');
	addFault('MARS-02', 'Low', 'Reported', 20, 'Tracking error above normal range for 5 sessions (auto-detected)', 'system');
	addFault('COSMOS-01', 'Low', 'Reported', 26, 'No data sync for 26 h — check network link', 'system');
	addFault('PLUTO-02', 'High', 'Resolved', 120, 'Handle loose; play in wrist axis', 'U-T1');
	addFault('VEGA-02', 'Medium', 'Cleared for use', 300, 'Force plate zero offset after move', 'U-T4');
	addFault('PLUTO-01', 'Low', 'Cleared for use', 480, 'HAT game crashed on launch', 'U-T1');
	return faults;
}

export const OPEN_FAULT = (f: Fault) => f.status !== 'Cleared for use';

function generateRequests(patients: Patient[]): DeviceRequest[] {
	const requests: DeviceRequest[] = [];
	const patientOf = (id: string) => patients.find((p) => p.id === id)!;
	function addRequest(
		patientId: string,
		typeId: string,
		status: DeviceRequest['status'],
		hoursAgo: number,
		note: string,
		unitId?: string | null
	) {
		const p = patientOf(patientId);
		requests.push({
			id: uid('REQ'),
			patientId,
			typeId,
			requestedBy: p.therapistId,
			date: new Date(NOW.getTime() - hoursAgo * 3600000),
			status,
			unitId: unitId || null,
			note
		});
	}
	addRequest('PT-1019', TYPE_SEQ[18], 'Assigned', 30, 'New patient, plan starts tomorrow', patientOf('PT-1019').plan!.unitId);
	addRequest('PT-1020', typeOf(TYPE_SEQ[19])!.id, 'Pending', 6, 'New patient, baseline done');
	const atl = patients.find((p) => p.plan && p.plan.unitId === 'ATLAS-01' && p.status === 'Active');
	if (atl) addRequest(atl.id, 'MARS', 'Pending', 4, 'Atlas out of service — need a temporary shoulder unit');
	return requests;
}

function generateNotes(patients: Patient[]) {
	patients
		.filter((p) => p.status === 'Active' && p.profile === 'good')
		.slice(0, 3)
		.forEach((p) => {
			p.notes.push({
				date: addDays(TODAY, -randInt(3, 9)),
				by: 'U-C1',
				text: 'Good trajectory. Continue current plan; consider increasing task difficulty.'
			});
		});
}

function generateAudit(patients: Patient[], assessments: Assessment[], faults: Fault[], requests: DeviceRequest[]): AuditEntry[] {
	const audit: AuditEntry[] = [];
	function log(userId: string, action: string, target: string, date?: Date) {
		audit.push({ id: uid('AU'), date: date || new Date(), userId, action, target });
	}
	patients.forEach((p) => {
		log(p.therapistId, 'Registered patient', p.id, p.admitted);
		if (p.plan) {
			p.plan.history.forEach((h, k) => {
				if (h.date <= NOW) log(h.by, k === 0 ? 'Created therapy plan' : 'Modified therapy plan', p.id + ' · ' + h.text, h.date);
			});
		}
	});
	assessments.forEach((a) => log(a.by, 'Recorded assessment', a.patientId + ' · ' + a.scale + ' ' + a.score, a.date));
	faults.forEach((f) =>
		f.log.forEach((l) => log(l.by, l.text.startsWith('Reported') ? 'Reported fault' : 'Fault → ' + l.text, f.unitId, l.date))
	);
	requests.forEach((r) => log(r.requestedBy, 'Requested device', r.patientId + ' · ' + typeOf(r.typeId)!.name, r.date));
	USERS.forEach((u) => log(u.id, 'Signed in', 'Web dashboard', new Date(NOW.getTime() - randInt(1, 40) * 3600000)));
	return audit;
}

export function generateDB(): DB {
	const units = generateUnits();
	const patients = generatePatients(units);
	const assessments = generateAssessments(patients);
	const sessions = generateSessions(patients, units);
	const faults = generateFaults(units);
	const requests = generateRequests(patients);
	generateNotes(patients);
	const audit = generateAudit(patients, assessments, faults, requests);
	return { units, patients, sessions, assessments, faults, requests, audit };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- generate`
Expected: PASS. If counts don't match (14 units / 24 patients / 7 faults), re-check the ported loop bounds against the source line-for-line — do not adjust the test to fit wrong output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/generate.ts src/lib/data/generate.test.ts
git commit -m "feat: port fake-data generation (units, patients, sessions, faults, requests, audit)"
```

---

### Task 5: DB assembly & access-control/scoping helpers

**Files:**
- Create: `src/lib/data/db.ts`
- Test: `src/lib/data/db.test.ts`

**Interfaces:**
- Consumes: `generateDB()` from Task 4; `User`, `Role` from `users.ts`; `DEVICE_TYPES`/`typeOf` from `reference.ts`; `daysAgo` from `seed.ts`.
- Produces: `DB` (singleton, built once), `unitOf(id)`, `patientOf(id)`, `scopePatients(user)`, `scopeUnits(user)`, `canSeePatient(user, patient)`, `canSeeUnit(user, unit)`, `anon(user)`, `pname(user, patient)`, `allowed(user, page)`, `daysToCal(unit)`, `unitStatus(unit)`, `liveStatus(unit)` — consumed by every shell component (Tasks 17–22) and by every later view sub-project.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/data/db.test.ts
import { describe, it, expect } from 'vitest';
import { DB, unitOf, patientOf, scopePatients, scopeUnits, canSeePatient, canSeeUnit, anon, pname, allowed, daysToCal, unitStatus } from './db';
import { userOf } from './users';

const therapist = userOf('U-T1')!;
const engineer = userOf('U-E1')!; // owns PLUTO, MARS
const admin = userOf('U-A1')!;
const consultant = userOf('U-C1')!;

describe('DB', () => {
	it('is built once and populated', () => {
		expect(DB.units.length).toBeGreaterThan(0);
		expect(DB.patients.length).toBeGreaterThan(0);
	});
});

describe('scoping', () => {
	it('therapist sees only their own patients', () => {
		const scoped = scopePatients(therapist);
		expect(scoped.length).toBeGreaterThan(0);
		expect(scoped.every((p) => p.therapistId === therapist.id)).toBe(true);
	});

	it('engineer sees only units of owned types', () => {
		const scoped = scopeUnits(engineer);
		expect(scoped.length).toBeGreaterThan(0);
		expect(scoped.every((u) => engineer.owns!.includes(u.typeId))).toBe(true);
	});

	it('admin sees everything', () => {
		expect(scopePatients(admin)).toHaveLength(DB.patients.length);
		expect(scopeUnits(admin)).toHaveLength(DB.units.length);
	});

	it('empty scope is a valid, non-throwing result', () => {
		const noOwner = { ...engineer, owns: ['NOPE'] };
		expect(scopeUnits(noOwner)).toEqual([]);
	});
});

describe('access control', () => {
	it('canSeePatient: therapist only their own, consultant/admin any', () => {
		const mine = DB.patients.find((p) => p.therapistId === therapist.id)!;
		const notMine = DB.patients.find((p) => p.therapistId !== therapist.id)!;
		expect(canSeePatient(therapist, mine)).toBe(true);
		expect(canSeePatient(therapist, notMine)).toBe(false);
		expect(canSeePatient(consultant, notMine)).toBe(true);
		expect(canSeePatient(admin, notMine)).toBe(true);
	});

	it('canSeeUnit: engineer only owned types, admin any', () => {
		const owned = DB.units.find((u) => engineer.owns!.includes(u.typeId))!;
		const notOwned = DB.units.find((u) => !engineer.owns!.includes(u.typeId))!;
		expect(canSeeUnit(engineer, owned)).toBe(true);
		expect(canSeeUnit(engineer, notOwned)).toBe(false);
		expect(canSeeUnit(admin, notOwned)).toBe(true);
	});

	it('anon/pname: engineers see patient code, others see name', () => {
		const p = DB.patients[0];
		expect(anon(engineer)).toBe(true);
		expect(pname(engineer, p)).toBe(p.code);
		expect(anon(therapist)).toBe(false);
		expect(pname(therapist, p)).toBe(p.name);
	});

	it('allowed: page must be in role NAV, or a permitted detail route', () => {
		expect(allowed(therapist, 'today')).toBe(true);
		expect(allowed(therapist, 'audit')).toBe(false);
		expect(allowed(admin, 'audit')).toBe(true);
		expect(allowed(therapist, 'patient')).toBe(true);
		expect(allowed(engineer, 'patient')).toBe(false);
		expect(allowed(engineer, 'device')).toBe(true);
	});
});

describe('unitOf / patientOf', () => {
	it('find by id, undefined for unknown id', () => {
		expect(unitOf(DB.units[0].id)).toBe(DB.units[0]);
		expect(unitOf('NOPE')).toBeUndefined();
		expect(patientOf(DB.patients[0].id)).toBe(DB.patients[0]);
		expect(patientOf('NOPE')).toBeUndefined();
	});
});

describe('unit status', () => {
	it('daysToCal and unitStatus never throw for any generated unit', () => {
		for (const u of DB.units) {
			expect(() => daysToCal(u)).not.toThrow();
			expect(['Out of service', 'Needs attention', 'In use', 'Available']).toContain(unitStatus(u));
		}
	});

	it('a unit with an open Critical/High fault is Out of service', () => {
		const u = unitOf('ATLAS-01')!;
		expect(unitStatus(u)).toBe('Out of service');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- db`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/data/db.ts
import { generateDB, OPEN_FAULT, type Patient, type Unit } from './generate';
import type { User, Role } from './users';
import { NAV, DETAIL } from './users';
import { daysAgo } from './seed';

export const DB = generateDB();

export const unitOf = (id: string) => DB.units.find((u) => u.id === id);
export const patientOf = (id: string) => DB.patients.find((p) => p.id === id);

export function scopePatients(user: User): Patient[] {
	if (user.role === 'therapist') return DB.patients.filter((p) => p.therapistId === user.id);
	if (user.role === 'engineer') return DB.patients.filter((p) => p.plan && (user.owns ?? []).includes(p.plan.typeId));
	return DB.patients;
}

export function scopeUnits(user: User): Unit[] {
	return user.role === 'engineer' ? DB.units.filter((u) => (user.owns ?? []).includes(u.typeId)) : DB.units;
}

export const canSeePatient = (user: User, p: Patient) =>
	user.role === 'consultant' || user.role === 'admin' || (user.role === 'therapist' && p.therapistId === user.id);

export const canSeeUnit = (user: User, u: Unit) =>
	user.role === 'admin' || (user.role === 'engineer' && (user.owns ?? []).includes(u.typeId));

export const anon = (user: User) => user.role === 'engineer';
export const pname = (user: User, p: Patient) => (anon(user) ? p.code : p.name);

export function allowed(user: User, page: string): boolean {
	if (DETAIL[page]) return DETAIL[page].includes(user.role);
	return NAV[user.role].some((n) => Array.isArray(n) && n[0] === page);
}

export const daysToCal = (u: Unit) => u.calInterval - daysAgo(u.lastCal);

export function unitStatus(u: Unit): 'Out of service' | 'Needs attention' | 'In use' | 'Available' {
	const open = DB.faults.filter((f) => f.unitId === u.id && OPEN_FAULT(f));
	const calDue = daysToCal(u);
	const syncH = (+new Date() - +u.lastSync) / 3600000;
	if (open.some((f) => f.severity === 'Critical' || f.severity === 'High')) return 'Out of service';
	if (open.length || calDue < 0 || syncH > 24) return 'Needs attention';
	if (DB.patients.some((p) => p.status === 'Active' && p.plan && p.plan.unitId === u.id)) return 'In use';
	return 'Available';
}

export function liveStatus(u: Unit): 'Out of service' | 'Offline' | 'Needs attention' | 'In session' | 'Available' | 'In use' {
	const s = unitStatus(u);
	if (s === 'Out of service') return s;
	if ((+new Date() - +u.lastSync) / 3600000 > 24) return 'Offline';
	if (s === 'Needs attention') return s;
	if (DB.patients.some((p) => p.slot && p.slot.state === 'In progress' && p.plan && p.plan.unitId === u.id)) return 'In session';
	return s;
}
```

Note: role names are constrained by the `Role` type, so `Role` is imported for documentation even though it isn't referenced by name in a type position here (TS will flag it as unused — remove the import if your editor does; `User['role']` already carries the type).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/db.ts src/lib/data/db.test.ts
git commit -m "feat: assemble DB singleton with scoping and access-control helpers"
```

---

### Task 6: Icon registry

**Files:**
- Create: `src/lib/data/icons.ts`
- Test: `src/lib/data/icons.test.ts`

**Interfaces:**
- Produces: `IC: Record<string, string>` (inner SVG path markup by name), `icon(name: string, size?: number): string` (full `<svg>` string) — consumed by `Icon.svelte` (Task 9) and any component needing an inline icon string.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/data/icons.test.ts
import { describe, it, expect } from 'vitest';
import { icon, IC } from './icons';

describe('icon', () => {
	it('renders a known icon as an svg string', () => {
		const s = icon('home');
		expect(s).toContain('<svg');
		expect(s).toContain('viewBox="0 0 24 24"');
		expect(s).toContain(IC.home);
	});

	it('respects the size parameter', () => {
		expect(icon('home', 24)).toContain('width="24" height="24"');
	});

	it('falls back to an empty inner path for an unknown name, never throws', () => {
		expect(() => icon('nope')).not.toThrow();
		expect(icon('nope')).toContain('<svg');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- icons`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Port the `IC` object and `icon()` helper from the prototype (lines 751–791 of `backup/neurodash-v2 (1).html`) verbatim into TypeScript:

```ts
// src/lib/data/icons.ts
export const IC: Record<string, string> = {
	home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
	today: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3"/>',
	users:
		'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.4 3.5 5.2"/>',
	user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.2 4.1-6.5 8-6.5s7 2.3 8 6.5"/>',
	device: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
	robot:
		'<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 8V4M9 13h.01M15 13h.01M9 16.5h6M3 12v3M21 12v3"/>',
	chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
	trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
	review:
		'<path d="M9 5H5v16h14V5h-4"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 13l2 2 4-4"/>',
	wrench:
		'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
	inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
	shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>',
	list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
	grid:
		'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
	bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
	sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
	moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
	logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
	x: '<path d="M6 6l12 12M18 6L6 18"/>',
	chev: '<path d="M9 6l6 6-6 6"/>',
	chevd: '<path d="M6 9l6 6 6-6"/>',
	search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
	alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
	check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
	clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
	clip: '<path d="M9 5H5v16h14V5h-4"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>',
	edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
	cal: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
	wifi: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01"/>',
	settings:
		'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
	file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',
	note: '<path d="M4 4h16v12l-4 4H4z"/><path d="M16 20v-4h4M8 9h8M8 13h5"/>',
	send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
	eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
	lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
	help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.7c0 1.7-2.4 2.1-2.4 3.8M12 17h.01"/>'
};

export const icon = (name: string, size = 16) =>
	`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[name] || ''}</svg>`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- icons`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/icons.ts src/lib/data/icons.test.ts
git commit -m "feat: port icon registry"
```

---

### Task 7: Auth store & login logic

**Files:**
- Create: `src/lib/stores/auth.ts`
- Test: `src/lib/stores/auth.test.ts`

**Interfaces:**
- Consumes: `USERS`, `userOf`, `DEMO_PASSWORD`, `User` from `src/lib/data/users.ts`.
- Produces: `currentUser` (Svelte `Writable<User | null>`), `login(idOrEmail: string, password: string, remember: boolean): { ok: true } | { ok: false; message: string }`, `logout(): void`, `restoreSession(): void` (reads persisted id at boot; safe on a stale/unknown id) — consumed by Task 17 (login page), Task 22 (`(app)/+layout.ts` guard), Task 16 (root layout calls `restoreSession()` once).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/stores/auth.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { currentUser, login, logout, restoreSession } from './auth';

function fakeStorage() {
	let data: Record<string, string> = {};
	return {
		getItem: (k: string) => (k in data ? data[k] : null),
		setItem: (k: string, v: string) => {
			data[k] = v;
		},
		removeItem: (k: string) => {
			delete data[k];
		},
		clear: () => {
			data = {};
		}
	};
}

beforeEach(() => {
	vi.stubGlobal('localStorage', fakeStorage());
	vi.stubGlobal('sessionStorage', fakeStorage());
	logout();
});

describe('login', () => {
	it('succeeds with a valid login id and the demo password', () => {
		const r = login('priya.nair', 'neuro@123', false);
		expect(r.ok).toBe(true);
		expect(get(currentUser)?.id).toBe('U-T1');
	});

	it('succeeds with email instead of login id', () => {
		const r = login('priya.nair@neurorehab.org', 'neuro@123', false);
		expect(r.ok).toBe(true);
	});

	it('fails with wrong password without throwing, leaves currentUser null', () => {
		const r = login('priya.nair', 'wrong', false);
		expect(r.ok).toBe(false);
		expect(get(currentUser)).toBeNull();
	});

	it('fails with unknown user id without throwing', () => {
		const r = login('nobody.here', 'neuro@123', false);
		expect(r.ok).toBe(false);
	});

	it('persists to localStorage when remember is true, sessionStorage otherwise', () => {
		login('priya.nair', 'neuro@123', true);
		expect(localStorage.getItem('nd.user')).toBe('U-T1');
		logout();
		login('priya.nair', 'neuro@123', false);
		expect(sessionStorage.getItem('nd.user')).toBe('U-T1');
	});
});

describe('restoreSession', () => {
	it('restores a valid persisted user', () => {
		login('priya.nair', 'neuro@123', true);
		currentUser.set(null);
		restoreSession();
		expect(get(currentUser)?.id).toBe('U-T1');
	});

	it('does not throw and leaves currentUser null for a stale/unknown persisted id', () => {
		localStorage.setItem('nd.user', 'U-DOES-NOT-EXIST');
		expect(() => restoreSession()).not.toThrow();
		expect(get(currentUser)).toBeNull();
	});

	it('is a no-op when nothing is persisted', () => {
		expect(() => restoreSession()).not.toThrow();
		expect(get(currentUser)).toBeNull();
	});
});

describe('logout', () => {
	it('clears currentUser and persisted storage', () => {
		login('priya.nair', 'neuro@123', true);
		logout();
		expect(get(currentUser)).toBeNull();
		expect(localStorage.getItem('nd.user')).toBeNull();
		expect(sessionStorage.getItem('nd.user')).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- auth`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/stores/auth.ts
import { writable } from 'svelte/store';
import { USERS, userOf, DEMO_PASSWORD, type User } from '$lib/data/users';

export const currentUser = writable<User | null>(null);

function safeGet(k: string): string | null {
	try {
		return localStorage.getItem('nd.' + k) ?? sessionStorage.getItem('nd.' + k);
	} catch {
		return null;
	}
}
function safeSet(k: string, v: string, persist: boolean) {
	try {
		(persist ? localStorage : sessionStorage).setItem('nd.' + k, v);
	} catch {
		/* storage unavailable (private mode, SSR) — auth just won't persist */
	}
}
function safeClear(k: string) {
	try {
		localStorage.removeItem('nd.' + k);
		sessionStorage.removeItem('nd.' + k);
	} catch {
		/* noop */
	}
}

export function login(idOrEmail: string, password: string, remember: boolean): { ok: true } | { ok: false; message: string } {
	const id = idOrEmail.trim().toLowerCase();
	const u = USERS.find((x) => (x.login === id || x.email === id) && x.status === 'Active');
	if (!u || password !== DEMO_PASSWORD) {
		return { ok: false, message: 'Incorrect user ID or password.' };
	}
	currentUser.set(u);
	safeSet('user', u.id, remember);
	return { ok: true };
}

export function logout() {
	currentUser.set(null);
	safeClear('user');
}

export function restoreSession() {
	const id = safeGet('user');
	if (id && userOf(id)) currentUser.set(userOf(id)!);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- auth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/auth.ts src/lib/stores/auth.test.ts
git commit -m "feat: add demo auth store (login/logout/restoreSession)"
```

---

### Task 8: Theme & density stores

**Files:**
- Create: `src/lib/stores/theme.ts`
- Test: `src/lib/stores/theme.test.ts`

**Interfaces:**
- Consumes: `DENSITY`, `Role` from `src/lib/data/users.ts`.
- Produces: `theme` (`Writable<'light' | 'dark'>`, persisted), `toggleTheme()`, `setTheme(t)`, `densityFor(role: Role)` — consumed by Task 16 (root layout applies `data-theme`/`data-density` to `<html>`/`<body>`), Task 21 (`UserMenu` theme toggle).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/stores/theme.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { theme, setTheme, toggleTheme, densityFor } from './theme';

function fakeStorage() {
	let data: Record<string, string> = {};
	return {
		getItem: (k: string) => (k in data ? data[k] : null),
		setItem: (k: string, v: string) => {
			data[k] = v;
		},
		removeItem: (k: string) => {
			delete data[k];
		}
	};
}

beforeEach(() => {
	vi.stubGlobal('localStorage', fakeStorage());
	setTheme('light');
});

describe('theme', () => {
	it('defaults to light', () => {
		expect(get(theme)).toBe('light');
	});

	it('setTheme updates the store and persists', () => {
		setTheme('dark');
		expect(get(theme)).toBe('dark');
		expect(localStorage.getItem('nd.theme')).toBe('dark');
	});

	it('toggleTheme flips light/dark', () => {
		setTheme('light');
		toggleTheme();
		expect(get(theme)).toBe('dark');
		toggleTheme();
		expect(get(theme)).toBe('light');
	});
});

describe('densityFor', () => {
	it('returns the role-mapped density', () => {
		expect(densityFor('therapist')).toBe('low');
		expect(densityFor('engineer')).toBe('high');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- theme`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/stores/theme.ts
import { writable } from 'svelte/store';
import { DENSITY, type Role } from '$lib/data/users';

export type Theme = 'light' | 'dark';

function readPersisted(): Theme {
	try {
		const t = localStorage.getItem('nd.theme');
		return t === 'dark' || t === 'light' ? t : 'light';
	} catch {
		return 'light';
	}
}

export const theme = writable<Theme>(readPersisted());

export function setTheme(t: Theme) {
	theme.set(t);
	try {
		localStorage.setItem('nd.theme', t);
	} catch {
		/* noop */
	}
}

export function toggleTheme() {
	theme.update((t) => {
		const next = t === 'dark' ? 'light' : 'dark';
		try {
			localStorage.setItem('nd.theme', next);
		} catch {
			/* noop */
		}
		return next;
	});
}

export const densityFor = (role: Role) => DENSITY[role];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- theme`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/theme.ts src/lib/stores/theme.test.ts
git commit -m "feat: add theme store and role density lookup"
```

---

### Task 9: UI state store (toasts, modal, command palette, notification read-state)

**Files:**
- Create: `src/lib/stores/ui.ts`
- Test: `src/lib/stores/ui.test.ts`

**Interfaces:**
- Produces: `toasts` (`Writable<{id:number;message:string}[]>`), `showToast(message: string)`; `modal` (`Writable<ModalSpec | null>`) with `ModalSpec = {title:string; sub?:string; body: string /* HTML */; submitLabel?:string; onSubmit:(data: Record<string,string>) => boolean | void}`, `openModal(spec)`, `closeModal()`; `commandPaletteOpen` (`Writable<boolean>`); `notificationsRead` (`Writable<Set<string>>`), `markRead(id)`, `markAllRead(ids: string[])` — consumed by Task 15 (`Modal`/`ToastHost`), Task 19 (`CommandPalette`), Task 20 (`NotificationsPopover`).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/stores/ui.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { toasts, showToast, modal, openModal, closeModal, commandPaletteOpen, notificationsRead, markRead, markAllRead } from './ui';

beforeEach(() => {
	toasts.set([]);
	modal.set(null);
	commandPaletteOpen.set(false);
	notificationsRead.set(new Set());
});

describe('toasts', () => {
	it('showToast adds a toast with a unique id', () => {
		showToast('Saved');
		showToast('Saved again');
		const list = get(toasts);
		expect(list).toHaveLength(2);
		expect(list[0].id).not.toBe(list[1].id);
	});
});

describe('modal', () => {
	it('openModal sets the spec, closeModal clears it', () => {
		openModal({ title: 'Test', body: '<p>hi</p>', onSubmit: () => {} });
		expect(get(modal)?.title).toBe('Test');
		closeModal();
		expect(get(modal)).toBeNull();
	});
});

describe('commandPaletteOpen', () => {
	it('defaults closed and is toggleable via set', () => {
		expect(get(commandPaletteOpen)).toBe(false);
		commandPaletteOpen.set(true);
		expect(get(commandPaletteOpen)).toBe(true);
	});
});

describe('notificationsRead', () => {
	it('markRead adds an id, markAllRead adds many, both are idempotent', () => {
		markRead('a');
		markRead('a');
		expect(get(notificationsRead)).toEqual(new Set(['a']));
		markAllRead(['a', 'b', 'c']);
		expect(get(notificationsRead)).toEqual(new Set(['a', 'b', 'c']));
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- ui`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/stores/ui.ts
import { writable } from 'svelte/store';

export interface Toast {
	id: number;
	message: string;
}
export const toasts = writable<Toast[]>([]);
let _toastId = 0;
export function showToast(message: string) {
	const id = ++_toastId;
	toasts.update((t) => [...t, { id, message }]);
	setTimeout(() => {
		toasts.update((t) => t.filter((x) => x.id !== id));
	}, 2600);
}

export interface ModalSpec {
	title: string;
	sub?: string;
	body: string;
	submitLabel?: string;
	onSubmit: (data: Record<string, string>) => boolean | void;
}
export const modal = writable<ModalSpec | null>(null);
export const openModal = (spec: ModalSpec) => modal.set(spec);
export const closeModal = () => modal.set(null);

export const commandPaletteOpen = writable(false);

export const notificationsRead = writable<Set<string>>(new Set());
export const markRead = (id: string) => notificationsRead.update((s) => new Set(s).add(id));
export const markAllRead = (ids: string[]) => notificationsRead.update((s) => new Set([...s, ...ids]));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/ui.ts src/lib/stores/ui.test.ts
git commit -m "feat: add shared UI state store (toasts, modal, command palette, notification read-state)"
```

---

### Task 10: Design-system CSS port

**Files:**
- Create: `src/lib/styles/tokens.css`
- Create: `src/lib/styles/base.css`

**Interfaces:**
- Produces: global CSS custom properties (`--surface`, `--ink`, `--accent`, etc., light/dark via `:root[data-theme="dark"]`, role accents via `[data-role]`, density via `[data-density]`) and component classes (`.card`, `.tbl`, `.btn`, `.pill`, `.tag`, `.side`, `.nav`, etc.) — imported once by Task 16's root layout, consumed by every component from Task 11 onward.

- [ ] **Step 1: Create `tokens.css`**

Port lines 11–64 of `backup/neurodash-v2 (1).html` (the `:root`, `[data-role]`, `:root[data-theme="dark"]`, and `[data-density]` blocks) verbatim:

```css
/* src/lib/styles/tokens.css */
:root {
	color-scheme: light;
	--side: #f7f7f5;
	--main: #ffffff;
	--surface: #ffffff;
	--surface-2: #fafaf9;
	--surface-3: #f2f2ef;
	--hover: #f4f4f1;
	--ink: #171717;
	--ink-2: #525252;
	--ink-3: #8a8a86;
	--ink-4: #b3b3ae;
	--line: #ebebe7;
	--line-2: #dcdcd6;
	--grid: #efefeb;
	--axis: #cfcfc8;
	--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
	--shadow-lg: 0 16px 40px -8px rgba(0, 0, 0, 0.18), 0 4px 10px -4px rgba(0, 0, 0, 0.08);
	--series-1: #2a78d6;
	--series-2: #eb6834;
	--series-3: #1baf7a;
	--seq-1: #dbe8fa;
	--seq-2: #9ec5f4;
	--seq-3: #5598e7;
	--seq-4: #256abf;
	--seq-5: #184f95;
	--good: #0ca30c;
	--warn: #fab219;
	--serious: #ec835a;
	--crit: #d03b3b;
	--idle: #a3a39e;
	--good-ink: #0a7a0a;
	--warn-ink: #8a5a00;
	--serious-ink: #a3451f;
	--crit-ink: #b42323;
	--good-bg: #ecf7ec;
	--warn-bg: #fdf5e1;
	--serious-bg: #fdefe8;
	--crit-bg: #fcebeb;
	--neutral-bg: #f0f0ec;
	--brand: #0f766e;
	--accent: #0f766e;
	--accent-ink: #0f766e;
	--accent-bg: #e7f4f2;
	--on-accent: #ffffff;
	--font: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
	--mono: ui-monospace, 'Cascadia Mono', Consolas, monospace;
}
[data-role='therapist'] {
	--accent: #0f766e;
	--accent-ink: #0f766e;
	--accent-bg: #e7f4f2;
}
[data-role='consultant'] {
	--accent: #4f46e5;
	--accent-ink: #4338ca;
	--accent-bg: #eeedfd;
}
[data-role='engineer'] {
	--accent: #c2410c;
	--accent-ink: #b23c0b;
	--accent-bg: #fdf0e7;
}
[data-role='admin'] {
	--accent: #334155;
	--accent-ink: #334155;
	--accent-bg: #eef0f3;
}
:root[data-theme='dark'] {
	color-scheme: dark;
	--side: #121211;
	--main: #181817;
	--surface: #1d1d1c;
	--surface-2: #212120;
	--surface-3: #292927;
	--hover: #242423;
	--ink: #f2f2ef;
	--ink-2: #bdbdb6;
	--ink-3: #8a8a84;
	--ink-4: #5c5c58;
	--line: #2a2a28;
	--line-2: #363633;
	--grid: #262624;
	--axis: #42423e;
	--shadow-sm: none;
	--shadow-lg: 0 16px 40px -8px rgba(0, 0, 0, 0.6);
	--series-1: #3987e5;
	--series-2: #d95926;
	--series-3: #199e70;
	--seq-1: #1d2a3b;
	--seq-2: #1c4270;
	--seq-3: #256abf;
	--seq-4: #3987e5;
	--seq-5: #86b6ef;
	--good-ink: #3cc23c;
	--warn-ink: #f5b83d;
	--serious-ink: #ef9672;
	--crit-ink: #f07575;
	--good-bg: rgba(12, 163, 12, 0.14);
	--warn-bg: rgba(250, 178, 25, 0.13);
	--serious-bg: rgba(236, 131, 90, 0.14);
	--crit-bg: rgba(208, 59, 59, 0.17);
	--neutral-bg: #2a2a28;
	--on-accent: #111110;
	--brand: #2dd4bf;
}
:root[data-theme='dark'] [data-role='therapist'] {
	--accent: #2dd4bf;
	--accent-ink: #5eead4;
	--accent-bg: rgba(45, 212, 191, 0.11);
}
:root[data-theme='dark'] [data-role='consultant'] {
	--accent: #818cf8;
	--accent-ink: #a5b4fc;
	--accent-bg: rgba(129, 140, 248, 0.13);
}
:root[data-theme='dark'] [data-role='engineer'] {
	--accent: #fb923c;
	--accent-ink: #fdba74;
	--accent-bg: rgba(251, 146, 60, 0.12);
}
:root[data-theme='dark'] [data-role='admin'] {
	--accent: #94a3b8;
	--accent-ink: #cbd5e1;
	--accent-bg: rgba(148, 163, 184, 0.13);
}

[data-density='low'] {
	--fs: 14.5px;
	--fs-sm: 13.5px;
	--fs-xs: 12.5px;
	--pad: 20px;
	--gap: 20px;
	--row: 13px;
	--h1: 24px;
}
[data-density='medium'] {
	--fs: 14px;
	--fs-sm: 13px;
	--fs-xs: 12px;
	--pad: 18px;
	--gap: 16px;
	--row: 10px;
	--h1: 22px;
}
[data-density='high'] {
	--fs: 13px;
	--fs-sm: 12.5px;
	--fs-xs: 11.5px;
	--pad: 14px;
	--gap: 12px;
	--row: 7px;
	--h1: 20px;
}
```

- [ ] **Step 2: Create `base.css`**

Port lines 53–61 and 65–386 of `backup/neurodash-v2 (1).html` (base element rules, then every component class block: `.login*`, `.shell`/`.side`/`.ws`/`.nav`/`.userbtn`/`.av`, `.main`/`.top`/`.crumbs`/`.srow`/`.content`, `.icon-btn`, `.pop`/`.menu`/`.notif`, `.cmdk*`, `.ph`/`.grid`/`.card`/`.stats`/`.pill`/`.tag`/`.sev`/`.delta`, `.tbl*`, `.btn`/`.field`/`.toolbar`/`.segs`, `.tabs`, `.banner`, `.kv`, `.list`, `.sched`, `.heat`, `.fleet`/`.dev`, `.kanban`/`.tk`, `.log`, `.meter`/`.legend`/`.chart*`/`#tip`, `.scrim`/`.modal`/`.toast`/`.empty`/`.tl`/`.note`, and the two `@media` blocks) verbatim into a single `base.css` file — copy the CSS body exactly as it appears in the source (it's already valid, framework-agnostic CSS; only the `<style>` wrapper tags are dropped).

- [ ] **Step 3: Verify with a scratch page**

Temporarily create `src/routes/+page.svelte` (the default SvelteKit root route, not yet claimed by any task) with:
```svelte
<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>
<div class="card" style="margin:40px;max-width:400px">
	<div class="card-h"><h2>Style check</h2></div>
	<div class="card-b">
		<span class="pill good">Available</span> <span class="tag crit">Critical</span>
		<button class="btn pri" style="margin-top:12px">Primary button</button>
	</div>
</div>
```
Add `import '$lib/styles/tokens.css'; import '$lib/styles/base.css';` to `src/routes/+layout.svelte` (create it minimally with just `<slot />` if it doesn't exist yet — Task 16 will replace this with the real root layout).

Run: `npm run dev`, open the page in a browser, confirm the card renders with the teal pill, red tag, and a dark teal button — not unstyled HTML.

- [ ] **Step 4: Remove the scratch page**

Delete the temporary content from `src/routes/+page.svelte` (leave the file empty or delete it — Task 16/22 define the real routing). Keep the CSS imports in `+layout.svelte`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/styles/tokens.css src/lib/styles/base.css src/routes/+layout.svelte
git commit -m "feat: port design-system CSS (tokens + component classes)"
```

---

### Task 11: Core display primitives (Icon, Avatar, Pill, Tag, Severity, ProgressBar)

**Files:**
- Create: `src/lib/components/ui/Icon.svelte`, `Avatar.svelte`, `Pill.svelte`, `Tag.svelte`, `Severity.svelte`, `ProgressBar.svelte`

**Interfaces:**
- Consumes: `icon` from `$lib/data/icons`.
- Produces: `<Icon name size />`, `<Avatar user size /* 'sm'|'md'|'lg' */ />`, `<Pill text tone? live? />`, `<Tag text tone? />`, `<Severity level /* 'Low'|'Medium'|'High'|'Critical' */ />`, `<ProgressBar value /* 0..1 */ tone? />` — consumed by Task 12–13 components and every future view sub-project.

- [ ] **Step 1: Write `Icon.svelte`**

```svelte
<!-- src/lib/components/ui/Icon.svelte -->
<script lang="ts">
	import { IC } from '$lib/data/icons';
	let { name, size = 16 }: { name: string; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	{@html IC[name] || ''}
</svg>
```

- [ ] **Step 2: Write `Avatar.svelte`**

```svelte
<!-- src/lib/components/ui/Avatar.svelte -->
<script lang="ts">
	import type { User } from '$lib/data/users';
	let { user, size = 'md' }: { user: User; size?: 'sm' | 'md' | 'lg' } = $props();
</script>

<span class="av {size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : ''}" title={user.name}>{user.initials}</span>
```

- [ ] **Step 3: Write `Pill.svelte`, `Tag.svelte`, `Severity.svelte`, `ProgressBar.svelte`**

```svelte
<!-- src/lib/components/ui/Pill.svelte -->
<script lang="ts">
	let { text, tone = '', live = false }: { text: string; tone?: string; live?: boolean } = $props();
</script>

<span class="pill {tone} {live ? 'live' : ''}"><span class="d"></span>{text}</span>
```

```svelte
<!-- src/lib/components/ui/Tag.svelte -->
<script lang="ts">
	let { text, tone = '' }: { text: string; tone?: string } = $props();
</script>

<span class="tag {tone}">{text}</span>
```

```svelte
<!-- src/lib/components/ui/Severity.svelte -->
<script lang="ts">
	let { level }: { level: 'Low' | 'Medium' | 'High' | 'Critical' } = $props();
</script>

<span class="sev {level}"><i><b></b><b></b><b></b></i>{level}</span>
```

```svelte
<!-- src/lib/components/ui/ProgressBar.svelte -->
<script lang="ts">
	let { value, tone = '' }: { value: number; tone?: string } = $props();
	const pct = () => Math.round(Math.max(0, Math.min(1, value)) * 100);
</script>

<div class="mcell">
	<div class="meter {tone ? 'm-' + tone : ''}"><div style="width:{pct()}%"></div></div>
	<span class="num sm">{pct()}%</span>
</div>
```

- [ ] **Step 4: Verify manually**

Temporarily add all six components to `src/routes/+page.svelte` with representative props (`<Pill text="Available" tone="good" />`, `<Tag text="Critical" tone="crit" />`, `<Severity level="High" />`, `<ProgressBar value={0.62} tone="warn" />`, an `<Avatar>` with a real user from `$lib/data/users`, an `<Icon name="bell" />`). Run `npm run dev`, confirm each renders with correct color/shape (compare against the style-check card from Task 10). Then remove the scratch content again.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/ui/Icon.svelte src/lib/components/ui/Avatar.svelte src/lib/components/ui/Pill.svelte src/lib/components/ui/Tag.svelte src/lib/components/ui/Severity.svelte src/lib/components/ui/ProgressBar.svelte
git commit -m "feat: add core display primitive components"
```

---

### Task 12: Structural primitives (Card, StatsStrip, KeyValueList, Banner)

**Files:**
- Create: `src/lib/components/ui/Card.svelte`, `StatsStrip.svelte`, `KeyValueList.svelte`, `Banner.svelte`

**Interfaces:**
- Consumes: `Avatar`, `Tag` (Task 11) for `Banner`.
- Produces: `<Card title? sub? flush?>{content}<svelte:fragment slot="right">…</svelte:fragment></Card>`, `<StatsStrip items={{label,value,footer?,href?,tone?}[]} />`, `<KeyValueList rows={{label,value}[]} />`, `<Banner title idChips={{label,value}[]} tags={{text,tone}[]}><svelte:fragment slot="actions">…</svelte:fragment></Banner>` — consumed by every placeholder page (Task 23) and future views.

- [ ] **Step 1: Write `Card.svelte`**

```svelte
<!-- src/lib/components/ui/Card.svelte -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		title,
		sub,
		flush = false,
		right,
		children
	}: { title?: string; sub?: string; flush?: boolean; right?: Snippet; children: Snippet } = $props();
</script>

<section class="card">
	{#if title}
		<div class="card-h">
			<h2>{title}</h2>
			{#if sub}<span class="sub">{sub}</span>{/if}
			<span class="sp"></span>
			{#if right}{@render right()}{/if}
		</div>
	{/if}
	<div class="card-b {flush ? 'flush' : ''}">{@render children()}</div>
</section>
```

- [ ] **Step 2: Write `StatsStrip.svelte`**

```svelte
<!-- src/lib/components/ui/StatsStrip.svelte -->
<script lang="ts">
	interface Stat {
		label: string;
		value: string;
		footer?: string;
		href?: string;
		tone?: 'bad' | 'warnv' | '';
	}
	let { items }: { items: Stat[] } = $props();
</script>

<div class="stats">
	{#each items as s (s.label)}
		{#if s.href}
			<a class="stat link {s.tone || ''}" href={s.href}>
				<div class="l">{s.label}</div>
				<div class="v">{s.value}</div>
				{#if s.footer}<div class="f">{s.footer}</div>{/if}
			</a>
		{:else}
			<div class="stat {s.tone || ''}">
				<div class="l">{s.label}</div>
				<div class="v">{s.value}</div>
				{#if s.footer}<div class="f">{s.footer}</div>{/if}
			</div>
		{/if}
	{/each}
</div>
```

- [ ] **Step 3: Write `KeyValueList.svelte`**

```svelte
<!-- src/lib/components/ui/KeyValueList.svelte -->
<script lang="ts">
	let { rows }: { rows: { label: string; value: string }[] } = $props();
</script>

<dl class="kv">
	{#each rows as r (r.label)}
		<dt>{r.label}</dt>
		<dd>{r.value}</dd>
	{/each}
</dl>
```

- [ ] **Step 4: Write `Banner.svelte`**

```svelte
<!-- src/lib/components/ui/Banner.svelte -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Tag from './Tag.svelte';
	let {
		title,
		idChips = [],
		tags = [],
		actions
	}: {
		title: string;
		idChips?: { label: string; value: string }[];
		tags?: { text: string; tone?: string }[];
		actions?: Snippet;
	} = $props();
</script>

<div class="banner">
	<div>
		<h1>{title}</h1>
		{#if idChips.length}
			<div class="ids">
				{#each idChips as c (c.label)}<span><b>{c.label}</b> {c.value}</span>{/each}
			</div>
		{/if}
		{#if tags.length}
			<div class="chips">
				{#each tags as t (t.text)}<Tag text={t.text} tone={t.tone} />{/each}
			</div>
		{/if}
	</div>
	<span class="sp"></span>
	{#if actions}{@render actions()}{/if}
</div>
```

- [ ] **Step 5: Verify manually**

Temporarily wire `<Card title="Test" sub="subtitle"><StatsStrip items={[{label:'Active patients',value:'18'}]} /></Card>` and a `<Banner title="P-104A" idChips={[{label:'MRN',value:'4000123-4567'}]} tags={[{text:'Active',tone:'good'}]} />` into `src/routes/+page.svelte`, run `npm run dev`, confirm layout matches the prototype's card/stat/banner look. Remove scratch content after.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/ui/Card.svelte src/lib/components/ui/StatsStrip.svelte src/lib/components/ui/KeyValueList.svelte src/lib/components/ui/Banner.svelte
git commit -m "feat: add structural primitive components (Card, StatsStrip, KeyValueList, Banner)"
```

---

### Task 13: Interactive primitives (Tabs, SegmentedControl, SearchBox, Toolbar, IconButton)

**Files:**
- Create: `src/lib/components/ui/Tabs.svelte`, `SegmentedControl.svelte`, `SearchBox.svelte`, `Toolbar.svelte`, `IconButton.svelte`

**Interfaces:**
- Consumes: `Icon` (Task 11).
- Produces: `<Tabs base items={{key,label,count?}[]} current />`, `<SegmentedControl items={{value,label,count?}[]} current onSelect={(v)=>void} />`, `<SearchBox value oninput={(v)=>void} placeholder />`, `<Toolbar><children /></Toolbar>`, `<IconButton icon onclick? title? dotBadge? />` — consumed by placeholder pages and every future view/table/filter UI.

- [ ] **Step 1: Write `Tabs.svelte`**

```svelte
<!-- src/lib/components/ui/Tabs.svelte -->
<script lang="ts">
	interface Item {
		key: string;
		label: string;
		count?: number;
	}
	let { base, items, current }: { base: string; items: Item[]; current: string } = $props();
</script>

<nav class="tabs">
	{#each items as it (it.key)}
		<a href="{base}/{it.key}" class={it.key === current ? 'on' : ''}>
			{it.label}
			{#if it.count}<span class="c">{it.count}</span>{/if}
		</a>
	{/each}
</nav>
```

- [ ] **Step 2: Write `SegmentedControl.svelte`**

```svelte
<!-- src/lib/components/ui/SegmentedControl.svelte -->
<script lang="ts">
	interface Item {
		value: string;
		label: string;
		count?: number;
	}
	let {
		items,
		current,
		onSelect
	}: { items: Item[]; current: string; onSelect: (v: string) => void } = $props();
</script>

<div class="segs">
	{#each items as it (it.value)}
		<button type="button" class={it.value === current ? 'on' : ''} onclick={() => onSelect(it.value)}>
			{it.label}
			{#if it.count != null}<span class="c">{it.count}</span>{/if}
		</button>
	{/each}
</div>
```

- [ ] **Step 3: Write `SearchBox.svelte`**

```svelte
<!-- src/lib/components/ui/SearchBox.svelte -->
<script lang="ts">
	import Icon from './Icon.svelte';
	let {
		value = '',
		oninput,
		placeholder = 'Search'
	}: { value?: string; oninput: (v: string) => void; placeholder?: string } = $props();
	let timer: ReturnType<typeof setTimeout>;
	function handleInput(e: Event) {
		const v = (e.target as HTMLInputElement).value;
		clearTimeout(timer);
		timer = setTimeout(() => oninput(v), 180);
	}
</script>

<label class="inp">
	<Icon name="search" size={14} />
	<input {placeholder} value={value} oninput={handleInput} />
</label>
```

- [ ] **Step 4: Write `Toolbar.svelte`, `IconButton.svelte`**

```svelte
<!-- src/lib/components/ui/Toolbar.svelte -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<div class="toolbar">{@render children()}</div>
```

```svelte
<!-- src/lib/components/ui/IconButton.svelte -->
<script lang="ts">
	import Icon from './Icon.svelte';
	let {
		icon,
		title = '',
		dotBadge = false,
		onclick
	}: { icon: string; title?: string; dotBadge?: boolean; onclick?: () => void } = $props();
</script>

<button type="button" class="icon-btn" {title} {onclick}>
	<Icon name={icon} size={17} />
	{#if dotBadge}<span class="dot"></span>{/if}
</button>
```

- [ ] **Step 5: Verify manually**

Wire a `<SegmentedControl items={[{value:'all',label:'All',count:5},{value:'mine',label:'Mine'}]} current="all" onSelect={(v) => console.log(v)} />` and a `<SearchBox oninput={(v) => console.log(v)} placeholder="Search patients" />` into `src/routes/+page.svelte`. Run `npm run dev`; click segments and confirm the console logs the selected value; type in the search box and confirm the console logs after the ~180ms debounce, not on every keystroke. Remove scratch content after.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/ui/Tabs.svelte src/lib/components/ui/SegmentedControl.svelte src/lib/components/ui/SearchBox.svelte src/lib/components/ui/Toolbar.svelte src/lib/components/ui/IconButton.svelte
git commit -m "feat: add interactive primitive components (Tabs, SegmentedControl, SearchBox, Toolbar, IconButton)"
```

---

### Task 14: DataTable component

**Files:**
- Create: `src/lib/components/ui/DataTable.svelte`

**Interfaces:**
- Produces: `<DataTable columns={{header,render:(row)=>string,sortValue?:(row)=>string|number,align?:'r',width?}[]} rows onRowClick? limit? emptyText? />` (generic, sortable, click-through table) — consumed by every future list view (Patients, Fleet, Audit, etc.).

- [ ] **Step 1: Write the component**

```svelte
<!-- src/lib/components/ui/DataTable.svelte -->
<script lang="ts" generics="T">
	interface Column<T> {
		header: string;
		render: (row: T) => string;
		sortValue?: (row: T) => string | number;
		align?: 'r';
		width?: string;
	}
	let {
		columns,
		rows,
		onRowClick,
		limit,
		emptyText = 'Nothing to show.'
	}: {
		columns: Column<T>[];
		rows: T[];
		onRowClick?: (row: T) => void;
		limit?: number;
		emptyText?: string;
	} = $props();

	let sortCol = $state<number | null>(null);
	let sortDir = $state<1 | -1>(1);

	function sortedRows() {
		if (sortCol == null || !columns[sortCol].sortValue) return rows;
		const c = columns[sortCol];
		return [...rows].sort((a, b) => {
			const va = c.sortValue!(a),
				vb = c.sortValue!(b);
			return (va > vb ? 1 : va < vb ? -1 : 0) * sortDir;
		});
	}
	function shownRows() {
		const data = sortedRows();
		return limit && data.length > limit ? data.slice(0, limit) : data;
	}
	function toggleSort(i: number) {
		if (!columns[i].sortValue) return;
		if (sortCol === i) sortDir = sortDir === 1 ? -1 : 1;
		else {
			sortCol = i;
			sortDir = 1;
		}
	}
</script>

{#if rows.length === 0}
	<div class="empty">{emptyText}</div>
{:else}
	<div class="tbl-wrap">
		<table class="tbl">
			<thead>
				<tr>
					{#each columns as c, i (c.header)}
						<th
							class="{c.align === 'r' ? 'r' : ''} {c.sortValue ? 'sortable' : ''}"
							style={c.width ? `width:${c.width}` : undefined}
							onclick={() => toggleSort(i)}
						>
							{c.header}{sortCol === i ? (sortDir > 0 ? ' ↑' : ' ↓') : ''}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each shownRows() as row, i (i)}
					<tr class={onRowClick ? 'click' : ''} onclick={() => onRowClick?.(row)}>
						{#each columns as c (c.header)}
							<td class={c.align === 'r' ? 'r num' : ''}>{@html c.render(row)}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if limit && rows.length > limit}
		<div class="tbl-foot"><span>Showing 1–{limit} of {rows.length}</span></div>
	{/if}
{/if}
```

- [ ] **Step 2: Verify manually**

Wire a `<DataTable columns={[{header:'Name',render:(r)=>r.name,sortValue:(r)=>r.name},{header:'Age',render:(r)=>String(r.age),sortValue:(r)=>r.age,align:'r'}]} rows={DB.patients.slice(0,5)} onRowClick={(r)=>console.log(r.id)} />` (import `DB` from `$lib/data/db`) into `src/routes/+page.svelte`. Run `npm run dev`: confirm 5 rows render, clicking a header sorts (and re-clicking reverses), clicking a row logs its id. Also verify with `rows={[]}` that the empty-state text shows instead of an empty table. Remove scratch content after.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/ui/DataTable.svelte
git commit -m "feat: add generic sortable DataTable component"
```

---

### Task 15: Modal, ToastHost, Tooltip components

**Files:**
- Create: `src/lib/components/ui/Modal.svelte`, `ToastHost.svelte`, `Tooltip.svelte`

**Interfaces:**
- Consumes: `modal`, `closeModal` and `toasts` from `$lib/stores/ui`.
- Produces: `<Modal />` (renders the current `$modal` spec as a scrim + form, or nothing), `<ToastHost />` (renders the `$toasts` queue), `<Tooltip />` (a single shared tooltip, content set via a `data-tip` attribute on any element, shown on hover) — each mounted exactly once, in Task 16's root layout.

- [ ] **Step 1: Write `Modal.svelte`**

```svelte
<!-- src/lib/components/ui/Modal.svelte -->
<script lang="ts">
	import { modal, closeModal } from '$lib/stores/ui';
	import Icon from './Icon.svelte';

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!$modal) return;
		const fd = new FormData(e.target as HTMLFormElement);
		const data: Record<string, string> = {};
		for (const [k, v] of fd.entries()) data[k] = String(v);
		const result = $modal.onSubmit(data);
		if (result !== false) closeModal();
	}
</script>

{#if $modal}
	<div class="scrim" onclick={(e) => e.target === e.currentTarget && closeModal()}>
		<form class="modal" autocomplete="off" onsubmit={handleSubmit}>
			<div class="modal-h">
				<div class="grow">
					<h3>{$modal.title}</h3>
					{#if $modal.sub}<p>{$modal.sub}</p>{/if}
				</div>
				<button type="button" class="icon-btn" onclick={closeModal}><Icon name="x" /></button>
			</div>
			<div class="modal-b">{@html $modal.body}</div>
			<div class="modal-f">
				<button type="button" class="btn" onclick={closeModal}>Cancel</button>
				<button class="btn pri" type="submit">{$modal.submitLabel || 'Save'}</button>
			</div>
		</form>
	</div>
{/if}
```

- [ ] **Step 2: Write `ToastHost.svelte`**

```svelte
<!-- src/lib/components/ui/ToastHost.svelte -->
<script lang="ts">
	import { toasts } from '$lib/stores/ui';
	import Icon from './Icon.svelte';
</script>

{#each $toasts as t (t.id)}
	<div class="toast"><Icon name="check" size={15} />{t.message}</div>
{/each}
```

- [ ] **Step 3: Write `Tooltip.svelte`**

```svelte
<!-- src/lib/components/ui/Tooltip.svelte -->
<script lang="ts">
	let visible = $state(false);
	let content = $state('');
	let x = $state(0);
	let y = $state(0);

	function handleMove(e: MouseEvent) {
		const el = (e.target as HTMLElement)?.closest?.('[data-tip]') as HTMLElement | null;
		if (!el) {
			visible = false;
			return;
		}
		content = el.getAttribute('data-tip') || '';
		visible = true;
		const w = 260,
			h = 60; // rough estimate before layout; fine for a floating hint
		let px = e.clientX + 14,
			py = e.clientY - h - 12;
		if (px + w > innerWidth - 8) px = e.clientX - w - 14;
		if (py < 8) py = e.clientY + 18;
		x = px;
		y = py;
	}
</script>

<svelte:window onmousemove={handleMove} />

<div id="tip" style="opacity:{visible ? 1 : 0}; left:{x}px; top:{y}px">{@html content}</div>
```

- [ ] **Step 4: Verify manually**

Wire `<Modal />`, `<ToastHost />`, `<Tooltip />` plus a button `onclick={() => openModal({title:'Test', body:'<p>Body</p>', onSubmit: () => showToast('Saved!')})}` and a `<span data-tip="Hover text">hover me</span>` into `src/routes/+page.svelte` (import `openModal`, `showToast` from `$lib/stores/ui`). Run `npm run dev`: open the modal, submit it, confirm a toast appears and auto-dismisses after ~2.6s; hover the span and confirm the tooltip follows the cursor. Remove scratch content after.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/ui/Modal.svelte src/lib/components/ui/ToastHost.svelte src/lib/components/ui/Tooltip.svelte
git commit -m "feat: add Modal, ToastHost, and Tooltip components"
```

---

### Task 16: Root layout (SSR off, global styles, theme init, global portals)

**Files:**
- Modify: `src/routes/+layout.svelte`
- Create: `src/routes/+layout.ts`

**Interfaces:**
- Consumes: `theme` from `$lib/stores/theme`, `restoreSession` from `$lib/stores/auth`, `Modal`/`ToastHost`/`Tooltip` from Task 15.
- Produces: the app shell wrapper every route renders inside; sets `ssr = false` for the whole app.

- [ ] **Step 1: Disable SSR app-wide**

```ts
// src/routes/+layout.ts
export const ssr = false;
```

- [ ] **Step 2: Write the root layout**

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
	import '$lib/styles/tokens.css';
	import '$lib/styles/base.css';
	import { onMount } from 'svelte';
	import { theme } from '$lib/stores/theme';
	import { restoreSession } from '$lib/stores/auth';
	import Modal from '$lib/components/ui/Modal.svelte';
	import ToastHost from '$lib/components/ui/ToastHost.svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';

	let { children } = $props();

	onMount(() => {
		restoreSession();
	});

	$effect(() => {
		document.documentElement.dataset.theme = $theme;
	});
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

{@render children()}
<Modal />
<ToastHost />
<Tooltip />
```

- [ ] **Step 3: Verify manually**

Run `npm run dev`. The default route (`/`) will 404 or show blank since no real page exists yet — that's expected at this point; confirm there's no console error from the layout itself (theme attribute set, no missing-module errors).

- [ ] **Step 4: Commit**

```bash
git add src/routes/+layout.svelte src/routes/+layout.ts
git commit -m "feat: wire root layout (SSR off, global styles, theme, global portals)"
```

---

### Task 17: Login page

**Files:**
- Create: `src/routes/login/+page.svelte`

**Interfaces:**
- Consumes: `login` from `$lib/stores/auth`, `HOME` from `$lib/data/users`.
- Produces: `/login` route — on success, navigates to `/{HOME[role]}`.

- [ ] **Step 1: Write the page**

```svelte
<!-- src/routes/login/+page.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { login, currentUser } from '$lib/stores/auth';
	import { HOME } from '$lib/data/users';
	import Icon from '$lib/components/ui/Icon.svelte';

	let userid = $state('');
	let password = $state('');
	let remember = $state(true);
	let showPw = $state(false);
	let error = $state('');

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const result = login(userid, password, remember);
		if (!result.ok) {
			error = result.message;
			password = '';
			return;
		}
		error = '';
		const u = $currentUser!;
		goto('/' + HOME[u.role]);
	}
</script>

<div class="login">
	<div class="login-logo"><span class="logo"><Icon name="pulse" size={17} /></span>NeuroDash</div>
	<form class="login-card" onsubmit={handleSubmit} autocomplete="on">
		<h1>Sign in</h1>
		<p>Welcome back. Enter your details to continue.</p>
		{#if error}
			<div class="login-err"><Icon name="alert" size={15} /><span>{error}</span></div>
		{/if}
		<div class="field">
			<label for="uid">User ID</label>
			<input id="uid" bind:value={userid} autocomplete="username" placeholder="firstname.lastname" required />
		</div>
		<div class="field">
			<label for="pwd">Password</label>
			<div class="pw">
				<input id="pwd" type={showPw ? 'text' : 'password'} bind:value={password} autocomplete="current-password" required />
				<button type="button" onclick={() => (showPw = !showPw)}>{showPw ? 'Hide' : 'Show'}</button>
			</div>
		</div>
		<div class="login-row">
			<label><input type="checkbox" bind:checked={remember} style="accent-color:var(--brand)" /> Keep me signed in</label>
			<a href="/login" class="lnk" style="color:var(--brand)" onclick={(e) => e.preventDefault()}>Forgot password?</a>
		</div>
		<button class="btn pri block" type="submit" style="background:var(--brand)">Sign in</button>
	</form>
	<div class="login-foot"><span>© {new Date().getFullYear()} NeuroDash</span><span>v2.0</span></div>
</div>
```

- [ ] **Step 2: Verify manually — all four demo accounts**

Run `npm run dev`, open `/login`. For each of `priya.nair`, `vikram.suresh`, `arjun.rao`, `sam.thomas` (all password `neuro@123`): sign in, confirm no crash (destination route doesn't exist yet, so expect a 404 there — that's fine, it proves login itself succeeded and `goto()` fired with the right path: `/today`, `/review`, `/fleet`, `/overview` respectively). Then test a wrong password: confirm the inline error shows and the password field clears. Test the "Show/Hide" toggle.

- [ ] **Step 3: Commit**

```bash
git add src/routes/login/+page.svelte
git commit -m "feat: add login page"
```

---

### Task 18: Sidebar component

**Files:**
- Create: `src/lib/components/shell/Sidebar.svelte`

**Interfaces:**
- Consumes: `NAV`, `ROLE_LABEL` from `$lib/data/users`; `DB`, `scopeUnits`, `OPEN_FAULT` (re-exported from `generate.ts` via `db.ts` — add the re-export if missing) from `$lib/data/db`; `Avatar`, `Icon` (Task 11).
- Produces: `<Sidebar user currentPage unreadCount onNotifClick onSearchClick onUserClick />` — consumed by Task 22's `(app)` layout.

- [ ] **Step 1: Re-export `OPEN_FAULT` from `db.ts`**

```ts
// add to src/lib/data/db.ts
export { OPEN_FAULT } from './generate';
```

- [ ] **Step 2: Write the component**

```svelte
<!-- src/lib/components/shell/Sidebar.svelte -->
<script lang="ts">
	import type { User } from '$lib/data/users';
	import { NAV, ROLE_LABEL } from '$lib/data/users';
	import { DB, scopeUnits, OPEN_FAULT } from '$lib/data/db';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';

	let {
		user,
		currentPage,
		unreadCount,
		onNotifClick,
		onSearchClick,
		onUserClick
	}: {
		user: User;
		currentPage: string;
		unreadCount: number;
		onNotifClick: () => void;
		onSearchClick: () => void;
		onUserClick: () => void;
	} = $props();

	function navCount(page: string): number {
		const mineU = scopeUnits(user).map((u) => u.id);
		if (page === 'service' && (user.role === 'engineer' || user.role === 'admin')) {
			return DB.faults.filter((f) => OPEN_FAULT(f) && mineU.includes(f.unitId)).length;
		}
		if (page === 'requests') {
			return DB.requests.filter((q) => q.status === 'Pending' && (user.role === 'admin' || (user.owns ?? []).includes(q.typeId))).length;
		}
		// "today" (therapist) and "review" (consultant) counts depend on patientMetrics(),
		// which lands with the Therapist/Consultant view sub-projects — 0 until then.
		return 0;
	}
</script>

<aside class="side">
	<div class="ws">
		<span class="logo"><Icon name="pulse" size={16} /></span>
		<div class="grow" style="min-width:0">
			<b>NeuroDash</b>
			<span class="nowrap" style="display:block;overflow:hidden;text-overflow:ellipsis">Neuro Rehab Unit</span>
		</div>
		<button class="icon-btn" title="Notifications" onclick={onNotifClick}>
			<Icon name="bell" size={17} />
			{#if unreadCount}<span class="dot"></span>{/if}
		</button>
	</div>
	<button class="searchbtn" onclick={onSearchClick}><Icon name="search" size={14} />Search<span class="kbd">Ctrl K</span></button>
	<nav class="nav">
		{#each NAV[user.role] as n (Array.isArray(n) ? n[0] : n)}
			{#if typeof n === 'string'}
				<div class="sec">{n.slice(1)}</div>
			{:else}
				{@const count = navCount(n[0])}
				<a href="/{n[0]}" class={n[0] === currentPage ? 'on' : ''}>
					<Icon name={n[2]} />
					<span>{n[1]}</span>
					{#if count}<span class="cnt">{count}</span>{/if}
				</a>
			{/if}
		{/each}
	</nav>
	<button class="userbtn" onclick={onUserClick}>
		<Avatar {user} />
		<div style="min-width:0;flex:1">
			<b>{user.name}</b>
			<span>{ROLE_LABEL[user.role]}</span>
		</div>
		<Icon name="chevd" size={14} />
	</button>
</aside>
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/data/db.ts src/lib/components/shell/Sidebar.svelte
git commit -m "feat: add role-aware Sidebar component"
```

(Manual verification happens in Task 22 once the shell layout wires it in — a sidebar in isolation has nothing meaningful to click through to yet.)

---

### Task 19: CommandPalette component

**Files:**
- Create: `src/lib/components/shell/CommandPalette.svelte`

**Interfaces:**
- Consumes: `commandPaletteOpen` from `$lib/stores/ui`; `NAV` from `$lib/data/users`; `scopePatients`, `scopeUnits`, `anon`, `pname`, `liveStatus`, `DB` from `$lib/data/db`; `typeOf` from `$lib/data/reference`.
- Produces: `<CommandPalette user />` — listens for Ctrl/Cmd+K globally, opens/closes via the `commandPaletteOpen` store.

- [ ] **Step 1: Write the component**

```svelte
<!-- src/lib/components/shell/CommandPalette.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import type { User } from '$lib/data/users';
	import { NAV } from '$lib/data/users';
	import { scopePatients, scopeUnits, anon, pname, liveStatus } from '$lib/data/db';
	import { typeOf } from '$lib/data/reference';
	import { commandPaletteOpen } from '$lib/stores/ui';
	import Icon from '$lib/components/ui/Icon.svelte';

	let { user }: { user: User } = $props();

	let query = $state('');
	let selected = $state(0);
	let inputEl: HTMLInputElement;

	interface Item {
		group: string;
		iconName: string;
		title: string;
		sub: string;
		href: string;
		key: string;
	}

	function allItems(): Item[] {
		const pages: Item[] = NAV[user.role]
			.filter((n): n is [string, string, string] => Array.isArray(n))
			.map((n) => ({ group: 'Pages', iconName: n[2], title: n[1], sub: '', href: '/' + n[0], key: n[1] }));
		const patients: Item[] =
			user.role === 'engineer'
				? []
				: scopePatients(user).map((p) => ({
						group: 'Patients',
						iconName: 'user',
						title: pname(user, p),
						sub: 'MRN ' + p.mrn + ' · ' + p.status,
						href: '/patients/' + p.id,
						key: p.name + p.mrn + p.diagnosis
					}));
		const devices: Item[] =
			user.role === 'engineer' || user.role === 'admin'
				? scopeUnits(user).map((u) => ({
						group: 'Devices',
						iconName: 'robot',
						title: u.id,
						sub: typeOf(u.typeId)!.name + ' · ' + liveStatus(u),
						href: '/fleet/' + u.id,
						key: u.id + u.room + typeOf(u.typeId)!.name
					}))
				: [];
		return [...pages, ...patients, ...devices];
	}

	function filtered(): Item[] {
		const q = query.toLowerCase().trim();
		return allItems()
			.filter((x) => !q || (x.key || x.title).toLowerCase().includes(q))
			.slice(0, 12);
	}

	function close() {
		commandPaletteOpen.set(false);
		query = '';
		selected = 0;
	}
	function pick(i: number) {
		const items = filtered();
		if (items[i]) {
			close();
			goto(items[i].href);
		}
	}
	function handleKeydown(e: KeyboardEvent) {
		const items = filtered();
		if (e.key === 'ArrowDown') {
			selected = Math.min(items.length - 1, selected + 1);
			e.preventDefault();
		} else if (e.key === 'ArrowUp') {
			selected = Math.max(0, selected - 1);
			e.preventDefault();
		} else if (e.key === 'Enter') pick(selected);
		else if (e.key === 'Escape') close();
	}
	function handleGlobalKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			commandPaletteOpen.set(true);
			queueMicrotask(() => inputEl?.focus());
		}
	}

	$effect(() => {
		if ($commandPaletteOpen) selected = 0;
	});
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

{#if $commandPaletteOpen}
	<div class="cmdk-scrim" onclick={(e) => e.target === e.currentTarget && close()}>
		<div class="cmdk">
			<input bind:this={inputEl} bind:value={query} onkeydown={handleKeydown} placeholder="Search patients, devices, pages…" />
			<div class="cmdk-list">
				{#if filtered().length === 0}
					<div class="empty">No results</div>
				{:else}
					{#each filtered() as item, i (item.group + item.title)}
						{#if i === 0 || filtered()[i - 1].group !== item.group}
							<div class="cmdk-g">{item.group}</div>
						{/if}
						<div class="cmdk-i {i === selected ? 'sel' : ''}" onclick={() => pick(i)}>
							<Icon name={item.iconName} size={15} />
							<span>{item.title}</span>
							<span class="sub">{item.sub}</span>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/shell/CommandPalette.svelte
git commit -m "feat: add global command palette (Ctrl/Cmd+K)"
```

(Manual verification happens in Task 22 alongside Sidebar.)

---

### Task 20: NotificationsPopover component

**Files:**
- Create: `src/lib/components/shell/NotificationsPopover.svelte`

**Interfaces:**
- Consumes: `DB`, `scopeUnits`, `OPEN_FAULT`, `daysToCal` from `$lib/data/db`; `typeOf` from `$lib/data/reference`; `userOf` from `$lib/data/users`; `rel` from `$lib/data/seed`; `notificationsRead`, `markRead`, `markAllRead` from `$lib/stores/ui`.
- Produces: `<NotificationsPopover user open onClose />`; also exports `notifications(user): NotificationItem[]` and `unreadCount(user): number` as named exports from a co-located `notifications.ts` so `Sidebar`/`(app)` layout can compute the unread badge without importing the Svelte component.

- [ ] **Step 1: Write `notifications.ts`**

```ts
// src/lib/components/shell/notifications.ts
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
```

- [ ] **Step 2: Write `NotificationsPopover.svelte`**

```svelte
<!-- src/lib/components/shell/NotificationsPopover.svelte -->
<script lang="ts">
	import type { User } from '$lib/data/users';
	import { notificationsRead, markRead, markAllRead } from '$lib/stores/ui';
	import { notifications } from './notifications';
	import { rel } from '$lib/data/seed';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';

	let { user, open, onClose }: { user: User; open: boolean; onClose: () => void } = $props();

	const items = $derived(notifications(user));
	const unread = $derived(items.filter((n) => !$notificationsRead.has(n.id)).length);

	function handleClick(id: string, href: string) {
		markRead(id);
		onClose();
		goto(href);
	}
</script>

{#if open}
	<div class="pop notif" style="right:16px;top:52px">
		<div class="notif-h">
			<b>Notifications</b>
			{#if unread}
				<span class="xs muted">{unread} unread</span>
				<button class="btn sm ghost" onclick={() => markAllRead(items.map((n) => n.id))}>Mark all read</button>
			{/if}
		</div>
		<div class="notif-b">
			{#if items.length === 0}
				<div class="empty">You're all caught up.</div>
			{:else}
				{#each items as n (n.id)}
					<div class="ni {$notificationsRead.has(n.id) ? '' : 'unread'}" onclick={() => handleClick(n.id, n.href)}>
						<div class="li" style="padding:0;border:0">
							<div class="ico {n.tone}">
								<Icon name={n.tone === 'crit' ? 'alert' : n.tone === 'good' ? 'check' : n.tone === 'warn' ? 'clock' : 'bell'} size={14} />
							</div>
						</div>
						<div class="grow">
							<div class="t">{n.title}</div>
							<div class="d">{n.desc}</div>
							<div class="w">{rel(n.date)}</div>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
{/if}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/shell/notifications.ts src/lib/components/shell/NotificationsPopover.svelte
git commit -m "feat: add notifications feed and popover (fault/request/calibration items)"
```

(Manual verification happens in Task 22.)

---

### Task 21: UserMenu and TopBar components

**Files:**
- Create: `src/lib/components/shell/UserMenu.svelte`, `TopBar.svelte`

**Interfaces:**
- Consumes: `theme`, `toggleTheme` from `$lib/stores/theme`; `logout` from `$lib/stores/auth`; `commandPaletteOpen` from `$lib/stores/ui`.
- Produces: `<UserMenu user open onClose />`, `<TopBar backHref? backLabel? />` — consumed by Task 22.

- [ ] **Step 1: Write `UserMenu.svelte`**

```svelte
<!-- src/lib/components/shell/UserMenu.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import type { User } from '$lib/data/users';
	import { theme, toggleTheme } from '$lib/stores/theme';
	import { logout } from '$lib/stores/auth';
	import { commandPaletteOpen } from '$lib/stores/ui';
	import Icon from '$lib/components/ui/Icon.svelte';

	let { user, open, onClose }: { user: User; open: boolean; onClose: () => void } = $props();

	function signOut() {
		onClose();
		logout();
		goto('/login');
	}
	function openSearch() {
		onClose();
		commandPaletteOpen.set(true);
	}
</script>

{#if open}
	<div class="pop menu" style="right:16px;top:52px;width:230px">
		<div class="mh">
			<b>{user.name}</b>
			<span>{user.email}</span>
		</div>
		<div class="mi" style="cursor:default">
			<Icon name={$theme === 'dark' ? 'moon' : 'sun'} size={15} />
			<span class="grow">Theme</span>
			<div class="segs" style="padding:2px">
				<button type="button" class={$theme === 'dark' ? '' : 'on'} style="padding:2px 8px;font-size:12px" onclick={() => toggleTheme()}>Light</button>
				<button type="button" class={$theme === 'dark' ? 'on' : ''} style="padding:2px 8px;font-size:12px" onclick={() => toggleTheme()}>Dark</button>
			</div>
		</div>
		<button class="mi" onclick={openSearch}><Icon name="search" size={15} />Search<span class="kbd">Ctrl K</span></button>
		<hr />
		<button class="mi" onclick={signOut}><Icon name="logout" size={15} />Sign out</button>
	</div>
{/if}
```

- [ ] **Step 2: Write `TopBar.svelte`**

```svelte
<!-- src/lib/components/shell/TopBar.svelte -->
<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	let { backHref, backLabel }: { backHref?: string; backLabel?: string } = $props();
</script>

{#if backHref}
	<a class="back" href={backHref}>
		<Icon name="chev" size={13} />
		{backLabel}
	</a>
{/if}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/shell/UserMenu.svelte src/lib/components/shell/TopBar.svelte
git commit -m "feat: add UserMenu and TopBar components"
```

---

### Task 22: `(app)` layout — auth guard + shell wiring, home redirect

**Files:**
- Create: `src/routes/(app)/+layout.ts`
- Create: `src/routes/(app)/+layout.svelte`
- Create: `src/routes/(app)/+page.ts`

**Interfaces:**
- Consumes: `currentUser` from `$lib/stores/auth`; `Sidebar`, `CommandPalette`, `NotificationsPopover`, `UserMenu` from Tasks 18–21; `unreadCount` from `$lib/components/shell/notifications`; `densityFor` from `$lib/stores/theme`; `HOME` from `$lib/data/users`.
- Produces: the authenticated shell every `(app)` route renders inside; redirects unauthenticated visitors to `/login`; redirects `/` to the current user's home route.

- [ ] **Step 1: Write the auth-guard load function**

Since `ssr = false`, `+layout.ts` runs in the browser; it's safe to read the store directly.

```ts
// src/routes/(app)/+layout.ts
import { redirect } from '@sveltejs/kit';
import { get } from 'svelte/store';
import { currentUser, restoreSession } from '$lib/stores/auth';

export const ssr = false;

export function load() {
	restoreSession();
	const user = get(currentUser);
	if (!user) throw redirect(307, '/login');
	return { user };
}
```

- [ ] **Step 2: Write the shell layout**

```svelte
<!-- src/routes/(app)/+layout.svelte -->
<script lang="ts">
	import { page } from '$app/state';
	import Sidebar from '$lib/components/shell/Sidebar.svelte';
	import CommandPalette from '$lib/components/shell/CommandPalette.svelte';
	import NotificationsPopover from '$lib/components/shell/NotificationsPopover.svelte';
	import UserMenu from '$lib/components/shell/UserMenu.svelte';
	import { unreadCount } from '$lib/components/shell/notifications';
	import { densityFor } from '$lib/stores/theme';

	let { data, children } = $props();
	const user = data.user;

	let notifOpen = $state(false);
	let userMenuOpen = $state(false);

	const currentPage = $derived(page.url.pathname.split('/').filter(Boolean)[0] ?? '');

	$effect(() => {
		document.body.dataset.role = user.role;
		document.body.dataset.density = densityFor(user.role);
	});
</script>

<div class="shell">
	<Sidebar
		{user}
		{currentPage}
		unreadCount={unreadCount(user)}
		onNotifClick={() => {
			notifOpen = !notifOpen;
			userMenuOpen = false;
		}}
		onSearchClick={() => {}}
		onUserClick={() => {
			userMenuOpen = !userMenuOpen;
			notifOpen = false;
		}}
	/>
	<div class="main">
		<main class="content">
			{@render children()}
		</main>
	</div>
</div>
<CommandPalette {user} />
<NotificationsPopover {user} open={notifOpen} onClose={() => (notifOpen = false)} />
<UserMenu {user} open={userMenuOpen} onClose={() => (userMenuOpen = false)} />
```

Note: `onSearchClick` on `Sidebar`'s search button is wired to a no-op here because `CommandPalette` currently only opens via Ctrl/Cmd+K (its own global listener); wire the button in a later pass if this gap is noticed during manual verification — import `commandPaletteOpen` from `$lib/stores/ui` and set it to `true` in the click handler:

```ts
import { commandPaletteOpen } from '$lib/stores/ui';
// ...
onSearchClick={() => (commandPaletteOpen.set(true))}
```
Use the real version (not the no-op) when writing this file.

- [ ] **Step 3: Redirect `/` to the user's home route**

```ts
// src/routes/(app)/+page.ts
import { redirect } from '@sveltejs/kit';
import { get } from 'svelte/store';
import { currentUser } from '$lib/stores/auth';
import { HOME } from '$lib/data/users';

export const ssr = false;

export function load() {
	const user = get(currentUser)!; // guaranteed by the parent layout guard
	throw redirect(307, '/' + HOME[user.role]);
}
```

Create the matching empty page component so the route is valid:
```svelte
<!-- src/routes/(app)/+page.svelte -->
<!-- unreachable: +page.ts always redirects before this renders -->
```

- [ ] **Step 4: Commit**

```bash
git add "src/routes/(app)/+layout.ts" "src/routes/(app)/+layout.svelte" "src/routes/(app)/+page.ts" "src/routes/(app)/+page.svelte"
git commit -m "feat: wire authenticated app shell (auth guard, nav, command palette, notifications, user menu)"
```

(Full manual verification, across all 4 roles, happens in Task 23 once placeholder pages exist to land on.)

---

### Task 23: Placeholder pages for every route + end-to-end smoke test

**Files:**
- Create: `src/routes/(app)/today/+page.svelte`, `patients/+page.svelte`, `equipment/+page.svelte`, `review/+page.svelte`, `outcomes/+page.svelte`, `fleet/+page.svelte`, `service/+page.svelte`, `requests/+page.svelte`, `overview/+page.svelte`, `members/+page.svelte`, `audit/+page.svelte`
- Create: `src/routes/(app)/patients/[id]/+page.svelte`, `src/routes/(app)/fleet/[id]/+page.svelte`

**Interfaces:**
- Consumes: `Card` (Task 12).
- Produces: every route referenced by `NAV`/`DETAIL` resolves to a real page, proving the shell/nav/guard work end-to-end for all 4 roles.

- [ ] **Step 1: Write one placeholder page (repeat for all 11 top-level routes)**

```svelte
<!-- src/routes/(app)/today/+page.svelte -->
<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
</script>

<div class="ph"><div><h1>Today</h1></div></div>
<Card><p class="muted">Coming soon — built in the Therapist views sub-project.</p></Card>
```

Repeat with the matching title for `patients` ("My patients"), `equipment` ("Equipment"), `review` ("Clinical review"), `outcomes` ("Outcomes"), `fleet` ("Fleet"), `service` ("Service"), `requests` ("Requests"), `overview` ("Overview"), `members` ("Members"), `audit` ("Audit log") — each a two-line file identical in shape to the one above, just with a different `<h1>` and sub-project name in the coming-soon text (Therapist/Consultant/Engineer/Admin as appropriate).

- [ ] **Step 2: Write the detail-route stubs**

```svelte
<!-- src/routes/(app)/patients/[id]/+page.svelte -->
<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	let { data } = $props();
</script>

<div class="ph"><div><h1>Patient {data.id}</h1></div></div>
<Card><p class="muted">Coming soon — built in the Therapist/Consultant views sub-project.</p></Card>
```
```ts
// src/routes/(app)/patients/[id]/+page.ts
export const ssr = false;
export function load({ params }) {
	return { id: params.id };
}
```

Repeat the same pair for `src/routes/(app)/fleet/[id]/+page.svelte` and `+page.ts` ("Device {id}", Engineer/Admin sub-project).

- [ ] **Step 3: End-to-end manual smoke test — all 4 roles**

Run `npm run dev`. For each demo account (`priya.nair` → therapist, `vikram.suresh` → consultant, `arjun.rao` → engineer, `sam.thomas` → admin, all password `neuro@123`):
1. Log in at `/login`, confirm redirect lands on the correct home route (`/today`, `/review`, `/fleet`, `/overview`).
2. Confirm the sidebar nav shows exactly that role's `NAV` entries (admin should see section headers "Clinical"/"Devices"/"Organisation").
3. Click every nav link, confirm each placeholder page renders inside the shell without console errors.
4. Manually navigate the browser to a page outside the role's nav (e.g. as therapist, go to `/audit`) — **this currently 404s because no guard-page exists for disallowed-but-routed pages; note this as a known gap for the sub-project that adds `notAllowed()` handling, do not silently skip it.**
5. Open the command palette (Ctrl/Cmd+K), search a page name, a patient (if not engineer), and a device (if engineer/admin); confirm Enter navigates there.
6. Click the notification bell: engineer/admin should see fault/request/calibration items (if any exist in the seeded data — check `ATLAS-01`'s Critical fault shows up for `U-E3`... actually `ATLAS-01` is owned by `U-E3` per `owns:['COSMOS','ATLAS']` — verify against the actual owner); consultant should see any "Plan changed" items from the last 7 days (may legitimately be empty depending on seeded dates — verify against `DB.patients` plan history, don't assume it's broken if empty); therapist should see the empty state.
7. Click the user avatar button, toggle theme light→dark→light, confirm all colors flip (background, text, accent).
8. Sign out, confirm redirect to `/login` and that navigating back to `/today` redirects to `/login` again (session cleared).
9. Log back in with "Keep me signed in" unchecked, close and reopen the tab (or clear `sessionStorage` manually to simulate), confirm the session does *not* persist — then repeat with it checked via `localStorage` and confirm it does.

Fix anything broken found during this pass before moving on — this task's deliverable is a working, verified shell, not just code that compiles.

- [ ] **Step 4: Run the full data-layer test suite one more time**

Run: `npm run test`
Expected: all tests from Tasks 2–9 still pass (nothing here should have touched the data layer, but this is the cheapest possible regression check before calling Foundation done).

- [ ] **Step 5: Commit**

```bash
git add "src/routes/(app)"
git commit -m "feat: add placeholder pages for all routes; Foundation sub-project complete"
```

---

## Known gap carried forward (not a bug to fix in this plan)

Step 3.4 above will surface that navigating to a page outside a role's `NAV` (but still a valid route file, e.g. therapist → `/audit`) 404s instead of showing a "not allowed" card, because SvelteKit's router doesn't know about role permissions — only the original's `allowed()` check (already ported in `db.ts`) does. Wiring `allowed()` into each page (or a shared `+layout.ts` per top-level route) to render a shared `NotAllowed` component instead of 404ing is real, valuable work — but it touches page-level routing decisions that are cleaner to make once real page content (and its own data-loading pattern) exists. Flag it explicitly to whoever picks up the next sub-project rather than silently declaring Foundation "done" with this gap invisible.
