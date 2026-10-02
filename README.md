# NeuroDash

Rehabilitation therapy monitoring platform: patients, click-only clinical assessments (with scanned documents), therapy plans,
rehabilitation devices, sessions, analytics, reports and an audit trail, with four role-based experiences
(Therapist, Consultant, Engineer, Admin).

**Stack:** SvelteKit 2 (Svelte 5) · TypeScript · Prisma 7 · PostgreSQL · Vite 8 · Vitest

The logic, schema and permissions follow `ref/NEURODASH_SVELTEKIT_SPEC.md`; 

---

## Quick start

You need **Node.js 20.19+** and a running **PostgreSQL 14+**. Then:

```sh
npm install
npm run setup      # asks for your Postgres password once, creates the database, tables and demo data
npm run dev
```

Open **http://localhost:5173** and sign in as `priya.nair@neurodash.care` / `neurodash123`
(all demo accounts are [listed below](#demo-accounts)).

Something not working? See [Troubleshooting](#troubleshooting). The details are explained next.

---

## 1. Detailed setup

### Prerequisites

| Need | Version | Check |
|---|---|---|
| Node.js | 20.19 or newer (developed on 24) | `node -v` |
| npm | comes with Node | `npm -v` |
| PostgreSQL | 14 or newer, running locally or reachable | `psql --version` |

### Option A — one command (recommended)

```sh
npm install
npm run setup
```

`npm run setup` does everything the manual steps below do, and is safe to run again:

1. **`.env`:** if `DATABASE_URL` isn't set yet, it asks for host, port, user, password and database name
   (press Enter to accept the defaults `localhost`, `5432`, `postgres`, `neurodash`) and saves it to `.env`.
   It handles special characters in the password for you.
2. **Database:** connects to PostgreSQL and creates the database if it doesn't exist. No `psql` needed.
3. **Tables:** applies the schema and generates the Prisma client.
4. **Demo data:** loads the demo users, patients, devices and sessions.

It prints a clear message if PostgreSQL isn't running or the password is wrong. Options:

```sh
npm run setup -- --no-seed    # tables only, no demo data
npm run setup -- --reset      # ERASES the database first, then rebuilds it
```

### Option B — step by step

**1. Install dependencies** — `npm install`
Downloads the packages listed in `package.json`, including Prisma (the database layer) and the SvelteKit toolchain.

**2. Create an empty database** — `psql -U postgres -c "CREATE DATABASE neurodash;"`
Any name works. You can also create it in pgAdmin. The tables are created in step 4, so the database must exist but be empty.

**3. Configure the environment** — copy `.env.example` to `.env` (Windows PowerShell: `Copy-Item .env.example .env`), then edit it:

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/neurodash"
SESSION_SECRET="any-long-random-string"
```

`DATABASE_URL` has the form `postgresql://USER:PASSWORD@HOST:PORT/DATABASE`. `5432` is PostgreSQL's default port.
If your password contains special characters (`@ : / # ?`), URL-encode them, e.g. `@` becomes `%40`.
`.env` is git-ignored, so your password is never committed.

**4. Create the tables and load demo data**

```sh
npm run db:migrate     # builds the schema from prisma/migrations
npm run db:seed        # adds demo users, patients, devices and sessions (safe to re-run)
```

> Run **both**. If you only migrate, the tables exist but hold no users, and sign-in fails with
> "Invalid email or password".

### Start the app

```sh
npm run dev
```

Starts the dev server with hot reload at **http://localhost:5173**. Stop it with `Ctrl+C`.

### Demo accounts

Every account uses the password **`neurodash123`**.

| Role | Email | Try this |
|---|---|---|
| Therapist (Downtown) | `priya.nair@neurodash.care` | Owns the seeded patients; create patients, plans, assessments, upload scans |
| Therapist (North Campus) | `rohan.mehta@neurodash.care` | Sees no Downtown patients (location scoping) |
| Consultant (Downtown) | `vikram.suresh@neurodash.care` | Read-only, except adding notes |
| Engineer | `arjun.rao@neurodash.care` | Devices, request queue, issues, maintenance |
| Admin | `biorehabilitationgroup@gmail.com` | Users, locations, audit log, read-only oversight |

New accounts created by an admin get a one-time temporary password and must choose a new one at first sign-in.

### Browsing the database

```sh
npx prisma studio             # opens http://localhost:5555
```

### Troubleshooting

| Symptom | Fix |
|---|---|
| "Invalid email or password" for a demo account | The database has no users yet: run `npm run db:seed` (or `npm run setup`) |
| `P1001: Can't reach database server` | PostgreSQL isn't running, or host/port/password in `DATABASE_URL` is wrong |
| `password authentication failed` | Wrong password in `DATABASE_URL` (URL-encode special characters) |
| "relation ... does not exist" / missing columns after pulling changes | `npm run db:migrate` (or `npm run db:reset` if the migrations were rewritten; it erases the dev database) |
| `Port 5173 is already in use` | `npm run dev -- --port 5180` |
| Want a clean slate | `npm run setup -- --reset` (or `npm run db:reset`) |
| After pulling an update that changes the database | `npm run db:migrate`, then `npm run db:seed` (adds new reference data such as the device types (PLUTO, MARS, ATOBOT, HYPERCUBE, NOARK, DYNABO, MOBBO, WEARABLE)) |

`db:reset` **erases** the database it points at. Only use it on development data.

---

## 2. Local server integration (training laptops → dashboard)

NeuroDash works with the Python **local server** in `localserver/` (`s2.py` receives uploads on port 5000, `patients_store.py`
keeps `patients.json`). Both use one data folder, set in `.env`:

```env
NEURODASH_DATA_DIR="D:/NeuroDashData"     # the same folder as DATA_FOLDER in localserver/patients_store.py
INGEST_INTERVAL_SECONDS=30                # how often the app looks for new uploads (0 = only on "Sync now")
```

Leave `NEURODASH_DATA_DIR` empty to switch the integration off; the rest of the app is unaffected.

**When you register a patient** (Patients → New Patient), the app:

1. saves the patient in the database (table `patients`) and creates the folder `<data folder>/<Patient ID>/`, where that patient's
   laptop uploads will land;
2. stores the chosen **training devices** in the database (table `patient_devices`) and in the **one common `patients.json`** at the
   root of the data folder: a single file listing every patient with their status, side and devices. The database is the source
   of truth and `patients.json` is a mirror of it for the laptops. It never contains names, dates of birth or contact details.
   A laptop only receives patients allocated to its device. The version number goes up on every real change, and a UDP
   "patients changed" nudge is broadcast so laptops pick it up immediately.

The **Patient ID** is the ID typed on the training devices (letters, digits, `-` and `_`). Leave it blank for an auto-generated
`P-12345`. Names such as `PLUTO`, `mars01`, `patients` or `_incoming` are refused because they would clash with the server's own
folders. Devices can be changed later on the patient's **Devices** tab, and a patient's therapy-plan devices are added automatically.

**When a laptop uploads data**, the app reads it from the folder and stores it in the database:

| File (under `<ID>/<LAPTOP>/`) | Becomes |
|---|---|
| `sessions.csv` | sessions, trials, hits, **stars**, durations: they appear in the progress charts, session drawer and reports |
| `configdata.csv` | the patient's device configuration (training window, arm lengths, side) |

- **Live updates.** The app watches the data folder and imports a new or changed file about a second after it arrives. A scan also runs
  every `INGEST_INTERVAL_SECONDS` (default 30) as a safety net, and an engineer can press **Sync now** on the **Data Sync** page.
  Open dashboards check for new data every 10 seconds and refresh the page's lists and charts by themselves, with a small
  "New training data received" notice, so a finished session shows up without anyone reloading.
- Re-scanning is safe: a file whose content has not changed is skipped, and a re-uploaded (cumulative) file updates its sessions
  rather than duplicating them.
- The training device comes from the `:Device:` line in `sessions.csv` (so `PLUTO01` and `PLUTO` folders both mean PLUTO).
- A file for a patient that is not registered yet is shown as **Unmatched** and imported automatically once the patient exists.
- Once real data flows for a patient, plan days that pass with no training are marked **missed**, so adherence is real.
- The **Data Sync** page (engineer: sync; admin: view) shows file status, totals and which laptops are online and up to date.

The Python server is unchanged and keeps receiving the files. Let the web app be the only writer of `patients.json`; avoid editing it
with `patients_store.py` at the same time. Details of the file formats: `localserver/DASHBOARD_DATA_GUIDE.md`.

---


### Device-specific progress, stacked colours and demo data

- The patient's **Progress** tab has a tab per training device (PLUTO, MARS, ...). KPIs, accuracy, stars, games and mechanisms are for that device only. The "Therapy time per day" chart is stacked, one colour per device (the same colour everywhere).
- Therapy time is the `MoveTime` column (falling back to `GameDuration`, then start to stop time).
- `npm run db:seed` creates patient `HOCMCV002` (PLUTO and MARS). `npm run demo:data` copies `localserver/testdata/*_sessions.csv` into the data folder; they are imported within about 30 seconds.
- After pulling these changes run `npm run db:migrate` (adds trial kind and assist mode) and `npm run db:seed` (device colours).

### Patient in use (presence)

While a patient trains, the laptop uploads `sessions.csv` about every minute. The server notes the upload in `presence.json`; the dashboard shows **In session now** on the patient page, the patient list and Data Sync. Other laptops ask the server (`check_user`) before logging the same ID in, and call `release` when done. `ACTIVE_WINDOW_SECONDS` (default 300, in `.env` and `patients_store.py`) is how long after the last upload a patient still counts as in use. The laptop software has to make that call to actually block a second login. Details: `localserver/DASHBOARD_DATA_GUIDE.md`.

## 3. Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload (http://localhost:5173) |
| `npm run build` / `npm run preview` | Production build / serve that build locally |
| `npm run check` | Type-check (svelte-check) |
| `npm test` | Unit tests |
| `npm run test:api` | Backend API tests (needs `TEST_DATABASE_URL`, see below) |
| `npm run db:migrate` | Apply migrations to a dev database (creates new ones if the schema changed) |
| `npm run db:deploy` | Apply existing migrations (production) |
| `npm run db:seed` | Load / refresh the demo data |
| `npm run setup` | One-command setup: `.env`, create database, tables, demo data (`-- --reset`, `-- --no-seed`) |
| `npm run db:reset` | Drop and rebuild the database, then re-seed it (erases all data) |
| `npm run db:generate` | Regenerate the Prisma client |

---

## 4. What's in the app

- **Patients:** location-scoped list, 9-tab detail page (overview, assessments, plan, sessions, devices, progress, documents, notes, timeline).
- **Assessments:** every scale in `clinical_scales/neuro/*.json` (FMA, ARAT, PHQ-9, MoCA, NIHSS, MAL, EQ-5D and more) is rendered by one
  generic **click-only** form. Answers are validated and scores recomputed on the server. Scanned documents can be attached.
- **Therapy plans:** multi-device plans, day log, and a full revision history with a required reason for every change.
- **Devices:** request → clear → assign workflow, issue lifecycle with troubleshooting log, maintenance, usage and history.
- **Sessions:** trial-level detail in a side drawer, with notes and optional photos.
- **Insights:** role-adaptive overview and analytics, reports with CSV export, and a rules-based AI assistant (answers only from your data).
- **Admin:** user accounts, locations, and the audit log.
- **Responsive:** works on desktop, tablet and phone.

### Who can do what

| | Therapist | Consultant | Engineer | Admin |
|---|---|---|---|---|
| See patients | own location | own location | no | all |
| Create patients, assessments, plans | yes (primary therapist) | no | no | no |
| Edit a plan | primary or covering therapist at the same location | no | no | no |
| Add patient and session notes | yes | yes | no | patient notes only |
| Request devices | yes | no | no | no |
| Clear, assign, resolve, maintain devices | no | no | yes | no |
| Manage users and locations | no | no | no | yes |
| Audit log | no | no | no | yes |

This is enforced in every server action, not just hidden in the UI.

---

## 5. Testing

```sh
npm run check        # type-check
npm test             # unit tests: scale engine, scoring, upload checks, stats, AI intents, CSV
```

Backend API tests (about 200) run against a **throwaway** database and a real HTTP server:

```sh
psql -U postgres -c "CREATE DATABASE neurodash_test;"
TEST_DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/neurodash_test" npm run test:api
```

PowerShell:

```powershell
$env:TEST_DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/neurodash_test"; npm run test:api
```

The suite migrates and seeds that database, builds the app, serves the **production build** (SvelteKit's CSRF origin check only runs in
production), and covers auth, the role-by-page matrix, location scoping, assessments and scans, plans, devices, admin and the audit log.
It **refuses to run unless the database name contains `test`**, so it cannot touch your real data.

---

## 6. Deploying

The project uses `adapter-auto`, which only works on a few hosts. For your own server:

```sh
npm i -D @sveltejs/adapter-node
```

In `vite.config.ts`, change `import adapter from '@sveltejs/adapter-auto'` to `import adapter from '@sveltejs/adapter-node'`, then:

```sh
npm run build
npm run db:deploy             # apply migrations (do not use db:migrate / db:reset in production)
npm run db:seed               # optional: demo data. Skip this in production, or change the demo passwords.
ORIGIN=https://your.domain BODY_SIZE_LIMIT=15M DATABASE_URL="postgresql://..." node build
```

- **`ORIGIN`** must be your public URL, or form posts are rejected by the CSRF check.
- **`BODY_SIZE_LIMIT`** must be raised (here 15 MB) or scan uploads fail at the default 512 KB.
- Serve it over HTTPS: the session cookie is automatically marked `Secure` everywhere except plain `http://localhost`.
- There is no email service: temporary passwords are shown once to the admin (and forgot-password requests reach admins as notifications).

---

## 7. Project layout

```
prisma/                      schema, migrations, seed script
clinical_scales/neuro/       assessment definitions (JSON): the source of truth for every scale
src/lib/scales/              scale engine: visibility, scoring, validation (pure TS, shared by browser and server)
src/lib/components/scale/    the generic click-only scale form
src/lib/server/              server-only code: db, sessions, audit, notifications, scoping, files, analytics, AI,
                             patientFiles (folders, patient.json, patients.json), ingest (CSV → database), laptops, poller
src/lib/ingest/              pure CSV parsing and the patient.json / patients.json builders
localserver/                 the Python local server the laptops talk to
src/lib/styles/              app.css (design system) and responsive.css
src/routes/login/            sign-in, forced password reset, forgot password
src/routes/(app)/            the authenticated app; +layout.server.ts is the auth guard
src/routes/api/              JSON/file endpoints (search, notifications, sessions, documents, AI)
tests/api/                   backend test suite
ref/                         the spec and the HTML reference design
```

To change a scale, edit its CSV in `clinical_scales/redcap_bak` and run `python clinical_scales/redcap_bak/convert_to_json.py`.
Free-text items in a scale are intentionally not rendered; attach a scanned document instead.

### Patient reports

**Reports > Patient Report** shows the devices a patient used (time, and the movements or mechanisms trained on each) and one graph per assessment scale with a plain statement of how it changed. Type notes on the report, **Print** it, or **Save report**: the snapshot (data plus your notes) is written to `<NEURODASH_DATA_DIR>/_reports/<Patient ID>/` (or `REPORTS_DIR`) and listed under *Saved reports*, where it reopens exactly as saved. The storage sits behind one small interface so it can move to S3 later without changing the pages.

### Demo reset

`npm run demo:reset -- --yes` wipes the database in `DATABASE_URL` and rebuilds a clean demo: the seeded users, two centres with their devices, and seven patients (Active, Ongoing, Paused, Completed, Discontinued) with weeks of sessions and assessments. It also writes them to `<NEURODASH_DATA_DIR>/patients.json`. It is destructive, so it refuses to run without `--yes`; take a `pg_dump` first. Demo logins use the password `neurodash123` (see the seeded emails printed at the end).
