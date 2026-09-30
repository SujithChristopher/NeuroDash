# NeuroDash — SvelteKit Rebuild Specification

This document is a complete, self-contained blueprint for rebuilding NeuroDash (currently React + Express + Prisma) as a **SvelteKit** application. It is written so that dropping this single file into a brand-new SvelteKit project — and working through it section by section — reproduces every feature, page, permission rule, and database table of the existing app. It reflects the **actual current state** of the working app (pulled directly from its schema and route files), not a plan or aspiration.

**How to use this**: work top to bottom. Section 3 gets a runnable skeleton up. Section 4 is the database — get this exactly right first, since everything else depends on it. Sections 6–9 are the feature build, one domain at a time, in the suggested order (Section 12). Section 5 explains the one significant architectural decision this rebuild makes differently from the original (auth strategy) and why.

---

## 1. What NeuroDash is

A rehabilitation therapy monitoring platform for a clinical/research setting. It connects rehabilitation devices, clinical assessments, therapy plans, patient progress, and device operations into one workspace, with four distinct role-based experiences:

- **Therapist** — manages their own patients day to day: registers patients, records assessments, creates/edits therapy plans, requests devices, reviews sessions.
- **Consultant** — read-heavy clinical oversight with the power to intervene on therapy plans; cannot create/edit assessments.
- **Engineer** — device operations only: issue queue, maintenance, device requests fulfillment. Minimal exposure to clinical data.
- **Admin** — system-wide, **view-only** for all clinical/device records, but the one role that provisions user accounts and manages the location list.

The core workflow the UI is built around:

```
Therapist Login → Register Patient → Assessment → Therapy Plan (multi-device)
  → Device Request → Engineer Clears Device → Device Assigned → Therapy Sessions
  → Session Data + Notes → Progress Review → Reports / Analytics / AI Assistant
```

A second axis cuts across all of this: **locations**. Therapists and consultants are each assigned to one location by the admin. A therapist sees every patient at their location (not just their own) so a colleague can cover for them; a consultant is scoped to their location the same way (not the whole program). Editing a patient's plan is allowed for anyone at that location, but the *primary* therapist is always shown and is notified when someone else edits their patient's plan.

---

## 2. Original tech stack (for reference) vs. this rebuild

| Layer | Original (React) | This rebuild (SvelteKit) |
|---|---|---|
| Frontend framework | React 19 + Vite | **SvelteKit** (Svelte 5) |
| Routing | react-router | SvelteKit file-based routing (`src/routes/`) |
| Server framework | Express 5 (separate process) | **SvelteKit's own server layer** — no separate Express app (see §5) |
| ORM / DB | Prisma 7 + PostgreSQL via `@prisma/adapter-pg` | Same: **Prisma + PostgreSQL**, same adapter |
| Auth | JWT in `localStorage`, sent via Axios interceptor | **Cookie-based session** (see §5 for why this changes) |
| State management | Zustand | Svelte stores (`writable`/`derived`) — much less needed since SvelteKit's `load` functions replace most client-side fetch-on-mount state |
| Charts | Recharts | Any Svelte-friendly charting lib (e.g. `layerchart`, `chart.js` via a thin wrapper, or roll your own with SVG — the charts here are simple: one area chart, one bar+line combo chart, one donut) |
| Styling | Hand-written CSS (`index.css`, CSS custom properties) | Same approach — port the CSS file as-is (see §10), no framework needed |
| Password hashing | bcryptjs | Same: `bcryptjs` (or `bcrypt` if native bindings are acceptable) |
| Validation | Manual `req.body as {...}` casts | Recommend adding **Zod** for form/action validation — SvelteKit's form actions pair naturally with it (optional but strongly recommended, wasn't in the original) |

---

## 3. Project setup

```bash
npm create svelte@latest neurodash-sveltekit
# Choose: Skeleton project, TypeScript, ESLint+Prettier if desired

cd neurodash-sveltekit
npm install

# Database
npm install -D prisma
npm install @prisma/client @prisma/adapter-pg pg
npx prisma init

# Auth
npm install bcryptjs
npm install -D @types/bcryptjs @types/pg

# Recommended additions not in the original
npm install zod
```

Suggested `src/lib/server/` structure (everything that must never ship to the client):

```
src/lib/server/
  db.ts                # Prisma client singleton (adapter-pg)
  auth.ts              # session creation/validation, password hashing helpers
  audit.ts             # logAudit() helper
  notify.ts            # notifyRole() / notifyUser() helpers
  displayCode.ts        # generatePatientDisplayCode / generateDeviceDisplayCode / generateUserDisplayCode
  tempPassword.ts       # generateTempPassword()
src/lib/
  types.ts             # shared TS types/interfaces (mirrors §9's data shapes)
  navConfig.ts          # NAV_BY_ROLE config (§9.3)
  patientStats.ts        # computePatientStats() (§7.3 — pure function, safe to share)
src/hooks.server.ts     # reads the session cookie, populates event.locals.user on every request
src/app.d.ts            # declare App.Locals { user: SessionUser | null }
```

`src/lib/server/db.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '$env/dynamic/private';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });
```

`.env`:

```
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
SESSION_SECRET="a long random string"
```

---

## 4. Database design (Prisma schema)

This is the **exact, current, working schema** — copy it verbatim into `prisma/schema.prisma`. It has been migrated and tested in the original app; no changes are needed for the SvelteKit rebuild except optionally adding a `Session` table for auth (see §5.2).

