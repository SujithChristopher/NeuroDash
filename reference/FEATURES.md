# NeuroDash — Feature Tracker

Living roadmap for the real app. The authoritative product brief is the "NeuroDash — Rehabilitation Therapy Monitoring & Analytics Platform" spec (73 numbered sections, pasted into the build conversation on 2026-09-29) — that document is the source of truth for *what the product should be*; `neurodash_7.html` (primary) and `neurodash-v2 (1).html` (secondary, for extra workflows) are the UI/UX reference implementations it was prototyped as; `neurodash_database_design_2.md` is the schema derived from the prototype. Update this file whenever a feature moves between statuses — it's the source of truth for "is X actually built," not memory.

Status legend: ✅ done · 🟡 partial (works, missing some behavior) · ⬜ not started.

## Visual design & app shell

| Feature | Status | Notes |
|---|---|---|
| Design system (colors, fonts, cards, badges) matching `neurodash_7.html` | ✅ | Tokens, Source Serif 4 / IBM Plex Sans / IBM Plex Mono, `.badge`-style status pills, ported into `src/index.css`. |
| Login page matching `neurodash_7.html` exactly | ✅ | Two-pane layout, logo mark, pitch copy, live stat row (`GET /api/public/stats`), demo-account picker. Real bcrypt auth underneath. |
| Sidebar / topbar app shell (breadcrumb, global search, notifications, user menu) | ✅ | `components/Layout.tsx`. Breadcrumb driven by a small `usePageTitle` store each page sets via `useSetPageTitle`. |
| Global search (patients, devices) | 🟡 | `components/GlobalSearch.tsx`, bound to `/` via the search trigger. Only searches patients + devices so far — spec §59 also wants sessions/assessments/plans in the results. |
| **Overview** landing page (`/`, nav item literally labeled "Overview" for Therapist/Consultant) | ✅ | `pages/Overview.tsx` (was `Today.tsx` — renamed since "Today" wasn't what the prototype's nav calls it, which confused a from-memory comparison against neurodash_7.html). Two stacked sections per explicit instruction: today's schedule + to-do list on top (the v2-derived part, unchanged), then the same program KPI/inflow-chart/status-donut body neurodash_7.html's `renderOverviewTherapist`/`renderOverviewConsultant` show, extracted into `components/ProgramOverviewPanel.tsx` so both this page and the standalone Analytics page render it identically instead of duplicating the JSX. Admin/Engineer redirect straight to `/analytics` (their nav has no link to `/` at all, matching the prototype). |
| Role-specific dashboards (spec §52/53: engineer ops console, admin system overview) | ✅ | Engineer/Admin's dedicated `/analytics` view (`EngineerOverviewPanel` / `ProgramOverviewPanel` with the fleet KPI + audit table), Therapist/Consultant's merged into Overview above — matches `neurodash_7.html`'s four `renderOverview*` variants. |
| Sidebar nav link layout bug | ✅ fixed | Section-grouped nav items (added for the "Insights"/"Records"/"Governance" labels) were wrapped in a `<div>` per section; `.sidebar nav a` had no `display: block`, so it only stacked correctly before by accident (direct flex children get auto-blockified) — nesting broke that and links ran together inline. Fixed with explicit `display: block` on the links plus `display: flex; flex-direction: column` on each section wrapper. |
| **Full per-role nav matching `neurodash_7.html`'s `NAV` config exactly** | ✅ | `lib/navConfig.ts` — same items, same section groupings (e.g. Therapist's "Insights" section: Analytics/Reports/AI Assistant; Engineer's "Records" section: Device History/Notifications), same labels ("My Patients" vs "Patients", "Device Overview" vs "Overview") per role. |

## Auth, roles & permissions

