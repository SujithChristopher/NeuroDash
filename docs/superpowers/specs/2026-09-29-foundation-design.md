# NeuroDash Foundation — Design Spec

**Date:** 2026-09-29
**Status:** Approved for planning
**Scope:** Sub-project 1 of 5 in the full port of `backup/neurodash-v2 (1).html` (a vanilla-JS SPA prototype) into the SvelteKit app. This sub-project builds the shared foundation only — design system, fake data layer, auth, app shell/navigation, and core reusable components. It does not build any role's real content pages.

## Background

`backup/neurodash-v2 (1).html` is a ~1870-line single-file prototype for NeuroDash, a neuro-rehabilitation device/dashboard app. It has:
- A hand-rolled design system (CSS custom properties, light/dark theme, component classes for cards, tables, pills, buttons, etc.)
- A deterministic fake-data generator (seeded PRNG) producing users, devices, patients, sessions, assessments, faults, and requests
- Demo-only client-side auth (single shared password across 10 seeded users, 4 roles: therapist, consultant, engineer, admin)
- A hash-router SPA shell (sidebar nav that varies by role, command palette, notifications popover, user menu)
- 13 role-scoped views built from reusable string-template primitives (cards, tables, charts, modals, etc.)

The full port is too large for one spec, so it's split into 5 sub-projects: this Foundation, then Therapist views, Consultant views, Engineer views, Admin views — each gets its own design → spec → plan cycle. This document covers only the Foundation.

## Goals

- Reproduce the prototype's exact visual design (colors, spacing, typography, light/dark theme) in SvelteKit, at high fidelity.
- Replace the original's hash router + global mutable `STATE` + manual `render()` with real SvelteKit routing and Svelte stores.
- Port the fake-data generator with identical seed/output.
- Build a working login → role-gated shell → placeholder pages flow, so later sub-projects only need to fill in page content.
- Establish the core reusable UI component library that later sub-projects will build on.

## Non-goals

- Building any role's real page content (Today, Patients, Fleet, Outcomes, etc.) — later sub-projects.
- Chart components (LineChart, BarChart, etc.) — deferred to the sub-projects that need them.
- Real backend/persistence — the prototype's in-memory fake data and demo-only auth are intentionally preserved as-is; not in scope to replace with a real API.
- Automated test suite — not requested; verification is manual/visual via dev server.

## Architecture

### Routing & rendering mode

Real SvelteKit file-based routing replaces the hash router. Root layout sets `export const ssr = false` — the app is entirely client-rendered (fake seeded data generated at module load, auth state read from localStorage/sessionStorage), so disabling SSR avoids hydration-mismatch complexity for no real benefit, and matches the original's SPA behavior.

Route structure:
```
src/routes/
  +layout.svelte          # root: ssr=false, theme init, global styles, toast/modal portal
  login/+page.svelte       # login form
  (app)/
    +layout.ts             # auth guard: redirect to /login if no user in store
    (app)/+layout.svelte    # renders Sidebar + TopBar + <slot>, role-aware nav
    (app)/+page.svelte      # redirect to role's home route
    today/+page.svelte      # placeholder "coming soon" card (therapist home)
    patients/+page.svelte   # placeholder (therapist)
    equipment/+page.svelte  # placeholder (therapist)
    review/+page.svelte     # placeholder (consultant/admin home)
    outcomes/+page.svelte   # placeholder (consultant/admin)
    fleet/+page.svelte      # placeholder (engineer home/admin)
    service/+page.svelte    # placeholder (engineer/admin)
    requests/+page.svelte   # placeholder (engineer/admin)
    overview/+page.svelte   # placeholder (admin home)
    members/+page.svelte    # placeholder (admin)
    audit/+page.svelte      # placeholder (admin)
```
Placeholder pages just render inside the shell with a "Coming soon" `Card` — this proves nav, routing, and role-scoping work end-to-end before later sub-projects fill in content. Patient/device detail routes (`patients/[id]`, `fleet/[id]`) are stubbed as 404-safe placeholders too, deferred to their respective sub-projects.

### Data layer (`src/lib/data/`)