```prisma
// ============================================================================
// NeuroDash Rehabilitation Platform - Prisma Schema
//
// Status-style columns that contain spaces/punctuation in the UI (patient
// status, device status, issue/request status, day-log status) are kept as
// plain String columns rather than native Postgres enums, validated at the
// API layer — this avoids enum-value/identifier mapping friction while still
// matching the exact strings the UI displays. Enums are used only for values
// that are already valid identifiers (user role, trial type).
// ============================================================================

datasource db {
  provider = "postgresql"
}

generator client {
  provider = "prisma-client-js"
}

// ============================================================================
// USERS & AUTH
// ============================================================================

enum UserRole {
  THERAPIST
  CONSULTANT
  ENGINEER
  ADMIN
}

model User {
  id           String   @id @default(uuid())
  displayCode  String   @unique @map("display_code") // e.g. 'U-T1'
  name         String
  role         UserRole
  title        String?
  email        String   @unique
  initials     String?
  isActive     Boolean  @default(true) @map("is_active")
  passwordHash String   @map("password_hash")
  // Set whenever an admin creates the account (or a forgot-password request
  // reissues one) — forces the temp password to be exchanged for a real one
  // before any protected route accepts the session.
  mustResetPassword Boolean @default(false) @map("must_reset_password")
  // Site assignment — required for THERAPIST/CONSULTANT at creation, unused
  // for ENGINEER/ADMIN. Drives patient visibility: a therapist sees every
  // patient at their location (not just their own), and a consultant is
  // scoped to their location too rather than the whole program.
  locationId   String?  @map("location_id")
  location     Location? @relation(fields: [locationId], references: [id])
  createdAt    DateTime @default(now()) @map("created_at")

  patients              Patient[]           @relation("PatientTherapist")
  assessmentsGiven      Assessment[]        @relation("AssessmentAdministrator")
  plansCreated          TherapyPlan[]       @relation("PlanCreatedBy")
  planRevisions         PlanRevision[]      @relation("PlanRevisionModifiedBy")
  documentsUploaded     PatientDocument[]   @relation("DocumentUploadedBy")
  notesAuthored         PatientNote[]       @relation("NoteAuthor")
  sessionNotesAuthored  SessionNote[]       @relation("SessionNoteAuthor")
  deviceAssignmentsMade DeviceAssignment[]  @relation("AssignmentAssignedBy")
  deviceRequestsMade    DeviceRequest[]     @relation("RequestTherapist")
  deviceRequestsCleared DeviceRequest[]     @relation("RequestEngineer")
  issuesOpened          DeviceIssue[]       @relation("IssueOpenedBy")
  issuesAssigned        DeviceIssue[]       @relation("IssueEngineer")
  issuesVerified        DeviceIssue[]       @relation("IssueVerifiedBy")
  troubleshootingLogs   IssueTroubleshootingLog[] @relation("LogAuthor")
  maintenanceDone       DeviceMaintenance[] @relation("MaintenanceEngineer")
  notifications         Notification[]      @relation("NotificationTargetUser")
  auditLogEntries       AuditLog[]          @relation("AuditActor")

  @@index([role])
  @@map("users")
}

model Location {
  id        String   @id @default(uuid())
  name      String   @unique
  createdAt DateTime @default(now()) @map("created_at")

  users User[]

  @@map("locations")
}

// ============================================================================
// REFERENCE DATA — assessment & device catalogs
// ============================================================================

model AssessmentType {
  id        String   @id // 'FMA','ARAT','BBS','WMFT'
  name      String
  version   String?
  maxScore  Int      @map("max_score")
  domain    String?

  itemDefs    AssessmentItemDef[]
  assessments Assessment[]

  @@map("assessment_types")
}

model AssessmentItemDef {
  id               String         @id @default(uuid())
  assessmentTypeId String         @map("assessment_type_id")
  assessmentType   AssessmentType @relation(fields: [assessmentTypeId], references: [id], onDelete: Cascade)
  label            String
  maxScore         Int            @map("max_score")
  sortOrder        Int            @default(0) @map("sort_order")

  @@map("assessment_item_defs")
}

model DeviceType {
  id          String @id // 'PLUTO','MARS',...
  name        String
  category    String
  colorSeries String? @map("color_series")

  mechanisms     DeviceMechanism[]
  games          DeviceGame[]
  devices        Device[]
  planDevices    PlanDevice[]
  deviceRequests DeviceRequest[]

  @@map("device_types")
}

model DeviceMechanism {
  id            String     @id @default(uuid())
  deviceTypeId  String     @map("device_type_id")
  deviceType    DeviceType @relation(fields: [deviceTypeId], references: [id], onDelete: Cascade)
  mechanismName String     @map("mechanism_name")

  @@map("device_mechanisms")
}

model DeviceGame {
  id           String     @id // 'HAT','PongGame',...
  deviceTypeId String     @map("device_type_id")
  deviceType   DeviceType @relation(fields: [deviceTypeId], references: [id], onDelete: Cascade)
  displayLabel String     @map("display_label")

  trials SessionTrial[]

  @@map("device_games")
}

// ============================================================================
// PATIENTS
// ============================================================================

model Patient {
  id                  String    @id @default(uuid())
  displayCode         String    @unique @map("display_code") // 'P-00124'
  name                String
  dob                 DateTime? @db.Date
  gender              String?
  contactPhone        String?   @map("contact_phone")
  emergencyContact    String?   @map("emergency_contact")
  registrationDate    DateTime  @default(now()) @db.Date @map("registration_date")
  therapistId         String    @map("therapist_id")
  therapist           User      @relation("PatientTherapist", fields: [therapistId], references: [id])
  diagnosis           String?
  affectedSide        String?   @map("affected_side")
  strokeDate          DateTime? @db.Date @map("stroke_date")
  mobilityStatus      String?   @map("mobility_status")
  therapyGoals        String[]  @map("therapy_goals")
  initialObservations String?   @map("initial_observations")
  clinicalInfo        String?   @map("clinical_info")
  status              String    @default("New") // New|Assessment Pending|Active|Paused|Completed|Discontinued
  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt @map("updated_at")

  documents         PatientDocument[]
  notes             PatientNote[]
  assessments       Assessment[]
  therapyPlans      TherapyPlan[]
  therapySessions   TherapySession[]
  deviceAssignments DeviceAssignment[]
  deviceRequests    DeviceRequest[]
  currentDevices    Device[]           @relation("DeviceCurrentPatient")

  @@index([therapistId])
  @@index([status])
  @@index([registrationDate])
  @@map("patients")
}

model PatientDocument {
  id           String   @id @default(uuid())
  patientId    String   @map("patient_id")
  patient      Patient  @relation(fields: [patientId], references: [id], onDelete: Cascade)
  name         String
  docType      String?  @map("doc_type")
  uploadDate   DateTime @default(now()) @map("upload_date")
  uploadedById String?  @map("uploaded_by")
  uploadedBy   User?    @relation("DocumentUploadedBy", fields: [uploadedById], references: [id])
  sizeKb       Int?     @map("size_kb")
  storageRef   String?  @map("storage_ref") // metadata-only in the original — see §11

  @@index([patientId])
  @@map("patient_documents")
}

model PatientNote {
  id        String   @id @default(uuid())
  patientId String   @map("patient_id")
  patient   Patient  @relation(fields: [patientId], references: [id], onDelete: Cascade)
  authorId  String   @map("author_id")
  author    User     @relation("NoteAuthor", fields: [authorId], references: [id])
  noteDate  DateTime @default(now()) @map("note_date")
  text      String

  @@index([patientId, noteDate(sort: Desc)])
  @@map("patient_notes")
}

// ============================================================================
// ASSESSMENTS
// ============================================================================

model Assessment {
  id               String         @id @default(uuid())
  patientId        String         @map("patient_id")
  patient          Patient        @relation(fields: [patientId], references: [id], onDelete: Cascade)
  assessmentTypeId String         @map("assessment_type_id")
  assessmentType   AssessmentType @relation(fields: [assessmentTypeId], references: [id])
  administeredById String?        @map("administered_by")
  administeredBy   User?          @relation("AssessmentAdministrator", fields: [administeredById], references: [id])
  assessmentDate   DateTime       @db.Date @map("assessment_date")
  label            String? // 'Baseline','Day 7','Discharge'
  score            Int
  maxScore         Int            @map("max_score")
  itemScores       Json?          @map("item_scores") // [{label, max, score}, ...]
  notes            String?
  createdAt        DateTime       @default(now()) @map("created_at")

  @@index([patientId, assessmentDate])
  @@index([assessmentTypeId])
  @@map("assessments")
}

// ============================================================================
// THERAPY PLANS
// ============================================================================

model TherapyPlan {
  id                 String   @id @default(uuid())
  patientId          String   @map("patient_id")
  patient            Patient  @relation(fields: [patientId], references: [id], onDelete: Cascade)
  name               String
  startDate          DateTime @db.Date @map("start_date")
  durationDays       Int      @map("duration_days")
  dailyTargetMinutes Int      @map("daily_target_minutes")
  targetSessions     Int?     @map("target_sessions")
  goals              String[]
  notes              String?
  status             String   @default("Active") // Active|Paused|Completed|Discontinued
  createdById        String   @map("created_by")
  createdBy          User     @relation("PlanCreatedBy", fields: [createdById], references: [id])
  createdAt          DateTime @default(now()) @map("created_at")

  devices         PlanDevice[]
  revisions       PlanRevision[]
  dayLog          PlanDayLog[]
  therapySessions TherapySession[]

  @@index([patientId])
  @@index([status])
  @@map("therapy_plans")
}

// A plan may involve more than one device type — deliberately a join table
// (not an array column) so "how many active plans use device X" is a normal
// query, and so the multi-select UI has real rows to create/delete.
model PlanDevice {
  planId       String     @map("plan_id")
  plan         TherapyPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  deviceTypeId String     @map("device_type_id")
  deviceType   DeviceType @relation(fields: [deviceTypeId], references: [id])

  @@id([planId, deviceTypeId])
  @@map("plan_devices")
}

model PlanRevision {
  id             String      @id @default(uuid())
  planId         String      @map("plan_id")
  plan           TherapyPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  fieldChanged   String      @map("field_changed")
  previousValue  String?     @map("previous_value")
  newValue       String?     @map("new_value")
  modifiedById   String      @map("modified_by")
  modifiedBy     User        @relation("PlanRevisionModifiedBy", fields: [modifiedById], references: [id])
  modifiedByRole String      @map("modified_by_role")
  modifiedAt     DateTime    @default(now()) @map("modified_at")
  reason         String?

  @@index([planId, modifiedAt])
  @@map("plan_revisions")
}

model PlanDayLog {
  id            String      @id @default(uuid())
  planId        String      @map("plan_id")
  plan          TherapyPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  dayNumber     Int         @map("day_number")
  logDate       DateTime    @db.Date @map("log_date")
  status        String      @default("upcoming") // done|partial|missed|upcoming
  targetMinutes Int         @map("target_minutes")
  actualMinutes Int         @default(0) @map("actual_minutes")

  therapySessions TherapySession[]

  @@unique([planId, dayNumber])
  @@index([planId, logDate])
  @@map("plan_day_log")
}

// ============================================================================
// DEVICES
// ============================================================================

model Device {
  id               String     @id @default(uuid())
  displayCode      String     @unique @map("display_code") // 'PLUTO-003'
  deviceTypeId     String     @map("device_type_id")
  deviceType       DeviceType @relation(fields: [deviceTypeId], references: [id])
  serialNumber     String     @map("serial_number")
  firmwareVersion  String?    @map("firmware_version")
  status           String     @default("Available") // Available|In Use|Issue Detected|Awaiting Engineer|Maintenance
  location         String?
  registeredOn     DateTime   @default(now()) @db.Date @map("registered_on")
  currentPatientId String?    @map("current_patient_id")
  currentPatient   Patient?   @relation("DeviceCurrentPatient", fields: [currentPatientId], references: [id])
  lastSyncAt       DateTime?  @map("last_sync_at")
  updatedAt        DateTime   @updatedAt @map("updated_at")

  assignments     DeviceAssignment[]
  issues          DeviceIssue[]
  maintenance     DeviceMaintenance[]
  events          DeviceEvent[]
  therapySessions TherapySession[]

  @@index([deviceTypeId])
  @@index([status])
  @@index([currentPatientId])
  @@map("devices")
}

model DeviceAssignment {
  id           String    @id @default(uuid())
  deviceId     String    @map("device_id")
  device       Device    @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  patientId    String    @map("patient_id")
  patient      Patient   @relation(fields: [patientId], references: [id], onDelete: Cascade)
  assignedDate DateTime  @db.Date @map("assigned_date")
  returnedDate DateTime? @db.Date @map("returned_date")
  status       String    @default("In Use") // In Use|Returned
  assignedById String?   @map("assigned_by")
  assignedBy   User?     @relation("AssignmentAssignedBy", fields: [assignedById], references: [id])

  @@index([deviceId])
  @@index([patientId])
  @@map("device_assignments")
}

model DeviceRequest {
  id           String     @id @default(uuid())
  patientId    String     @map("patient_id")
  patient      Patient    @relation(fields: [patientId], references: [id], onDelete: Cascade)
  therapistId  String     @map("therapist_id")
  therapist    User       @relation("RequestTherapist", fields: [therapistId], references: [id])
  deviceTypeId String     @map("device_type_id")
  deviceType   DeviceType @relation(fields: [deviceTypeId], references: [id])
  requestedAt  DateTime   @default(now()) @map("requested_at")
  status       String     @default("Pending Engineer Review") // Pending Engineer Review|Cleared — Ready to Assign|Assigned|Declined
  engineerId   String?    @map("engineer_id")
  engineer     User?      @relation("RequestEngineer", fields: [engineerId], references: [id])
  notes        String?
  clearedAt    DateTime?  @map("cleared_at")

  @@index([status])
  @@index([therapistId])
  @@map("device_requests")
}

model DeviceIssue {
  id            String    @id @default(uuid())
  deviceId      String    @map("device_id")
  device        Device    @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  description   String
  severity      String // Low|Medium|High|Critical
  status        String    @default("Open") // Open|Investigating|Resolved|Cleared
  openedAt      DateTime  @default(now()) @map("opened_at")
  openedById    String    @map("opened_by")
  openedBy      User      @relation("IssueOpenedBy", fields: [openedById], references: [id])
  engineerId    String?   @map("engineer_id")
  engineer      User?     @relation("IssueEngineer", fields: [engineerId], references: [id])
  diagnostics   String?
  partsReplaced String?   @map("parts_replaced")
  resolution    String?
  resolvedAt    DateTime? @map("resolved_at")
  clearedAt     DateTime? @map("cleared_at")
  verifiedById  String?   @map("verified_by")
  verifiedBy    User?     @relation("IssueVerifiedBy", fields: [verifiedById], references: [id])

  troubleshootingLog IssueTroubleshootingLog[]

  @@index([deviceId])
  @@index([status])
  @@index([severity])
  @@map("device_issues")
}

model IssueTroubleshootingLog {
  id         String      @id @default(uuid())
  issueId    String      @map("issue_id")
  issue      DeviceIssue @relation(fields: [issueId], references: [id], onDelete: Cascade)
  loggedAt   DateTime    @default(now()) @map("logged_at")
  loggedById String      @map("logged_by")
  loggedBy   User        @relation("LogAuthor", fields: [loggedById], references: [id])
  note       String

  @@index([issueId, loggedAt])
  @@map("issue_troubleshooting_log")
}

model DeviceMaintenance {
  id              String   @id @default(uuid())
  deviceId        String   @map("device_id")
  device          Device   @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  maintenanceDate DateTime @db.Date @map("maintenance_date")
  maintenanceType String   @map("maintenance_type") // e.g. 'Scheduled Calibration', 'Firmware Update'
  engineerId      String   @map("engineer_id")
  engineer        User     @relation("MaintenanceEngineer", fields: [engineerId], references: [id])
  notes           String?

  @@index([deviceId, maintenanceDate(sort: Desc)])
  @@map("device_maintenance")
}

model DeviceEvent {
  id          String   @id @default(uuid())
  deviceId    String   @map("device_id")
  device      Device   @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  eventDate   DateTime @default(now()) @map("event_date")
  eventType   String   @map("event_type") // registered|assigned|maintenance|issue|investigating|resolved|cleared
  description String

  @@index([deviceId, eventDate(sort: Desc)])
  @@map("device_events")
}

// ============================================================================
// SESSIONS & TRIALS (device CSV ingestion would land here — see §11)
// ============================================================================

model TherapySession {
  id              String       @id @default(uuid())
  patientId       String       @map("patient_id")
  patient         Patient      @relation(fields: [patientId], references: [id], onDelete: Cascade)
  planId          String?      @map("plan_id")
  plan            TherapyPlan? @relation(fields: [planId], references: [id], onDelete: SetNull)
  planDayLogId    String?      @map("plan_day_log_id")
  planDayLog      PlanDayLog?  @relation(fields: [planDayLogId], references: [id], onDelete: SetNull)
  deviceId        String       @map("device_id")
  device          Device       @relation(fields: [deviceId], references: [id])
  sessionNumber   Int?         @map("session_number")
  sessionDate     DateTime     @db.Date @map("session_date")
  startTime       DateTime     @map("start_time")
  endTime         DateTime?    @map("end_time")
  durationMinutes Decimal?     @map("duration_minutes") @db.Decimal(6, 2)
  totalTargets    Int          @default(0) @map("total_targets")
  totalHits       Int          @default(0) @map("total_hits")
  totalMisses     Int          @default(0) @map("total_misses")
  totalStars      Int          @default(0) @map("total_stars")

  trials SessionTrial[]
  notes  SessionNote[]

  @@index([patientId, sessionDate])
  @@index([deviceId, sessionDate])
  @@index([planId])
  @@map("therapy_sessions")
}

// Clinical notes attached to a specific therapy session, with an optional
// photo. No object storage is used — the image is stored as a base64 data
// URL directly in the row (capped ~2MB decoded, validated as a real image
// MIME type at the API layer). Fine at this feature's scale; avoids standing
// up S3/blob infra for one feature.
model SessionNote {
  id           String         @id @default(uuid())
  sessionId    String         @map("session_id")
  session      TherapySession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  authorId     String         @map("author_id")
  author       User           @relation("SessionNoteAuthor", fields: [authorId], references: [id])
  text         String
  imageDataUrl String?        @map("image_data_url")
  createdAt    DateTime       @default(now()) @map("created_at")

  @@index([sessionId, createdAt])
  @@map("session_notes")
}

enum TrialType {
  GAME
  AROM
  PROM
  APROM
}

model SessionTrial {
  id                 String         @id @default(uuid())
  sessionId          String         @map("session_id")
  session            TherapySession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  trialNumberSession Int            @map("trial_number_session")
  trialNumberDay     Int?           @map("trial_number_day")
  trialType          TrialType      @map("trial_type")
  gameId             String?        @map("game_id")
  game               DeviceGame?    @relation(fields: [gameId], references: [id])
  mechanism          String?
  targets            Int
  hits               Int
  misses             Int
  stars              Int            @default(0)
  startTime          DateTime?      @map("start_time")
  stopTime           DateTime?      @map("stop_time")
  cumulativeTargets  Int?           @map("cumulative_targets")
  cumulativeHits     Int?           @map("cumulative_hits")
  cumulativeMisses   Int?           @map("cumulative_misses")
  cumulativeStars    Int?           @map("cumulative_stars")
  rawDataRef         String?        @map("raw_data_ref")

  @@index([sessionId, trialNumberSession])
  @@map("session_trials")
}

// ============================================================================
// NOTIFICATIONS & AUDIT
// ============================================================================

model Notification {
  id           String    @id @default(uuid())
  targetRole   UserRole? @map("target_role")           // role-broadcast target
  targetUserId String?   @map("target_user_id")         // specific-user target; null = broadcast to targetRole
  targetUser   User?     @relation("NotificationTargetUser", fields: [targetUserId], references: [id])
  notifType    String    @map("notif_type") // device|plan|issue|request|system|...
  tone         String    @default("info") // good|info|warning|critical|neutral
  icon         String?
  title        String
  description  String
  createdAt    DateTime  @default(now()) @map("created_at")
  isRead       Boolean   @default(false) @map("is_read")
  link         Json?     // {"page": "device-issues"} style deep link (used as `/${page}`)

  @@index([targetUserId, isRead])
  @@index([targetRole, isRead])
  @@index([createdAt(sort: Desc)])
  @@map("notifications")
}

model AuditLog {
  id            String   @id @default(uuid())
  actorUserId   String?  @map("actor_user_id")
  actorUser     User?    @relation("AuditActor", fields: [actorUserId], references: [id])
  actorRole     String   @map("actor_role") // includes "SYSTEM" for unauthenticated actions like forgot-password
  action        String // 'Plan Created','Issue Resolved','Device Cleared',...
  entityType    String   @map("entity_type") // 'Patient'|'Therapy Plan'|'Device'|'Device Issue'|'User'|'Location'|...
  entityId      String   @map("entity_id")
  occurredAt    DateTime @default(now()) @map("occurred_at")
  previousValue Json?    @map("previous_value")
  newValue      Json?    @map("new_value")
  notes         String?

  @@index([entityType, entityId])
  @@index([actorUserId, occurredAt(sort: Desc)])
  @@index([occurredAt(sort: Desc)])
  @@map("audit_log")
}
```