| Feature | Status | Notes |
|---|---|---|
| Login (JWT) | ✅ | `POST /api/auth/login`, `GET /api/auth/me`. |
| Role-based access (THERAPIST/CONSULTANT/ENGINEER/ADMIN) | ✅ | `requireRole` middleware + inline ownership checks (`scopeForUser`, `assertPatientAccess`). |
| **Admin is true view-only for clinical/device records** (spec §5) | ✅ | Fixed 2026-09-29: Admin was previously allowed to create patients/devices via `requireRole(..., "ADMIN")` on several write routes — removed from all of them (patients, plans, devices, device-requests, device-issues). Verified via curl: admin gets 403 on every mutating clinical/device route, 200 on every read route including `/audit-log`. UI shows a "READ ONLY" banner on the patient page for admin (spec §53). User-account management (below) is a deliberate exception — provisioning accounts is an admin/governance action, not a clinical or device one. |
| Assessment creation locked to the assigned therapist | ✅ | Fixed alongside the admin audit — previously had no role check at all. |
| Full RBAC matrix from spec §57 enforced everywhere | 🟡 | Core clinical/device mutations now match the matrix (see above). Not yet audited: patient notes/documents (currently any authenticated user with patient access can add a note — spec doesn't explicitly forbid this, but "Edit clinical data: Consultant limited" suggests it should be scoped more tightly). |
| **Admin creates Therapist/Consultant/Engineer accounts, assigns role** | ✅ | `POST /api/users` (admin only, `pages/UsersPage.tsx` + `CreateUserModal.tsx`). Generates a collision-safe display code (`U-T#`/`U-C#`/`U-E#`) and a random temp password (unambiguous-alphabet, 12 chars), shown once in the response for the admin to relay — never stored in plaintext, never shown again. Creating an ADMIN account via this endpoint is explicitly rejected (400) — matches "provisioned internally" without admin self-service-creating more admins. |
| **First-login forced password reset** | ✅ | `User.mustResetPassword` (migration `add_must_reset_password`). Logging in with a temp/reissued password doesn't return a normal access token — it returns a 15-minute-lived password-reset-purpose JWT (`mustResetPassword: true, resetToken`), which the middleware (`requirePasswordResetToken`) accepts *only* on `POST /api/auth/set-password` and `requireAuth` explicitly rejects everywhere else (verified: using it on `/patients` → 401). Setting a new password there clears the flag and returns a normal token — "that one becomes their password" — verified end-to-end: old temp password stops working immediately after. Frontend: `pages/Login.tsx` swaps into a "choose a new password" form when the login response carries `mustResetPassword`. |
| **Forgot password → admin notification, no real email** | ✅ | `POST /api/auth/forgot-password` (unauthenticated). Deliberate product decision (no SMTP/email service exists in this app): reissues a new temp password and raises an in-app notification to the ADMIN role containing the user's name/email and the new temp password, for the admin to relay manually — this *is* the "share the password to that mail id" step, done in-app rather than over real email. Response is identical whether or not the email exists (no account-enumeration leak). Old password stops working immediately on reissue (verified). |
| Admin can proactively reissue a temp password | ✅ | `POST /api/users/:id/reset-password` (admin only) — same mechanism as forgot-password, for when admin wants to reset someone without waiting for them to ask. |
| User directory (for dropdowns) | ✅ | `GET /api/users?role=` |
| Users page (admin — spec nav) | ✅ | `pages/UsersPage.tsx` — directory + create account + reset password, with a status pill per user ("Active" vs "Password reset pending"). Banner text updated to reflect that this one page is a legitimate admin write-surface, unlike the rest of the dashboard. |

## Locations & multi-site scoping

Added 2026-09-29 per explicit request — not in the original 73-section spec, so tracked as its own section rather than folded into "Auth, roles & permissions".

| Feature | Status | Notes |
|---|---|---|
| Admin manages a location list | ✅ | `Location` model (migration `add_locations`) + `GET/POST/DELETE /api/locations` + `pages/LocationsPage.tsx`. Delete is blocked (409) while staff are still assigned to it. |
| Location assigned at account creation (Therapist/Consultant only) | ✅ | `User.locationId`, required by `POST /api/users` for THERAPIST/CONSULTANT (400 if omitted), left `null` for Engineer/Admin. `CreateUserModal.tsx` shows the location picker only for those two roles. Embedded in the JWT at login (`signAuthToken({..., locationId})`) so every route scopes off the token, not an extra DB lookup per request. |
| **Therapist sees every patient at their location**, not just their own | ✅ | `scopeForUser()` in `patients.routes.ts` changed from `{ therapistId: me }` to `{ therapist: { locationId: me.locationId } }` for THERAPIST — reused by every module that lists/filters patients (sessions, assessments, plans, analytics) so this is one change that propagates everywhere. Verified: a 2nd therapist created at the same location sees the same patient list as the primary. |
| **Consultant is now location-scoped too** (previously program-wide) | ✅ | Same `scopeForUser()` change applies to CONSULTANT — this is a deliberate narrowing from before. Verified: a consultant at Location A sees exactly the same patients as a therapist at Location A, and 0 patients belonging to Location B. |
| Patient header shows the **primary therapist** explicitly | ✅ | Already existed (`patient.therapist.name`) and is now load-bearing UI, not just informational — needed since therapists at a location see patients they don't own. Plan tab adds an explicit "Primary therapist: X" line for the same reason. |
| **Secondary therapist (same location) can edit an existing plan** | ✅ | New `canModifyPlan()` in `plans.routes.ts`: true for the owning therapist, OR any THERAPIST/CONSULTANT whose `locationId` matches the patient's primary therapist's location. Plan *creation* stays owner-only (unchanged) — only editing widened, per the request. New `components/EditPlanModal.tsx` (status/daily-target/sessions/notes, with a **required reason** field — matches the "capture reason for clinically important changes" UX rule) is the first plan-edit UI this app has had; there was none before. |
| **Primary therapist notified when someone else edits their patient's plan** | ✅ | `PATCH /api/plans/:id` calls `notifyUser(patient.therapistId, ...)` when the actor isn't the owner, naming the editor and which fields changed. Verified end-to-end (notification appears in the primary's feed with the secondary's name in the description). |
| **Visible edit history — who changed what** | ✅ | `PlanRevision` already existed in the schema (actor/timestamp/field/previous/new/reason) but had no UI before this — `PatientPlanTab.tsx` now renders it under each plan ("Edit history": who, role, field, old → new, reason, when). This is the same mechanism spec §16 asked for; it just wasn't surfaced until now. |
| Location-scoped patient inflow/outflow analytics | 🟡 | Inflow (registrations) and all program KPIs on `/analytics` and `Overview` are now location-scoped for Therapist/Consultant via the same `scopeForUser()`. There's no separate "outflow" metric anywhere yet (discharge/completion rate over time) — only point-in-time Completed/Discontinued counts. Flagging as a possible follow-up rather than building a guessed-at chart. |
| Device-request/issue scoping | ⬜ | Deliberately left unchanged (still "my own requests", not location-wide) — wasn't part of what was asked; devices don't have a location concept yet either. |

## Patients

| Feature | Status | Notes |
|---|---|---|
| List / detail / register | ✅ | Collision-safe display codes (`lib/displayCode.ts`). |
| Multi-section create form (Patient Info / Rehab Info / Documents — spec §11) | 🟡 | Backend accepts all the fields; the frontend `NewPatientModal` only exposes name/diagnosis/affected side so far — not the full multi-section form (DOB, contact, emergency contact, mobility status, goals, initial observations, document upload at creation time). |
| Patient list search/filters/sort/pagination (spec §10) | ⬜ | List endpoint has no query params yet; frontend renders everything in scope, no table controls. |
| Edit patient fields / change status | ✅ | `PATCH /api/patients/:id`. |
| Notes | ✅ | Add + list, shown in the Notes tab and merged into Timeline. |
| Documents | 🟡 | Metadata-only (name/type/size) — no real file upload/storage backing it (spec §11 wants PDF/DOC/image upload with preview/download). |
| **Patient Profile — header + 9 tabs (spec §12)** | ✅ | Rebuilt 2026-09-29 to match `neurodash_7.html` exactly: header card (avatar, facts row, 6-metric quick-stats row), tab bar with Overview / Assessments / Therapy Plan / Sessions / Devices / Progress / Documents / Notes / Timeline, tab state synced to `?tab=` in the URL. See `pages/PatientDetail.tsx` + `components/patient/*`. |

## Therapy plans

| Feature | Status | Notes |
|---|---|---|
| Create plan with **multiple device types** | ✅ | `POST /api/patients/:id/plans` with `deviceTypeIds: string[]` → `PlanDevice` join rows. `NewPlanModal` multi-select checkboxes. |
| Auto-generated day log on plan creation | ✅ | One `PlanDayLog` row per day of `durationDays`. |
| Update plan / revision history (spec §16) | 🟡 | `PATCH /api/plans/:id` diffs changed fields into `PlanRevision` with actor/timestamp/previous/new. Backend complete; no frontend UI to view revision history or to actually edit a plan's fields yet (Plan tab is read-only display + day-log heatmap). |
| Log a day's actual minutes | 🟡 | Backend endpoint exists (`PATCH /api/plans/:id/day-log/:dayLogId`); no frontend control calls it — day log is a read-only heatmap. |
| Adherence % / completion % rollup (spec §15/17) | ✅ | Computed client-side in `lib/patientStats.ts` from day-log data; shown in patient header, Overview, Plan, and Progress tabs. |
| Plan dashboard visual timeline (done/partial/missed/upcoming day states) | ✅ | `.day-log-grid` heatmap on the Plan tab and Overview. |

## Devices

| Feature | Status | Notes |
|---|---|---|
| Device catalog (types/mechanisms/games) | ✅ | Seeded from the prototype's `DEVICE_TYPES`; extensible by design (games/mechanisms are rows, not enums). |
| Device list / detail (assignments, issues, maintenance, events) | ✅ | Tabbed detail page. |
| Register new device | ✅ | Engineer only (admin removed 2026-09-29). |
| Direct assign to patient | ✅ | Engineer only. |
| Log maintenance | ✅ | Engineer only. Sets device status to Maintenance; no explicit "return to Available" action — has to go through a device-issue clear or manual status change. |
| Device requests (request → clear → assign → decline) | ✅ | Therapist requests, engineer clears/declines/assigns. Full spec §19 workflow. |
| Device issues (open → investigate → resolve → clear, spec §20) | ✅ | Therapist/engineer can open; engineer-only from investigate onward. Troubleshooting log + notifications at each step. |
| Device history / timeline (spec §21) | ✅ | `DeviceEvent` rows, shown on the device detail "Event log" tab. |
| Device analytics / usage comparison (spec §26/28) | 🟡 | `GET /api/devices/usage` + `pages/DeviceUsagePage.tsx` — per-device sessions/hours/avg-accuracy/stars comparison table, sortable by session count. Not yet done: breakdown by game/mechanism within a device (spec §26's "which mechanism was used most" question) — currently only aggregated at the device level. |
| Standalone Maintenance / Device History nav pages (spec nav: engineer "Maintenance", "Device History") | ✅ | `GET /api/devices/maintenance` and `GET /api/devices/events` (fleet-wide, not per-device) + `pages/MaintenancePage.tsx` / `pages/DeviceHistoryPage.tsx`. |

## Sessions & trials

| Feature | Status | Notes |
|---|---|---|
| View sessions per patient, session detail with trials | ✅ | Accuracy computed server-side. |
| **Session detail as a slide-in side drawer, not a full page** | ✅ | Added 2026-09-30 per request. `components/SessionDetailDrawer.tsx` — clicking a session row anywhere (Patient Sessions tab, standalone Sessions list, Patient Overview's "Recent sessions", Overview's "Sessions today") opens it in-place instead of navigating away. The old full-page route (`/patients/:id/sessions/:sessionId`, `pages/SessionDetail.tsx`) still exists for direct links but nothing in the app links to it anymore. |
| **List views decluttered** — accuracy/stars/targets removed from session tables | ✅ | Per request: those columns are gone from `PatientSessionsTab`, `SessionsListPage`, `Overview`'s today list, and `PatientOverviewTab`'s recent-sessions widget. They're still shown in the drawer's per-trial table (that's the "detailed" view) — just not cluttering the list rows. |
| **Session notes, with an optional photo attachment** | ✅ | New `SessionNote` model (migration `add_session_notes`) + `POST /api/sessions/:id/notes` / notes included in `GET /api/sessions/:id`. No object storage configured for this app, so the photo is stored as a base64 data URL directly in the row (capped at ~2MB decoded, validated as an actual image MIME type server-side) rather than standing up S3 for one feature — genuinely stored and rendered back, not just metadata like `PatientDocument`. Location-scoped the same way everything else is (a therapist at a different location gets 404, verified). |
| Cumulative metrics, hit/miss/accuracy calculation (spec §24) | ✅ | Computed server-side (`accuracyPct`), safe against zero-target division. |
| Gamification (stars per trial/session/day, spec §25) | 🟡 | `stars`/`totalStars` stored and seeded with realistic values; no dedicated "stars over time" visualization yet. |
| Manual session/trial entry | ⬜ | Out of scope by design — spec §22/43 defines this as a device-CSV ingestion pipeline, not manual therapist entry. |
| **Device CSV ingestion pipeline** (spec §22, §41–44) | ⬜ | Not started. This is a real, separate subsystem: a staging table, schema validation against the `SessionNumber/DateTime/TrialType/...` CSV contract, patient/device/session identification, duplicate/partial-upload handling, and normalization into `TherapySession`/`SessionTrial` (already snake_case per spec §69 — the CSV-to-DB field mapping, e.g. `CummulativeHits` → `cumulative_hits`, still needs to be written). Currently all session/trial data is seed-generated only. |
| Real-time dashboard updates on new device data (spec §44) | ⬜ | Not started — no websocket/polling-based live update; pages fetch once on mount (notifications bell polls every 30s as the one exception). |

## Assessments

| Feature | Status | Notes |
|---|---|---|
| Extensible assessment system (spec §13/14 — not hard-coded to one type) | ✅ | `AssessmentType` + `AssessmentItemDef` are data, not code; FMA/ARAT/BBS/WMFT seeded, new types can be added without a schema change. |
| Record assessment inside the dashboard (no external form) | ✅ | `NewAssessmentModal`, per-item scoring. |
| Trend chart + comparison (spec §14) | ✅ | Recharts line chart of score % over time; Assessments tab also shows baseline vs. latest vs. change. |
| Therapist-only creation, consultant/admin read-only | ✅ | Enforced 2026-09-29 (see Permissions section above). |
| Standalone Assessments / Therapy Plans / Sessions nav pages (spec nav, all clinical roles) | ✅ | `GET /api/assessments`, `GET /api/plans`, `GET /api/sessions` — program-wide lists scoped to the caller's patients (therapist: own only), each row links back into the relevant Patient Profile tab. `pages/AssessmentsListPage.tsx`, `pages/PlansListPage.tsx`, `pages/SessionsListPage.tsx`. Previously these only existed as per-patient tabs. |

## Reports (spec §33/34)

| Feature | Status | Notes |
|---|---|---|
| Patient report, Device usage report, Patient inflow report | ✅ | `pages/ReportsPage.tsx` — three sub-views: Patient Report (per-patient summary: plan/adherence/sessions/hours/devices/baseline-to-latest assessment change, patient picker), Device Usage Report (reuses `/api/devices/usage`), Patient Inflow Report (reuses the analytics inflow series with the Today/Week/Month/Year toggle). Each has a CSV export button (`lib/csv.ts`, client-side `Blob` download, no backend export endpoint). |

## AI / Chatbot Assistant (spec §36–38)

| Feature | Status | Notes |
|---|---|---|
| Role-aware AI assistant over NeuroDash data | ✅ | `POST /api/ai/ask` (`backend/src/modules/ai/`) + `pages/AiAssistantPage.tsx` chat UI. **Not an LLM integration** — no external AI API key exists in this environment, and the spec's hardest requirement (§37: never fabricate; distinguish observed/calculated/interpreted; say plainly when data isn't available) is easiest to guarantee with a fixed set of intents backed by direct Prisma queries rather than a model that can hallucinate. Handles: patient improvement/baseline-vs-latest (matches the spec §38 example answer shape exactly — baseline/latest/change/adherence/sessions/primary device), most-used device, therapy hours this week, plan adherence/"is patient following the plan", program-wide low-adherence patients, device utilization ranking, and unresolved device issues. Role-scoped identically to the REST API (therapist can only match their own patients) — a query naming a patient outside scope simply won't resolve. Falls back to an honest "I can't answer that" message rather than guessing when no intent matches. If a real LLM is wanted later, this endpoint is the natural place to add tool-calling on top of the same scoped queries. |

## Notifications

| Feature | Status | Notes |
|---|---|---|
| Role-broadcast + per-user notifications | ✅ | Created automatically by the device-request/issue workflows. |
| Bell dropdown, mark-as-read | ✅ | Polls every 30s; click-through deep-links to the relevant page. |
| Mark-all-read | 🟡 | Backend route exists (`POST /api/notifications/read-all`); no button wired in the UI yet. |
| Full notification catalog from spec §39 (missed-target, plan milestones, device disconnect/anomaly, patient-requiring-review) | 🟡 | Device request/issue notifications done; the therapy-adherence and clinical-milestone notification types are not generated anywhere yet (nothing currently watches for a missed day or a milestone). |

## Audit log

| Feature | Status | Notes |
|---|---|---|
| Audit trail for patients/plans/devices/issues/requests/assessments | ✅ | Written by every mutating route via `lib/audit.ts` — actor, role, action, entity, timestamp, previous/new value. |
| Audit log page | ✅ | Admin/Consultant only, unfiltered recent-100 view. |
| Filter by entity | 🟡 | Backend supports `?entityType=&entityId=`; no UI filter controls yet. |
| Login events in the audit trail (spec §40) | ⬜ | Login is currently not audit-logged, only clinical/device mutations are. |

## Analytics / Overview dashboard (spec §8–9, §29, §34–35)

| Feature | Status | Notes |
|---|---|---|
| Executive KPI overview (total/active/new patients, plan counts, session counts, device utilization) | ✅ | `GET /api/analytics/overview?range=` (`backend/src/modules/analytics/`) + `pages/Analytics.tsx`, role-scoped (therapist sees own patients; consultant/admin/engineer see program-wide). Matches `neurodash_7.html`'s four per-role overview layouts: Therapist/Consultant get the patient KPI grid + inflow chart + status donut; Engineer gets the device-ops console (fleet KPIs + utilization-by-type + recent device events); Admin gets both patient and fleet KPIs + recent audit activity, with the READ-ONLY banner. |
| Patient inflow chart with Today/Week/Month/Year toggle | ✅ | `components/InflowChart.tsx` (area chart) + `components/RangeToggle.tsx`, server-computed bucketing in the analytics endpoint. Custom date range (spec §9's fifth option) not implemented — only the four preset ranges. |
| Patient progress dashboard (spec §29) beyond the per-patient Overview/Progress tabs | 🟡 | Per-patient version exists (assessment trend + therapy activity + adherence); there's no cross-patient/program-level progress view. |
| Global analytics filters (date range, patient, therapist, device, game, mechanism, trial type, plan, status — spec §35) | ⬜ | The Analytics page has the date-range toggle only; no patient/therapist/device/game filters yet. |
| Device usage comparison table (spec §28) | ✅ | Moved to its own page — see Devices section: `pages/DeviceUsagePage.tsx` / `GET /api/devices/usage`. |

## Known simplifications (intentional, not bugs)

- UI-facing status columns (`patients.status`, `devices.status`, `device_issues.status`, `device_requests.status`, `plan_day_log.status`) are plain validated `String` columns, not native Postgres enums — see the comment block at the top of `backend/prisma/schema.prisma`.
- No test suite on either side yet.
- Tailwind is listed as a frontend dependency but not wired up; styling is hand-written CSS in `src/index.css`.
- Seed data (`backend/prisma/seed.ts`) regenerates the demo patient's plan/sessions/assessments relative to *today's* date every run, so the Overview charts always have realistic-looking history regardless of when `db:seed` is run.