Ported near-verbatim from the prototype, same seed (`20260918`) and same output shape:
- `seed.ts` — RNG + helpers (`rand`, `randInt`, `pick`, `clamp`, `gauss`, date helpers)
- `reference.ts` — `SCALES`, `DEVICE_TYPES`, `GAME_LABELS`, `ROOMS`
- `users.ts` — the 10 seeded `USERS`, derived `login`/`email`/`status`, `DEMO_PASSWORD`
- `generate.ts` — generates `units`, `patients`, `sessions`, `assessments`, `faults`, `requests`, `audit` (ported logic from the original's generation code)
- `db.ts` — assembles the above into one `DB` object (built once at module load) and exports scoping helpers: `scopePatients(user)`, `scopeUnits(user)`, `canSeePatient(user, patient)`, `canSeeUnit(user, unit)`, `anon(user, patient)`

This is a plain TS module with module-level state — not a Svelte store — since the dataset is static per session (matches the original: freshly regenerated each full page load, no mutation persistence).

### Auth (`src/lib/stores/auth.ts`)

A writable store wrapping the current user, persisted to `localStorage` (if "remember me" was checked) or `sessionStorage` otherwise — same as the original's `store` wrapper (`nd.` key prefix). Login page matches input against `USERS` by login or email, checks the single shared `DEMO_PASSWORD`, sets the store, writes an audit "Signed in" entry, redirects to the role's home route. No real backend — same limitation as the prototype, since this is explicitly a UI/demo port.

### Shell (`src/lib/components/shell/`)

- `Sidebar.svelte` — logo/workspace, search button (⌘K hint), nav list (sections + active state + count badges, role-scoped from a `NAV` map), user button opening `UserMenu`
- `TopBar.svelte` — breadcrumb/back-link for detail pages
- `CommandPalette.svelte` — Ctrl/Cmd+K global search over nav pages (+ patients/devices once those sub-projects land)
- `NotificationsPopover.svelte` — role-scoped notification list, unread tracked in a small in-memory store
- `UserMenu.svelte` — theme toggle, sign out

Two small persisted stores: `theme` (light/dark) and role-driven `density` (derived from current user's role, not user-toggleable — matches original).

### Core components (`src/lib/components/ui/`)

`Card`, `StatsStrip`, `Pill`, `Tag`, `Severity`, `DataTable`, `Tabs`, `SegmentedControl`, `SearchBox`, `Toolbar`, `Banner`, `KeyValueList`, `Modal`, `Toast`, `Tooltip`, `ProgressBar`, `Avatar`, `IconButton`, `Icon` (SVG icon registry ported from the original's ~35 inline icon paths).

`Modal` and `Toast` are portal-rendered from the root layout (a single mount point each), matching the original's single-scrim/single-toast behavior.

### Styling (`src/lib/styles/`)

`tokens.css` (CSS custom properties incl. light/dark via `[data-theme]`, role-accent via `[data-role]`, density via `[data-density]`) and `base.css` (component classes: `.card`, `.tbl`, `.btn`, `.pill`, `.tag`, etc.) ported near-verbatim from the prototype's `<style>` block. Global stylesheets, not Tailwind/CSS-in-JS — preserves exact visual fidelity at lowest risk/effort.

## Data flow

1. App loads → `db.ts` builds the fake dataset once (module-level, deterministic).
2. Root layout checks `auth` store (from storage) → if empty and route isn't `/login`, redirect to `/login`.
3. Login → match `USERS`, set `auth` store, redirect to role's home route.
4. `(app)` layout reads `auth` store's role → builds nav from `NAV` map, renders `Sidebar` + `TopBar` + page `<slot>`.
5. Each placeholder page is just a `Card` inside the shell — no data wiring yet beyond proving the route/role guard works.

## Error handling

- Unauthenticated access to any `(app)` route → redirect to `/login` (client-side guard in `(app)/+layout.ts`, since `ssr=false`).
- Role visiting a page not in their `NAV` → same "not allowed" fallback pattern as the original (simple message card), reused later when detail routes gate by ownership.
- No network calls exist in this sub-project, so no network error handling is needed yet.

## Testing / verification

No automated test suite requested. Manual verification via dev server (and the browser tool) before calling this done:
- All 4 demo accounts (one per role) log in with the shared demo password and land on the correct home route.
- Sidebar nav matches each role's `NAV`/section list; unauthorized routes redirect or show "not allowed".
- Theme toggle (light/dark) updates all CSS custom properties correctly.
- Command palette opens on ⌘K/Ctrl+K and navigates to nav pages.
- Visual comparison against the original prototype for the shell chrome (sidebar, top bar, cards) — should look effectively identical.

## Open items for later sub-projects

- Chart component library (Line/Bar/Scatter/Sparkline/HBar/Meter) — first needed by Outcomes (consultant) and Device detail (engineer).
- Patient/device detail route content and tab structures.
- Kanban board (service tickets), heatmap (patient adherence), event log — each scoped to their owning sub-project.