### 4.1 Reference-data seed (required before anything else works)

Seed these before any UI page will render meaningfully:

- **`AssessmentType`** + **`AssessmentItemDef`** rows for: `FMA` (Fugl-Meyer, max 66: Shoulder/Elbow/Forearm 36, Wrist 10, Hand 14, Coordination & Speed 6), `ARAT` (max 57: Grasp 18, Grip 12, Pinch 18, Gross Movement 9), `BBS` (Berg Balance, max 56: Sitting Balance 12, Standing Balance 20, Transfers 12, Reaching/Turning 12), `WMFT` (max 75: Proximal Tasks 30, Distal Tasks 30, Functional Grip 15).
- **`DeviceType`** + **`DeviceMechanism`** + **`DeviceGame`** rows for 6 device types: `PLUTO` (Pluto, Hand & Wrist Rehabilitation Robot; mechanisms: Wrist Flexion/Extension, Forearm Pronation/Supination, Grip Cylindrical; games: `HAT`="HAT — Hand Trainer Arcade", `FruitBasket`="Fruit Basket"), `MARS` (Mars, Arm Reaching Robot; Shoulder Flexion, Elbow Extension, Reach & Grasp; games `PongGame`, `TukTuk`="TukTuk Drive"), `ORION` (Orion, Grip & Pinch Trainer; Grip Cylindrical, Grip Pinch, Finger Extension; games `RNR`="RNR — Reach & Retrieve", `HatRick`="HatRick Precision"), `VEGA` (Vega, Balance & Lower Limb Trainer; Weight Shift, Ankle Dorsiflexion, Sit-to-Stand; no games), `COSMOS` (Cosmos, Fine Motor Game Station; Precision Reach, Bimanual Coordination; no games), `ATLAS` (Atlas, Shoulder & Scapular Robot; Shoulder Abduction, Scapular Stabilization; no games).
- At least one **`Location`** and one **`User`** per role (see §12 for a full seed recipe with demo credentials).

