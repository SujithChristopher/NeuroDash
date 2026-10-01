# NeuroDash — guide for Claude

Rehabilitation therapy monitoring platform. SvelteKit 2 (Svelte 5, runes) · TypeScript · Prisma 7 · PostgreSQL · Vite 8 · Vitest.
Setup and run instructions are in `README.md`; don't duplicate them here.

## Sources of truth
- `ref/NEURODASH_SVELTEKIT_SPEC.md` — logic, schema, permissions, workflows. When unsure how something should behave, read it first.
- `ref/neurodash_10.html` — the visual reference. `src/lib/styles/app.css` is ported verbatim from it; new UI reuses its classes
  (`.card`, `.kpi`, `.badge`, `.dt`, `.modal`, `.drawer`, `.tabs`…) rather than inventing styles. `responsive.css` layers on top.
- `clinical_scales/neuro/*.json` — the assessment scales. They are **data**: never hard-code a scale's questions in a component.
  Regenerate from `clinical_scales/redcap_bak/*.csv` with `convert_to_json.py`; don't hand-edit the JSON.
- `.claude/skills/clinical-scale-ui` — rules for any scale/assessment UI (click-only, no typed notes). Follow it.

## Commands
```sh
npm run dev            # http://localhost:5173
npm run check          # svelte-check (must be 0 errors)
npm test               # unit tests (src/**/*.test.ts)
TEST_DATABASE_URL="postgresql://…/neurodash_test" npm run test:api   # backend suite (~200 tests)
npm run setup                      # create DB + tables + demo data (scripts/setup.mjs; --reset, --no-seed)
npm run db:migrate | db:seed | db:reset | db:generate
```
- Prisma 7 does **not** seed after `migrate reset` (`db:reset` runs the seed explicitly). Prisma also refuses `migrate reset` when run by an AI
  agent; never work around that with `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` without the user's explicit, quoted consent.
- Always run `npm run check` and `npm test` after changes; run `test:api` after touching anything server-side, auth, permissions or the schema.
- `test:api` refuses any database whose name lacks `test`, builds the app and serves the **production build** (SvelteKit's CSRF check
  and cookie behaviour differ in `vite dev`). Don't test CSRF/cookie behaviour against the dev server.
- Changing `prisma/schema.prisma`: create a migration, run `npx prisma generate`, update `prisma/seed.ts`, and tell the user if
  existing dev databases need `db:reset`.
- There is no `svelte.config.js`; SvelteKit options live in `vite.config.ts`.

## Architecture
- `src/routes/login/` — sign-in, forced first-login reset (`purpose: "password-reset"` session), forgot-password (generic reply, SYSTEM audit row).
- `src/routes/(app)/` — authenticated app. `+layout.server.ts` is the auth guard. Pages are `+page.server.ts` (load + form actions) and
  `+page.svelte`; large pages keep components in a colocated `_components/` folder.
- `src/routes/api/` — JSON/file endpoints: search, notifications, sessions (+notes), documents, AI.
- `src/lib/server/` — server-only: `db`, `auth` (cookie sessions in the `sessions` table), `scope` (location scoping), `guard`,
  `audit`, `notify`, `analytics`, `devices`, `files`, `ai`, `assessments`.
- `src/lib/scales/` — pure scale engine (`expr`, `evaluate`, `describe`, `registry`). Shared by browser, server, seed and tests.
  Uses **relative imports** (the seed runs under `tsx` with no `$lib` alias).
- `src/lib/components/` — shared UI; `scale/` holds the generic click-only scale form.
- `tests/api/` — backend suite; `helpers.ts` has a cookie-jar client that speaks form actions and `pageData()` for server-load data.

## Rules that must not be broken
**Permissions are enforced server-side in every action/endpoint, never only in the UI.**
- Use `requireRole(...)` in page actions/loads (signed-out → redirect) and `requireApiRole(...)` in `+server.ts` endpoints (signed-out → 401).
- **Location scoping:** every patient-linked query uses `patientScopeFor(user)` (`lib/server/scope.ts`). Out-of-scope records return **404, not 403**.
- Roles: **Therapist** creates patients/assessments/plans (primary therapist only); a covering therapist at the same location may *edit* a plan
  and the primary is notified. **Consultant** is read-only except adding patient and session notes. **Engineer** has device operations only
  and no clinical access (sees patient *codes*, never names; search never returns patients to them). **Admin** is view-only for clinical/device
  records, manages users and locations, and is the only role that sees the audit log.
- Call `auditAs(user)(…)` from every mutating action. Notifications go through `notifyRole` / `notifyUser`.
- Display codes come from `lib/server/displayCode.ts` (random candidate with retry). Never use a sequential counter.

**Data handling**
- Never load file bytes into page data: `PatientDocument.data` must be excluded with an explicit `select` (downloads go through
  `/api/documents/[id]`). Uploads are validated by file signature in `lib/server/files.ts` (PDF/PNG/JPEG/GIF/WebP, ≤10 MB), never by name or MIME.
- Prisma `Decimal` isn't serialisable — convert to `Number` in loads. `sessionDate`/plan dates are plain DATE at UTC midnight: compute "today" in UTC.
- `accuracyPct` is always computed server-side, never stored.
- Escape `%`/`_` before using user input in a Prisma `contains` filter (see `api/search`).
- Never log or store a plaintext password; a temp password is shown once to the admin.

**Assessments**
- Scores are **recomputed on the server** from the answers; ignore any score the client sends. Validation rejects unknown ids, computed ids,
  out-of-range values and answers to items hidden by `showIf`. A computed score is `null` until every scored item is answered (REDCap semantics).
- The UI is click-only: no `<input type="text">` or `<textarea>` in scale screens; free-text (`type: "text"`) items are not rendered.

**SvelteKit gotchas**
- `+page.server.ts` / `+server.ts` may only export the framework names (`load`, `actions`, `GET`…). Put shared constants in `$lib`.
- Svelte 5 runes mode is forced. Refs bound with `bind:this` need `$state`. Don't reset bound state in an `$effect` that also runs on mount.
- Canvas charts can't use `var(--x)`; pass CSS-variable colours through `rc()` (`lib/charts/config.ts`). The chart engine can't mix bar and line.

## Conventions
- Match the surrounding code: tabs, single quotes, semicolons; comments explain *why*, not what.
- Reuse `toastEnhance` (`lib/enhance.ts`) for form actions that toast and refresh; `Modal`, `Drawer`, `Badge`, `KpiCard`, `Chart` already exist.
- New pages: add a nav entry in `lib/navConfig.ts` (labels are deliberately different per role) and a row in `tests/api/rbac.test.ts`.
- New permission-sensitive behaviour needs a test in `tests/api/` covering every role, and the out-of-scope (404) case.
- Keep the UI responsive (≤900px drawer nav, ≤640px phone layout in `responsive.css`); check new layouts don't overflow at 360px.

## Known simplifications (deliberate — don't "fix" without asking)
No email service (temp passwords are relayed by the admin); no device CSV ingestion pipeline; no real-time updates (the bell polls every 30 s);
devices have no location; the AI assistant is rules-based, not an LLM; free-text scale items are skipped until clinicians supply preset lists.
`SESSION_SECRET` is in `.env.example` but not read by the app (sessions are random tokens in the database).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