---

## 5. Auth & session architecture

### 5.1 What changes from the original, and why

The original app uses a JWT stored in `localStorage`, attached manually via an Axios request interceptor, because it's a React SPA talking to a separate Express API. **SvelteKit doesn't need this pattern** — it has first-class server-side rendering with `load` functions and form actions that run on the server, where a plain HTTP-only session cookie is simpler, more secure (no token sitting in `localStorage`, immune to XSS token theft), and more idiomatic. This is the one deliberate architectural deviation in this rebuild.

Everything else — the permission model, the forced-password-reset flow, the forgot-password flow, the admin-provisioning model — is preserved exactly, just re-plumbed onto cookies instead of bearer tokens.

### 5.2 Session table (new — not in the original schema)

Add this to `schema.prisma` (the original used stateless JWTs; a cookie-session approach needs somewhere to store sessions so they can be revoked):

```prisma
model Session {
  id        String   @id // random token, this IS the cookie value
  userId    String   @map("user_id")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  // Mirrors the JWT's "purpose" claim from the original: a password-reset
  // session is only ever valid for finishing the reset, nothing else.
  purpose   String   @default("access") // "access" | "password-reset"
  expiresAt DateTime @map("expires_at")
  createdAt DateTime @default(now()) @map("created_at")

  @@index([userId])
  @@map("sessions")
}
```

Add the back-relation `sessions Session[]` to `User`.

### 5.3 `src/lib/server/auth.ts`

```ts
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from './db';

const ACCESS_SESSION_HOURS = 12;   // mirrors the original JWT's 12h expiry
const RESET_SESSION_MINUTES = 15;  // mirrors the original reset-token's 15m expiry

export async function createSession(userId: string, purpose: 'access' | 'password-reset' = 'access') {
  const id = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + (purpose === 'access' ? ACCESS_SESSION_HOURS * 3600_000 : RESET_SESSION_MINUTES * 60_000));
  await prisma.session.create({ data: { id, userId, purpose, expiresAt } });
  return { id, expiresAt };
}

export async function getSession(sessionId: string | undefined) {
  if (!sessionId) return null;
  const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { user: { include: { location: true } } } });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;
  return session;
}

export async function destroySession(sessionId: string) {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
}

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}
export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}
```

### 5.4 `src/hooks.server.ts` — populate `event.locals.user` on every request

```ts
import type { Handle } from '@sveltejs/kit';
import { getSession } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
  const sessionId = event.cookies.get('session');
  const session = await getSession(sessionId);

  if (session && session.purpose === 'access') {
    event.locals.user = {
      id: session.user.id,
      displayCode: session.user.displayCode,
      name: session.user.name,
      role: session.user.role,
      title: session.user.title,
      email: session.user.email,
      initials: session.user.initials,
      locationId: session.user.locationId,
      location: session.user.location ? { id: session.user.location.id, name: session.user.location.name } : null,
    };
  } else {
    event.locals.user = null;
  }

  return resolve(event);
};
```

`src/app.d.ts`:

```ts
declare global {
  namespace App {
    interface Locals {
      user: {
        id: string; displayCode: string; name: string;
        role: 'THERAPIST' | 'CONSULTANT' | 'ENGINEER' | 'ADMIN';
        title: string | null; email: string; initials: string | null;
        locationId: string | null; location: { id: string; name: string } | null;
      } | null;
    }
  }
}
export {};
```

### 5.5 Route protection

Use a layout server load at the app-shell boundary (mirrors the original's `<RequireAuth>` wrapper):

`src/routes/(app)/+layout.server.ts`:

```ts
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
  if (!locals.user) throw redirect(302, '/login');
  return { user: locals.user };
};
```

Put every authenticated page under a `(app)` route group with a shared `+layout.svelte` that renders the sidebar/topbar (§9.2) and an `<slot />`. `/login` sits outside that group.

For role-gated actions inside a `+page.server.ts` or `+server.ts`, check `locals.user.role` directly — there's no middleware chain like Express's `requireRole(...)`, just an `if` at the top of the `load`/`action`/handler that throws `error(403, ...)`.

### 5.6 Auth flows (feature-complete list — see §6.1 for the full permission rationale)

| Flow | Original endpoint | SvelteKit equivalent |
|---|---|---|
| Login | `POST /api/auth/login` | `+page.server.ts` **form action** on `/login`: verify email+password; if `mustResetPassword`, create a `purpose: "password-reset"` session, set it as the cookie, return `{ mustResetPassword: true }` so the page swaps to the reset form; else create a normal `access` session, set cookie, redirect to `/`. |
| Set new password (first login) | `POST /api/auth/set-password` | A second form action on `/login` (or a dedicated `/reset-password` route), gated by checking `event.cookies.get('session')` resolves to a `purpose: "password-reset"` session — hash the new password, clear `mustResetPassword`, destroy the reset session, create a fresh `access` session. |
| Forgot password | `POST /api/auth/forgot-password` | Form action, unauthenticated: generate a new temp password (`generateTempPassword()`), hash it, set `mustResetPassword: true`, `notifyRole('ADMIN', ...)` with the temp password in the description (no email service — see §11), write an `AuditLog` row with `actorRole: 'SYSTEM'`. **Always return the same generic message** regardless of whether the email exists — no account-enumeration leak. |
| Logout | (client-side token clear) | Form action or `+server.ts` `POST`: `destroySession(cookieValue)`, `cookies.delete('session')`, redirect to `/login`. |
| Get current user | `GET /api/auth/me` | Just read `locals.user` — no endpoint needed, it's already on every `load`. |

Demo/seed password for every seeded account: `neurodash123` (see §12).

---

## 6. Roles & permissions (the RBAC matrix — implement this exactly)

### 6.1 The rule that matters most: **Admin is view-only**

Admin can see everything (every patient regardless of location, every device, every session, the full audit log) but must be blocked at the **server** layer — not just hidden in the UI — from every clinical/device mutation:

- Cannot create patients, plans, assessments, devices, device requests, or device issues.
- Cannot clear/resolve device issues, cannot assign devices, cannot log maintenance.
- **Exception**: Admin *does* manage user accounts (§8.2) and the location list (§8.1) — that's an admin/governance action, not a clinical/device one.

Show a `READ ONLY` banner on pages where this matters (patient detail, the admin Analytics/Overview page).

### 6.2 Full matrix

| Action | Therapist | Consultant | Engineer | Admin |
|---|---|---|---|---|
| View patients | Own location | Own location | — | All |
| Create patient | ✓ (becomes primary therapist) | ✗ | ✗ | ✗ |
| Edit patient status/fields | Primary therapist or Consultant (same location) | ✓ (same location) | ✗ | ✗ |
| Add patient note | Any authenticated user with patient access | same | same | same (not tightened further — see §13 known gaps) |
| Create assessment | **Primary therapist only** | ✗ | ✗ | ✗ |
| View assessments | Own location | Own location | ✗ | All |
| Create therapy plan | **Primary therapist only** | ✗ | ✗ | ✗ |
| **Edit** an existing therapy plan | Primary therapist, **or any Therapist/Consultant at the same location** ("secondary therapist covering") | same | ✗ | ✗ |
| Request a device | ✓ | ✗ | ✗ | ✗ |
| Clear / decline / assign a device request | ✗ | ✗ | ✓ | ✗ |
| Register a device | ✗ | ✗ | ✓ | ✗ |
| Assign a device directly | ✗ | ✗ | ✓ | ✗ |
| Log device maintenance | ✗ | ✗ | ✓ | ✗ |
| Report a device issue | ✓ | ✗ | ✓ | ✗ |
| Investigate / resolve / clear a device issue | ✗ | ✗ | ✓ | ✗ |
| View device usage/maintenance/history | ✓ | ✓ | ✓ | ✓ |
| View analytics/inflow | **Own location** | **Own location** | Fleet-wide (not location-scoped — devices have no location concept) | All |
| View audit log | ✗ | ✓ | ✗ | ✓ |
| Create/manage user accounts | ✗ | ✗ | ✗ | ✓ (Therapist/Consultant/Engineer only — never another Admin) |
| Manage locations | ✗ | ✗ | ✗ | ✓ |
| Use AI Assistant | ✓ | ✓ | ✓ (device-scoped answers) | ✓ |

### 6.3 Location scoping — the one shared helper everything else reuses

This is the single most important function in the whole backend. In the original it's `scopeForUser()` in `patients.routes.ts`, reused by patients, sessions, assessments, plans, and analytics. Reproduce it as a shared server helper:

```ts
// src/lib/server/scope.ts
import type { Prisma } from '@prisma/client';

export function patientScopeFor(user: App.Locals['user']): Prisma.PatientWhereInput {
  if (!user) return { id: 'never-matches' }; // shouldn't be reachable — route is already auth-gated
  if (user.role === 'THERAPIST' || user.role === 'CONSULTANT') {
    return { therapist: { locationId: user.locationId ?? null } };
  }
  return {}; // ENGINEER/ADMIN: unrestricted
}
```

Use `patient: patientScopeFor(locals.user)` (nested) or `patientScopeFor(locals.user)` (direct on `prisma.patient.findMany`) everywhere a list of patients or patient-linked records needs scoping. This one function is what makes "therapist sees every patient at their location" and "consultant is location-scoped too" true everywhere at once.

**Plan-edit permission** (`canModifyPlan`) is a second, closely related helper:

```ts
function isOwnerTherapist(user: App.Locals['user'], therapistId: string) {
  return user?.role === 'THERAPIST' && user.id === therapistId;
}
function canModifyPlan(user: App.Locals['user'], patientTherapist: { id: string; locationId: string | null }) {
  if (isOwnerTherapist(user, patientTherapist.id)) return true;
  if (user?.role !== 'THERAPIST' && user?.role !== 'CONSULTANT') return false;
  return user.locationId != null && user.locationId === patientTherapist.locationId;
}
```

Plan **creation** stays owner-only (`isOwnerTherapist`); plan **editing** uses the wider `canModifyPlan`. When a non-owner edits, notify the owner:

```ts
if (!isOwnerTherapist(locals.user, patient.therapist.id)) {
  await notifyUser(patient.therapist.id, {
    notifType: 'plan', tone: 'info', icon: 'edit',
    title: "Your patient's plan was edited by another therapist",
    description: `${actorName} (${locals.user.role.toLowerCase()}) edited the therapy plan for ${patient.name}: ${changedFields.join(', ')}.`,
    link: { page: `patients/${patient.id}?tab=plan` },
  });
}
```

Every plan edit writes a `PlanRevision` row (field/previous/new/who/role/reason) — this is the "who edited what" history shown in the UI (§7.4), and the UI **requires a non-empty `reason`** on every edit (a clinical-UX rule: never let an important change go unexplained).

---

## 7. Feature-by-feature build guide

For each domain below: the data model (already in §4), the server-side operations needed (as SvelteKit `load`/actions/`+server.ts` — adapt freely, this isn't prescribing exact file names), and the UI it powers.

### 7.1 Patients

- **List** (`/patients`): scoped by `patientScopeFor`. Columns: name, ID, diagnosis, therapist, status. Therapist sees "My Patients" as the nav label; everyone else sees "Patients".
- **Create**: therapist-only. Fields: name (required), dob, gender, contact phone, emergency contact, diagnosis, affected side, stroke date, mobility status, therapy goals (array), initial observations, clinical info. Generates a **collision-safe display code** (`P-#####`, random-candidate-with-retry — see §7.9) rather than a sequential counter. New patient starts at status `Assessment Pending`.
- **Detail** (`/patients/[id]`): a header card (avatar, name+ID, age/gender/diagnosis/affected-side line, editable status dropdown for those with `canManage`, "Add Note"/"+ New Assessment" buttons for the primary therapist) followed by **6 quick-metric tiles** (therapy days completed, total therapy time, sessions completed, devices used, avg accuracy, plan adherence) and **5 fact fields** (therapist, current plan, therapy day X/Y, overall progress %, registered date). Below that, a **9-tab interface**:
  1. **Overview** — assessment trend chart + therapy activity chart (left column, 2fr), plan snapshot card + recent-sessions card (right column, 1fr).
  2. **Assessments** — baseline/latest/change stat row, trend chart, full table.
  3. **Therapy Plan** — see §7.4.
  4. **Sessions** — see §7.5.
  5. **Devices** — device assignments table + device requests table for this patient, "Request device" button (therapist).
  6. **Progress** — same charts as Overview but with a 7/14/full-plan range toggle.
  7. **Documents** — upload form (metadata only, §11) + table.
  8. **Notes** — list + add-note form.
  9. **Timeline** — a client-merged, date-sorted feed built from sessions + assessments + notes + documents + plan-created events (no dedicated table — just combine what's already fetched and sort).
  Tab selection is a `?tab=` query param, not separate routes, so it round-trips on refresh/share.
- **`computePatientStats()`** (pure function, port verbatim — this is the single source of truth for every stat shown across the app):

```ts
// src/lib/patientStats.ts
export function computePatientStats(patient: { therapyPlans: TherapyPlan[] }, sessions: TherapySession[]) {
  const plan = patient.therapyPlans.find(p => p.status === 'Active') ?? patient.therapyPlans[0];
  const dayLog = plan?.dayLog ?? [];
  const elapsedDays = dayLog.filter(d => d.status !== 'upcoming');
  const completedDays = dayLog.filter(d => d.status === 'done').length;
  const currentDay = elapsedDays.length;
  const completionPct = plan ? Math.round((currentDay / plan.durationDays) * 100) : 0;
  const targetSum = elapsedDays.reduce((s, d) => s + d.targetMinutes, 0);
  const actualSum = elapsedDays.reduce((s, d) => s + d.actualMinutes, 0);
  const adherence = targetSum > 0 ? Math.round((actualSum / targetSum) * 100) : 0;
  const totalMin = sessions.reduce((s, x) => s + (Number(x.durationMinutes) || 0), 0);
  const devicesUsed = [...new Set(sessions.map(s => s.device.displayCode))];
  const avgAccuracy = sessions.length > 0
    ? Math.round((sessions.reduce((s, x) => s + (x.accuracyPct ?? 0), 0) / sessions.length) * 10) / 10
    : 0;
  return { plan, currentDay, completedDays, completionPct, adherence, totalMin, sessionsCount: sessions.length, devicesUsed, avgAccuracy };
}
```

### 7.2 Assessments

- Extensible by design: `AssessmentType` + `AssessmentItemDef` are **data, not code** — adding a 5th assessment type is a seed insert, not a schema change or a new form component. The item-scoring form should render dynamically from `itemDefs`.
- Create: primary-therapist-only. Body: `assessmentTypeId`, `assessmentDate`, `label` (e.g. "Baseline", "Day 7"), `itemScores: [{label, max, score}]`, `notes`. Server computes `score` as the sum of item scores, `maxScore` from the type. If patient status was `Assessment Pending`, flip it to `Active`.
- Trend chart: score-as-percentage over time, needs ≥2 assessments to render (else empty state).
- Standalone `/assessments` list page: every assessment across the caller's scoped patients, links back into `patients/[id]?tab=assessments`.

### 7.3 Therapy plans

- **Create** (owner-therapist only): name, start date, duration (days), daily target (minutes), target sessions, goals, notes, **`deviceTypeIds: string[]`** (multi-select — creates one `PlanDevice` row per selection). On create, also generate one `PlanDayLog` row per day of the plan (`status: 'upcoming'`, `targetMinutes` = the daily target). If the patient was `Assessment Pending`/`New`, flip to `Active`.
- **Edit** (owner OR any Therapist/Consultant at the same location — §6.3): status, daily target, target sessions, notes, plus a **required `reason`** string. Diffs every changed field into a `PlanRevision` row. Notifies the primary therapist if the editor isn't them.
- **Day log**: a visual heatmap of day cells (`done`/`partial`/`missed`/`upcoming` — 4 distinct colors), one cell per day. `PATCH` endpoint to log actual minutes for one day exists in the original but has no UI control wired to it yet (§13) — worth adding here if you want it complete.
- **Revision history**: render every `PlanRevision` under the plan — who (name + role), what field, previous → new value, the reason, and when. This is the "visibly see who edited" requirement.
- Standalone `/plans` list page, same scoping pattern as assessments.

### 7.4 Devices

- **Catalog**: `DeviceType`/`DeviceMechanism`/`DeviceGame` — read-only reference data (§4.1).
- **List/detail**: status enum as a plain string (`Available`/`In Use`/`Issue Detected`/`Awaiting Engineer`/`Maintenance`). Detail page has tabs: assignments, issues (with an inline troubleshooting-log + investigate/resolve/clear actions for engineers), maintenance (+ a "log maintenance" form for engineers), event log (last 30 events).
- **Register** (engineer-only): device type, serial number, firmware version, location string. Generates a collision-safe display code (`{TYPE}-###`, e.g. `PLUTO-004`). Writes a `registered` `DeviceEvent`.
- **Direct assign** (engineer-only): sets `status: 'In Use'`, `currentPatientId`, creates a `DeviceAssignment` + `assigned` event.
- **Device request workflow** (a separate flow from direct-assign, for when a therapist needs a device type rather than a specific unit):
  ```
  Therapist requests a device type for a patient
    → status: "Pending Engineer Review"  (notifies role ENGINEER)
    → Engineer clears it → status: "Cleared — Ready to Assign"  (notifies the requesting therapist)
    → Engineer picks a specific available device of that type → status: "Assigned"
       (creates the DeviceAssignment, same as direct-assign)
  Engineer can also decline a request → status: "Declined"
  ```
  A therapist can never assign a device that hasn't been cleared — enforce this by only ever creating the `DeviceAssignment` from the clear/assign engineer action, never from anything a therapist calls.
- **Device issue workflow**:
  ```
  Therapist or Engineer reports an issue (description, severity Low/Medium/High/Critical)
    → status: "Open", device.status → "Issue Detected"  (notifies role ENGINEER, tone critical if High/Critical)
    → Engineer starts investigating → status: "Investigating" (+ auto troubleshooting-log entry "Investigation started.")
    → Engineer can append more troubleshooting-log notes at any time
    → Engineer resolves (resolution text, optional parts replaced) → status: "Resolved"
    → Engineer (or Consultant, for verification) clears → status: "Cleared", device.status → "Available"
       (notifies whoever originally opened the issue)
  ```
- **Standalone pages**: `/maintenance` (all maintenance records, fleet-wide), `/device-history` (all device events, fleet-wide), `/device-usage` (per-device comparison table: sessions count, total minutes, avg accuracy, total stars — computed via a `groupBy` on `TherapySession.deviceId`).

### 7.5 Sessions & trials, with the side-drawer detail + notes

- Session list views (patient tab, standalone `/sessions` page, "recent sessions" widgets) show only **date, device, duration** — deliberately no accuracy/stars/targets clutter in the list.
- Clicking a session row opens a **slide-in side drawer** (not a route navigation) fetching the full session: device, duration, the **full trial table** (this is where targets/hits/stars/accuracy belong — the "detailed" view), and a **notes section**.
- **Session notes**: text + an optional photo. No object storage — the photo is a base64 data URL, capped ~2MB decoded, validated server-side as an actual image MIME type (`png`/`jpeg`/`jpg`/`gif`/`webp`) before insert. Compose UI: textarea + a hidden `<input type="file" accept="image/*">` triggered by a button, read via `FileReader.readAsDataURL`, shown as a removable preview thumbnail before posting.
- `accuracyPct` is **always computed server-side**, never stored: `totalTargets > 0 ? round(totalHits / totalTargets * 100, 2) : null` — apply this consistently everywhere a session is returned.
- The `/sessions/today` concept (used by the Overview page, §9.1) needs its date-boundary computed in **UTC**, not server-local time — `sessionDate` is a plain `DATE` column with no timezone, always stored at UTC midnight; computing "today" with local-timezone hours on a non-UTC server will roll sessions onto the wrong calendar day. Always do:
  ```ts
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const endOfDay = new Date(startOfDay); endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);
  ```

### 7.6 Notifications

- Two shapes: **role-broadcast** (`targetRole` set, `targetUserId` null — everyone with that role sees it) and **per-user** (`targetUserId` set). A bell icon in the topbar (polls every ~30s) plus a full `/notifications` page. Clicking marks it read and follows `link.page` (a string like `device-issues` or `patients/abc-123?tab=plan` — resolve it as `` `/${page}` `` directly, don't require an exact-match dictionary).
- `notifyRole(role, {...})` / `notifyUser(userId, {...})` are the two helpers every other domain calls into — implement these first since almost every workflow above depends on them.

### 7.7 Audit log

- `logAudit({ actorUserId, actorRole, action, entityType, entityId, previousValue?, newValue?, notes? })` — call this from **every** mutating action across every domain. Admin and Consultant can view `/audit-log` (recent 100, newest first); nobody else can.

### 7.8 Analytics / Overview

- **`/analytics`**: role-adaptive. Therapist/Consultant get a patient-KPI grid (total/active/new-30d patients, active plans, therapy hours, total sessions, assessments completed) + a patient-inflow area chart (Today/Week/Month/Year toggle, server-bucketed) + a patient-status donut. Engineer gets a device-ops console instead (fleet KPIs, open-issues count, utilization-by-device-type bars, recent device events). Admin gets both patient and fleet KPIs plus a recent-audit-activity table, with the `READ ONLY` banner.
- **`/` (Overview, the landing page)**: for Therapist/Consultant only (Engineer/Admin redirect straight to `/analytics`, since their nav has no home concept). Two stacked sections: **today's schedule + a to-do list** (sessions logged today; to-do built from real signals — patients still `Assessment Pending`, unread actionable notifications — not a synthetic scheduling engine) **on top**, then the **same KPI/chart body** as `/analytics` below it. Extract that body into one shared component so both pages render identically instead of duplicating markup.
- Inflow bucketing (`today`→last 1 day, `week`→7, `month`→30, `year`→12 months) is computed server-side from `registrationDate`, grouped into calendar-day (or month, for the year range) buckets in UTC.

### 7.9 Users & Locations (admin-only management)

- **Locations**: `Location { id, name }`. Admin CRUD (create, list with a staff-count, delete — **block delete while any user is still assigned to it**, 409).
- **Create user** (admin-only, never creates another Admin): name, email, role (Therapist/Consultant/Engineer), title, and **`locationId` — required for Therapist/Consultant, omitted for Engineer**. Generates:
  - A collision-safe **display code** (`U-T#`/`U-C#`/`U-E#`/`U-A#` by role — random-candidate-with-retry, same pattern as patient/device codes, specifically to avoid a sequential-counter collision bug):
    ```ts
    async function generateUserDisplayCode(role: string) {
      const prefix = { THERAPIST: 'U-T', CONSULTANT: 'U-C', ENGINEER: 'U-E', ADMIN: 'U-A' }[role] ?? 'U-X';
      for (let i = 0; i < 10; i++) {
        const candidate = `${prefix}${Math.floor(10 + Math.random() * 90)}`;
        if (!(await prisma.user.findUnique({ where: { displayCode: candidate } }))) return candidate;
      }
      throw new Error('Could not generate a unique display code');
    }
    ```
  - A **random temp password** (unambiguous alphabet — no `0/O/1/I/l` — since a human relays it verbally/by chat):
    ```ts
    const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    function generateTempPassword(length = 12) {
      return Array.from({ length }, () => ALPHABET[crypto.randomInt(0, ALPHABET.length)]).join('');
    }
    ```
  Returns the temp password **once**, in the create response only — never stored in plaintext, never retrievable again. `mustResetPassword: true` on the new row.
- **Reset password** (admin-only, for an existing user): same temp-password mechanism as forgot-password, callable proactively without the user asking.
- `/users` page: directory (name, role, location, title, email, a status pill showing "Active" vs "Password reset pending") + "+ Create account" + a per-row "Reset password" button. This is the one admin page that is **not** read-only.

### 7.10 Reports

- `/reports`, three sub-views sharing one page with a tab selector:
  1. **Patient Report** — pick a patient (scoped dropdown), show plan/adherence/sessions/hours/devices-used/baseline-to-latest-assessment-change, "Export sessions CSV" button.
  2. **Device Usage Report** — reuses the §7.4 usage comparison table, "Export CSV".
  3. **Patient Inflow Report** — reuses the §7.8 inflow series with the range toggle, "Export CSV".
- CSV export is **client-side only** (build a CSV string, `Blob`, `URL.createObjectURL`, trigger a download) — there's no backend export endpoint in the original, and none is needed.

### 7.11 AI Assistant

**Not an LLM integration.** There's no external AI API key in the original app, and the two hardest requirements (never fabricate; say plainly when data isn't available) are far easier to guarantee with a **fixed set of intents backed by direct Prisma queries** than with a model that can hallucinate. If you have a real LLM key available for this rebuild, this endpoint is the natural place to add tool-calling on top of the same scoped queries — but the rules-based version below is a complete, honest baseline you can ship without one.

Implement one endpoint, `POST /ai/ask` (or a form action), accepting `{ question: string }`, scoped by `locals.user` exactly like every REST-equivalent route (a Therapist's query can only ever resolve a patient within their own location — reuse `patientScopeFor`). Pattern-match the question against these intents, in order:

1. **No patient named in the question** →
   - "low adherence" → list active patients (in scope) whose day-log-derived adherence < 70%.
   - "utilization"/"most used"/"highest" + "device" → rank devices by session count.
   - "unresolved"/"issue" → list device issues not in `Cleared`/`Resolved`.
   - else → an honest "I can help with X, Y, Z — try rephrasing" fallback. **Never guess.**
2. **A patient's name or display code appears in the question** (substring match against the scoped patient list) →
   - "improv"/"baseline"/"now"/"latest" → baseline vs. latest assessment score, change, adherence, sessions, total hours, primary device — formatted as:
     ```
     Patient X has shown improvement in <Assessment> score.
     Baseline: 26/66   Latest: 57/66   Change: +31 points
     Therapy adherence: 91%   Sessions completed: 33   Total therapy time: 40.0h
     Primary device usage: PLUTO-001 — 33 sessions
     ```
   - "device" + "most"/"which" → device usage ranking for that patient.
   - "hour"/"week" → sessions + minutes in the last 7 days.
   - "following"/"adherence"/"plan" → active-plan adherence with a plain-language verdict (on track / moderately behind / significantly behind).
   - else → a default summary (status, session count, assessment count) with a "View Patient" link.
   Every answer includes structured `facts: [{label, value}]` and optional `links: [{label, page}]` so the UI can render it richly (not just a text blob) and let the user jump straight to the relevant page.

---

## 8. Frontend routes & navigation

### 8.1 Route → SvelteKit path mapping

| Original route | SvelteKit route | Notes |
|---|---|---|
| `/login` | `/login` | Outside the `(app)` layout group |
| `/` (Overview) | `/` | Therapist/Consultant only; redirect Engineer/Admin to `/analytics` |
| `/analytics` | `/analytics` | |
| `/patients` | `/patients` | |
| `/patients/:id` | `/patients/[id]` | 9-tab interface, `?tab=` query param |
| `/patients/:id/sessions/:sessionId` | *(not a route — see §7.5)* | Session detail is a drawer, not a page, in the rebuild. Keep a fallback route only if you want deep-linkable session URLs. |
| `/assessments` | `/assessments` | |
| `/plans` | `/plans` | |
| `/sessions` | `/sessions` | |
| `/devices` | `/devices` | |
| `/devices/:id` | `/devices/[id]` | |
| `/device-requests` | `/device-requests` | |
| `/device-issues` | `/device-issues` | |
| `/maintenance` | `/maintenance` | |
| `/device-usage` | `/device-usage` | |
| `/device-history` | `/device-history` | |
| `/users` | `/users` | Admin only |
| `/locations` | `/locations` | Admin only |
| `/notifications` | `/notifications` | |
| `/profile` | `/profile` | |
| `/reports` | `/reports` | |
| `/ai` | `/ai` | |
| `/audit-log` | `/audit-log` | Admin/Consultant only |

### 8.2 Per-role navigation (reproduce exactly — labels and grouping matter)

```ts
// src/lib/navConfig.ts
export const NAV_BY_ROLE = {
  THERAPIST: [
    { section: null, items: [
      { to: '/', label: 'Overview' },
      { to: '/patients', label: 'My Patients' },
      { to: '/assessments', label: 'Assessments' },
      { to: '/plans', label: 'Therapy Plans' },
      { to: '/sessions', label: 'Sessions' },
      { to: '/device-requests', label: 'Device Requests' },
    ]},
    { section: 'Insights', items: [
      { to: '/analytics', label: 'Analytics' },
      { to: '/reports', label: 'Reports' },
      { to: '/ai', label: 'AI Assistant' },
    ]},
  ],
  CONSULTANT: [
    { section: null, items: [
      { to: '/', label: 'Overview' },
      { to: '/patients', label: 'Patients' },
      { to: '/plans', label: 'Therapy Plans' },
      { to: '/assessments', label: 'Assessments' },
      { to: '/sessions', label: 'Sessions' },
    ]},
    { section: 'Insights', items: [
      { to: '/analytics', label: 'Analytics' },
      { to: '/reports', label: 'Reports' },
      { to: '/ai', label: 'AI Assistant' },
    ]},
  ],
  ENGINEER: [
    { section: null, items: [
      { to: '/analytics', label: 'Device Overview' },
      { to: '/devices', label: 'Devices' },
      { to: '/device-issues', label: 'Issues' },
      { to: '/maintenance', label: 'Maintenance' },
      { to: '/device-usage', label: 'Usage' },
    ]},
    { section: 'Records', items: [
      { to: '/device-history', label: 'Device History' },
      { to: '/notifications', label: 'Notifications' },
    ]},
  ],
  ADMIN: [
    { section: null, items: [
      { to: '/analytics', label: 'Overview' },
      { to: '/patients', label: 'Patients' },
      { to: '/users', label: 'Users' },
      { to: '/locations', label: 'Locations' },
      { to: '/devices', label: 'Devices' },
      { to: '/sessions', label: 'Sessions' },
      { to: '/assessments', label: 'Assessments' },
      { to: '/plans', label: 'Plans' },
    ]},
    { section: 'Governance', items: [
      { to: '/reports', label: 'Reports' },
      { to: '/audit-log', label: 'Audit Log' },
      { to: '/ai', label: 'AI Assistant' },
    ]},
  ],
};
```

Note the deliberate label differences per role ("My Patients" vs "Patients", "Overview" vs "Device Overview") and section groupings ("Insights" vs "Records" vs "Governance") — these aren't arbitrary, they match the mental model of each role.

### 8.3 App shell

- Sidebar: logo mark + brand name/org, the nav above, a role-chip footer (avatar-initials circle, name, role, sign-out button).
- Topbar: breadcrumb (page title + optional detail, e.g. "Patients › Ananya R."), a global search trigger (searches patients + devices by name/code, grouped results — sessions/assessments/plans are **not** in scope for search in the original, a known gap), the notifications bell, a user-menu (My Profile / Sign out).
- Global search and the notification bell are both "island" components that manage their own open/closed state and fetch on demand — no global store needed for them.

---

## 9. Design system

Port this CSS file as-is (framework-agnostic custom properties + plain classes — nothing React-specific in it). Full token set:

```css
:root {
  --bg: #f8fafc;
  --bg-plane: #eef2f6;
  --surface: #ffffff;
  --surface-2: #f1f5f9;
  --surface-3: #e2e8f0;
  --border: #e2e8f0;
  --border-strong: #cbd5e1;
  --ink-900: #0f172a;  /* primary text */
  --ink-700: #334155;
  --ink-600: #475569;  /* micro-labels, e.g. small uppercase captions */
  --ink-500: #64748b;  /* muted secondary text */
  --ink-400: #94a3b8;
  --accent: #0f766e;   /* deep emerald/teal — primary CTA */
  --accent-600: #0b5a54;
  --accent-soft: #e6f4f2;
  --accent-soft-ink: #0b5a54;
  --good: #16a34a;
  --good-soft: #e6f7ec;
  --warning: #d97706;
  --warning-soft: #fef3e2;
  --critical: #c23b3b;
  --critical-soft: #fbe2e2;
  --info: #2a5f8f;
  --info-soft: #e2edf6;
  --radius-s: 6px; --radius-m: 10px; --radius-l: 16px;
  --shadow-sm: 0 1px 3px rgba(0,0,0,.05);
  --shadow-md: 0 6px 20px rgba(15,23,42,.08);
  --shadow-lg: 0 16px 40px rgba(15,23,42,.14);
  --font-display: "Source Serif 4", Georgia, serif;
  --font-body: "IBM Plex Sans", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
}
```

Key component classes to reproduce: `.card` / `.card-head` / `.card-body` (basic panel), `.kpi` (KPI tile: label + icon chip + big serif value + optional sub-line), `.pill` (status badge — colored by a `TONE_BY_STATUS` lookup keyed on the literal status strings: `Active`→good, `Assessment Pending`/`Paused`/`Investigating`/`Medium`→warning, `Discontinued`/`Open`/`High`/`Critical`→critical, etc.), `.patient-header`/`.ph-*` (the patient detail header card), `.tabs`/`.tab-btn` (the 9-tab bar), `.two-col` (2fr/1fr grid for Overview-style layouts), `.stat-box` (metric tile), `.day-log-grid`/`.day-log-cell` (the plan heatmap, 4 status colors), `.modal-backdrop`/`.modal` (centered dialogs), `.drawer-backdrop`/`.drawer-panel` (the session-detail side drawer — fixed-position, slides in from the right with a CSS `@keyframes` transform), `.range-toggle` (Today/Week/Month/Year segmented control), `.login-visual`/`.login-panel` (the two-pane login screen).

Fonts: Source Serif 4 (headings + big numeric values), IBM Plex Sans (body), IBM Plex Mono (codes/timestamps) — load via Google Fonts `<link>` in `app.html`.

---

## 10. Suggested build order

1. **Schema + seed** (§4) — get Postgres migrated and seeded before writing a single page.
2. **Auth** (§5) — login, session cookie, `hooks.server.ts`, the `(app)` layout guard, forced-reset + forgot-password flows. Nothing else is reachable until this works.
3. **Users + Locations** (§7.9) — needed to create real Therapist/Consultant/Engineer accounts for testing everything after.
4. **Patients** (§7.1) core CRUD + location scoping (§6.3) — this is the load-bearing scoping logic every other domain reuses.
5. **Assessments** (§7.2) and **Therapy Plans** (§7.3) — including the multi-device create form and the edit/revision-history/notify chain.
6. **Devices** (§7.4) — catalog, CRUD, the two workflows (requests, issues).
7. **Sessions + the drawer + notes** (§7.5).
8. **Notifications** (§7.6) and **Audit log** (§7.7) — thin, but every domain above should already be calling into them; wire the UI last.
9. **Analytics/Overview** (§7.8) — needs real data from everything above to be meaningful.
10. **Reports** (§7.10) and **AI Assistant** (§7.11) — both are read-only aggregations over everything already built, easiest to do last.
11. Design pass (§9) and nav wiring (§8) throughout, not bolted on at the end.

---

## 11. Known simplifications (carried over deliberately — not bugs to "fix")

- **No email/SMTP** — forgot-password and account-creation temp passwords are relayed via an in-app admin notification, not real email. If you have SMTP/an email API available for this rebuild, §5.6's forgot-password flow is the place to wire it in.
- **No object storage** — patient documents are metadata-only (name/type/size, no actual file bytes); session-note photos *are* real bytes, stored as base64 in Postgres rather than S3, capped at ~2MB. If you want patient documents to hold real files too, storing them the same way (base64 in a `Bytes`/`Text` column) is the lowest-effort path; a real object store is the "do it properly" path.
- **No device CSV ingestion pipeline** — the schema is CSV-contract-shaped on purpose (`TherapySession`/`SessionTrial` field names map cleanly onto a device's per-trial export format), but there's no staging table, validation, or upload endpoint. All session/trial data here is seed-generated. Building the real ingestion pipeline (staging table → validate → identify device/patient/session → normalize → insert) is the largest genuinely-unbuilt piece of the original system.
- **No real-time updates** — every page fetches on load/mount; only the notification bell polls (every ~30s). No websockets/SSE.
- **Devices have no location concept** — engineer/admin device analytics are fleet-wide, not location-scoped, unlike patients.
- **Patient notes are not permission-tightened** beyond "any authenticated user who can see the patient" — the RBAC matrix (§6.2) flags this as a known gap, not a deliberate design choice.
- **Global search** covers patients + devices only, not sessions/assessments/plans.
- **The plan day-log's `PATCH` (log actual minutes for one day)** has a backend shape defined in §7.3 but no original UI control calling it — the day log is otherwise a read-only heatmap.

---

## 12. Seed script requirements

Write one seed script that, run repeatedly, always converges to the same state (idempotent — use `upsert`, and for anything that regenerates relative to "today" like plan day-logs, delete-and-recreate rather than skip-if-exists):

1. **2 Locations**: e.g. "Downtown Clinic", "North Campus".
2. **5 demo users**, one per meaningful role combination, password `neurodash123` for all:
   - Therapist A @ Downtown (e.g. "Dr. Priya Nair")
   - Therapist B @ North Campus, alone (no consultant there yet — demonstrates an under-staffed location)
   - Consultant @ Downtown (same location as Therapist A — lets you demo "consultant sees the same patients as the therapist at their site")
   - Engineer (no location)
   - Admin (no location)
3. **Reference data** from §4.1 (assessment types + device types).
4. **A handful of devices** (at least one per commonly-used type, varying statuses including one with an open issue).
5. **2+ patients** under Therapist A, one with a **multi-device active plan** with **~30 days of realistic day-log history** (mostly `done`, a couple of `partial`/`missed` days for adherence-metric realism) and **matching sessions** for each non-missed day, with **accuracy trending upward** over the plan (so charts aren't flat lines) — and a couple of **assessments** (baseline → latest, scores rising) dated across that same window.
6. Recompute anything date-relative (the plan's `startDate`, day-log `logDate`s, session `sessionDate`s, assessment dates) **relative to the current date at seed-run time**, not hardcoded absolute dates — otherwise the demo data silently becomes stale/out-of-range every time someone runs the seed on a later day.
7. **A pending device request** and **an open device issue**, each generating a real notification, to demonstrate the notification bell without manual clicking.

---

## 13. Explicitly out of scope for this document

These are real, substantial features that exist only as spec/intent in the original, not working code — they're flagged here so you don't assume they're part of "everything," but building them is a legitimate next step beyond this document:

- A genuine LLM-backed AI Assistant (vs. the rules-based one in §7.11).
- The device CSV ingestion pipeline (§11).
- Program-level "outflow" (discharge/completion-rate-over-time) analytics — only point-in-time Completed/Discontinued counts exist today.
- Device-request/issue scoping by location (currently still "my own requests," not location-wide).
- A patient list with server-side search/filter/sort/pagination controls (currently renders everything in scope with client-side interaction only).
