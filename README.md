# NeuroDash

Rehabilitation therapy monitoring platform: patients, click-only clinical assessments (with scanned documents), therapy plans,
rehabilitation devices, sessions, analytics, reports and an audit trail, with four role-based experiences
(Therapist, Consultant, Engineer, Admin).

**Stack:** SvelteKit 2 (Svelte 5) · TypeScript · Prisma 7 · PostgreSQL · Vite 8 · Vitest

The logic, schema and permissions follow `reference/NEURODASH_SVELTEKIT_SPEC.md`; the visual design follows `reference/neurodash_10.html`.

---

## Quick start

You need **Node.js 20.19+** and a running **PostgreSQL 14+**. Then:

```sh
npm install
npm run setup      # asks for your Postgres password once, creates the database, tables and demo data
npm run dev
```

Open **http://localhost:5173** and sign in as `priya.nair@neurodash.care` / `neurodash123`
(all demo accounts and the [demo patients](#demo-patients) are listed below).

`npm run setup` is the only command another developer needs to get a working copy with realistic data: it applies the migrations,
loads the reference data (users, centres, device types, devices) and 37 demo patients with weeks of sessions and assessments.

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
3. **Tables:** applies the migrations (`prisma migrate deploy`) and generates the Prisma client.
4. **Demo data:** if the database has no patients yet, it seeds the reference data (users, two centres, device types, devices)
   and adds the [37 demo patients](#demo-patients). If the database already has patients, it changes nothing.

It prints a clear message if PostgreSQL isn't running or the password is wrong. Options:

```sh
npm run setup -- --no-seed    # tables only, no demo data
npm run setup -- --demo       # WIPES the database, then loads the demo users, centres, devices and patients
npm run setup -- --reset      # ERASES the database and rebuilds the schema first, then loads the demo data
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
npm run db:seed        # adds the demo users, centres, device types and devices (safe to re-run)
npm run demo:reset -- --yes   # optional: WIPES the database and loads the demo patients too (see "Demo patients")
```

> Run **both** migrate and seed. If you only migrate, the tables exist but hold no users, and sign-in fails with
> "Invalid email or password". `db:seed` alone also adds a few sample patients; `demo:reset` replaces them with the demo patients.

### Start the app

```sh
npm run dev
```

Starts the dev server with hot reload at **http://localhost:5173**. Stop it with `Ctrl+C`.

### Open it from another device (phone, tablet, another PC)

The other device must be on the **same network** as the computer running NeuroDash.

1. Find this computer's address: `ipconfig` (Windows) and look for the **IPv4 Address**, e.g. `172.17.227.246`.
2. Add this line to `.env` (a development setup over plain `http` needs it, or sign-in silently fails because the session cookie is `Secure`):
   ```env
   ALLOW_HTTP_COOKIES=1
   ```
3. Start the app so it listens on the network, not just on this computer: `npm run dev:lan`. It always uses **port 5180** (`--strictPort`): if something else already holds that port it stops with an error instead of quietly picking another one, so the address never changes.
4. Allow it through the Windows firewall (run once, in an administrator PowerShell):
   ```powershell
   netsh advfirewall firewall add rule name="NeuroDash 5180" dir=in action=allow protocol=TCP localport=5180
   ```
5. On the other device open **http://172.17.227.246:5180** (use your own address) and sign in as usual. On this computer use http://localhost:5180.

`ALLOW_HTTP_COOKIES` is for a trusted clinic network only. For anything reachable from the internet, serve the built app over HTTPS
(see [Deploying](#6-deploying)) and leave it unset. A built app (`node build`) also needs `ORIGIN` set to the exact address people type,
e.g. `ORIGIN=http://172.17.227.246:3000` (the built app's own port), or form posts are refused.

### Demo accounts

Every account uses the password **`neurodash123`**.

| Role | Email | Try this |
|---|---|---|
| Therapist (Ranipet) | `priya.nair@neurodash.care` | Owns the seeded patients; create patients, plans, assessments, upload scans |
| Therapist (CMC Vellore) | `rohan.mehta@neurodash.care` | Sees no Ranipet patients (location scoping) |
| Consultant (Ranipet) | `vikram.suresh@neurodash.care` | Read-only, except adding notes |
| Engineer | `arjun.rao@neurodash.care` | Devices, request queue, issues, maintenance |
| Admin | `biorehabilitationgroup@gmail.com` | Users, locations, audit log, read-only oversight |

New accounts created by an admin get a one-time temporary password and must choose a new one at first sign-in.

### Demo patients

Loaded by `npm run setup` (on an empty database) and by `npm run demo:reset -- --yes`. Patient IDs have the form `AG10001`;
the ID is the only label a patient has (no names are collected). Seven are hand-made (below); **AG30001 to AG30030** are 30 more
(18 at Ranipet, 12 at CMC Vellore) with several assessment scales measured over their first 30 days, so the Analytics page has
enough data to draw its per-scale graphs. `npm run demo:bulk` adds just those 30 to the current database without touching anything else
(patients that already exist are skipped).

| ID | Centre | Status | What it shows |
|---|---|---|---|
| AG10001 | Ranipet (Priya) | Ongoing | MARS and PLUTO, about 4 weeks of sessions, FMA and ARAT improving, two notes |
| AG10002 | Ranipet | Ongoing | PLUTO only, some missed days, FMA and MAS |
| AG10003 | Ranipet | Active | Brand new, no plan yet |
| AG10004 | Ranipet | Paused | Stopped after a few sessions, with a note |
| AG10005 | Ranipet | Completed | Full plan, FMA from baseline to discharge |
| AG20001 | CMC Vellore (Rohan) | Ongoing | MARS and PLUTO |
| AG20002 | CMC Vellore | Discontinued | A few sessions only |

Reset the demo at any time with `npm run demo:reset -- --yes`. It **erases every table** of the database in `DATABASE_URL`
(it prints which database first and refuses to run without `--yes`), so take a `pg_dump` first if anything matters.
If `NEURODASH_DATA_DIR` is set it also writes the demo patients to `<data dir>/patients.json` and creates their folders; it never deletes files.

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
| `Port 5173 is already in use` | `npm run dev -- --port 5181` |
| Want a clean slate | `npm run setup -- --reset` (or `npm run db:reset`), or just the demo data: `npm run demo:reset -- --yes` |
| After pulling an update that changes the database | `npm run db:migrate`, then `npm run db:seed` (adds new reference data such as the device types (PLUTO, MARS, ATOBOT, HYPERCUBE, NOARK, DYNABO, MOBBO, WEARABLE)) |

`db:reset` **erases** the database it points at. Only use it on development data.

---

## 2. Local server integration (training laptops → dashboard)

NeuroDash works with the Python **local server** in `localserver/` (`s2.py` receives uploads on port 5000, `patients_store.py`
keeps `patients.json`). **It is a separate program: the web app does not start it.** Both use one data folder, set in `.env`:

```env
NEURODASH_DATA_DIR="D:/NeuroDashData"     # the same folder as DATA_FOLDER in localserver/patients_store.py
INGEST_INTERVAL_SECONDS=30                # how often the app looks for new uploads (0 = only on "Sync now")
ACTIVE_WINDOW_SECONDS=900                 # a patient counts as "in session" this long after their last sign of life (15 min: some games run that long)
# REPORTS_DIR="D:/NeuroDashData/_reports" # where saved patient reports go (default: <data dir>/_reports)
```

Leave `NEURODASH_DATA_DIR` empty to switch the integration off; the rest of the app (including the demo data) works without it.

**Running it** (only needed when real training laptops are sending data):

```sh
cd localserver
python s2.py          # listens on TCP 5000; the laptops' sender.py talks to it
```

Open TCP 5000 and UDP 5001 in the firewall. Run `python -m unittest test_agent test_presence` in the same folder for its tests. On each training laptop also run `python agent.py` (see below).

**Patients and `patients.json`**

1. **Registering a patient** (Patients → New Patient: Patient ID, date of birth, gender, affected side, optional stroke date)
   saves the patient in the database and creates the folder `<data folder>/<Patient ID>/` where that patient's laptop uploads land.
2. **Creating the therapy plan** (side to train and devices) adds the patient to the **one common `patients.json`** at the root of
   the data folder: a single file with every patient's `user_id`, `status`, `side` and `devices`. Changing the plan later
   (**Modify Plan**: devices, side, status) updates the plan, the `patient_devices` table and `patients.json` together. The database is
   the source of truth; `patients.json` is a mirror for the laptops. It never contains names, dates of birth or contact details.
   A laptop only receives patients whose plan includes its device. The version number goes up on every real change, and a UDP
   "patients changed" nudge is broadcast so laptops pick it up immediately.

The **Patient ID** is the ID typed on the training devices (letters, digits, `-` and `_`). Names such as `PLUTO`, `mars01`, `patients`
or `_incoming` are refused because they would clash with the server's own folders.

**Patient status:** *Active* (account created) becomes *Ongoing* automatically once devices are allocated and a session has been
trained. *Paused*, *Completed* and *Discontinued* are set by the therapist, or by changing the plan's status (the patient follows the plan).

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
- Once real data flows for a patient, plan days that pass with no training are marked **missed**, so adherence is real. A day with any training counts as done.
- The **Data Sync** page (engineer: sync; admin: view) shows file status, totals and which laptops are online and up to date.

Let the web app be the only writer of `patients.json`; avoid editing it with `patients_store.py` at the same time.
Details of the file formats: `localserver/DASHBOARD_DATA_GUIDE.md`.

### Device-specific progress and stacked colours

- The patient's **Progress** tab has a tab per training device (PLUTO, MARS, ...). KPIs, accuracy, stars, games and mechanisms are for that device only. The "Therapy time per day" chart is stacked, one colour per device (the same colour everywhere).
- Therapy time is the `MoveTime` column (falling back to `GameDuration`, then start to stop time).
- To try the live CSV path without a laptop, `npm run demo:data` copies sample device CSVs from `localserver/testdata/` into the data folder (patient ID `HOCMCV002`, which you register first); they are imported within about 30 seconds.
- After pulling an update run `npm run db:migrate`, then `npm run db:seed` (device types and colours).

### The laptop agent and the patient lock

Each training laptop runs `python localserver/agent.py` all day. It does not poll the server on a timer: it checks in when a patient starts or stops, once at the end of every trial, and when the server nudges it. It syncs the patient list and keeps the **patient lock** (`sender.py` still uploads the session files). When a patient logs in, the training software calls the agent on the same computer, `http://127.0.0.1:5055/start?patient=118`. The server then treats that **laptop** (identified by its own computer name, not just "MARS") as holding the patient. At the end of every trial the agent renews the hold (it notices a trial ending because `sessions.csv` changes, or the software can call `/trial-ended`), and the reply says if another laptop took the patient meanwhile. If another laptop tries the same patient, `/start` answers **409** with a message and the software must not start. Patients being trained on another laptop are also left out of a laptop's patient list (a per-laptop view: the server's `patients.json` and its version never change for this). The hold ends on `/stop`, or by itself after `ACTIVE_WINDOW_SECONDS` (default 900, i.e. 15 minutes: keep it longer than your longest trial) without a sign of life. The dashboard shows a held patient as **In session now** (with the laptop's name) on the patient page, the patient list and Data Sync. A laptop with no patient playing shows as offline after 3 minutes unless you set `NEURODASH_KEEPALIVE_SECONDS=120`. The training software has to make the `/start` call to actually block a second login; the server cannot do it alone. On a Raspberry Pi copy just `agent.py` and `sender_rapberryPI.py` and run `python3 agent.py` (it picks `sender_rapberryPI.py` when there is no `sender.py`). Full API, examples and limits: `localserver/DASHBOARD_DATA_GUIDE.md`. Tests: `python -m unittest test_agent test_presence` in `localserver/`.

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
| `npm run setup` | One-command setup: `.env`, create database, migrations, demo data (`-- --no-seed`, `-- --demo`, `-- --reset`) |
| `npm run demo:reset -- --yes` | **Wipes the database** and loads the demo users, centres, devices and the 37 demo patients |
| `npm run demo:bulk` | Adds the 30 bulk demo patients (AG30001 to AG30030) to the current database; nothing is wiped |
| `npm run demo:data` | Copies the sample device CSVs into the data folder for the live-upload demo |
| `npm run db:reset` | Drop and rebuild the database, then re-seed it (erases all data) |
| `npm run db:generate` | Regenerate the Prisma client |

---

## 4. What's in the app

- **Patients:** location-scoped list, 9-tab detail page (overview, assessments, plan, sessions, devices, progress, documents, notes, timeline). Assessments, therapy plans and sessions are reached through the patient, not from the sidebar.
- **Assessments:** every scale in `clinical_scales/neuro/*.json` (FMA, ARAT, PHQ-9, MoCA, NIHSS, MAL, EQ-5D and more) is rendered by one
  generic **click-only** form, with every question on one page (short answers such as numbers or one word sit side by side in a single row). The first assessment of a scale for a patient is automatically their **Baseline**; there is no timepoint to pick. Answers are validated and scores recomputed on the server. Scanned documents can be attached. On the patient's **Assessments** tab, pick a scale to see its graph, the change since baseline and its own history.
- **Therapy plans:** one plan per patient (side to train, devices, daily target), a day log (done / missed / upcoming), and a full revision history with a required reason for every change. Devices are added or removed in **Modify Plan**.
- **Devices:** devices belong to a centre. A centre requests a device type on the **Devices** page (Request device), an engineer clears it there and sets up a unit at the centre. Issue lifecycle with troubleshooting log, maintenance, usage and history. Each centre has a responsible engineer (set by the admin on the Locations page).
- **Sessions:** trial-level detail in a side drawer, with notes and optional photos.
- **Insights:** role-adaptive overview (patient inflow: new / old / overall) and analytics with a card per centre and, for every assessment scale, a graph of the average score of all patients from Day 1 to Day 30, **patient reports** (devices, movements and mechanisms, one graph and change statement per assessment scale, any date range, notes, print, saved snapshots), and a rules-based AI assistant (answers only from your data).
- **Admin:** user accounts, locations, and the audit log.
- **Responsive:** works on desktop, tablet and phone.

### Who can do what

| | Therapist | Consultant | Engineer | Admin |
|---|---|---|---|---|
| See patients | own location | own location | no | all |
| Create patients, assessments, plans | yes (primary therapist) | no | no | no |
| Edit a plan | primary or covering therapist at the same location | no | no | no |
| Add patient and session notes | yes | yes | no | patient notes only |
| Request devices for their centre | yes | no | no | no |
| Clear requests, set devices up at centres, resolve issues, maintain devices | no | no | yes | no |
| Raise device issues (own centre's devices) | yes | no | yes | no |
| Add notes to and save patient reports | yes | yes | no | no (can open saved reports) |
| Manage users and locations | no | no | no | yes |
| Audit log | no | no | no | yes |

This is enforced in every server action, not just hidden in the UI.

---

## 5. Testing

```sh
npm run check        # type-check
npm test             # unit tests: scale engine, scoring, upload checks, stats, AI intents, CSV
```

Backend API tests (about 280) run against a **throwaway** database and a real HTTP server:

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
                             patientFiles (folders, patients.json), ingest (CSV → database), laptops, presence, poller,
                             patientReport + reportStore (saved reports)
src/lib/ingest/              pure CSV parsing, presence and the patients.json entry builder
src/lib/patientReport.ts     the patient report: pure and unit-tested
localserver/                 the Python local server the laptops talk to
src/lib/styles/              app.css (design system) and responsive.css
src/routes/login/            sign-in, forced password reset, forgot password
src/routes/(app)/            the authenticated app; +layout.server.ts is the auth guard
src/routes/api/              JSON/file endpoints (search, notifications, sessions, documents, AI)
tests/api/                   backend test suite
reference/                   the spec and the HTML reference design
scripts/                     setup.mjs (one-command setup), load-demo-data.mjs
prisma/demo.ts               the demo reset (`npm run demo:reset`)
```

To change a scale, edit its CSV in `clinical_scales/redcap_bak` and run `python clinical_scales/redcap_bak/convert_to_json.py`.
Free-text items in a scale are intentionally not rendered; attach a scanned document instead.

### Patient reports

**Reports > Patient Report** shows, for a patient and a chosen period (quick buttons or any From / To dates), the devices used (time, and the
movements or mechanisms trained on each) and one graph per assessment scale with a plain statement of how it changed. Type notes on the
report, **Print** it, or **Save report**. Printing saves a copy first (when your role can save), so whatever was printed can always be found
again. The snapshot (data, period and your notes) is written to `<NEURODASH_DATA_DIR>/_reports/<Patient ID>/` (or `REPORTS_DIR`) and listed
under *Saved reports*, where it reopens exactly as saved. The storage sits behind one small interface so it can move to S3 later without
changing the pages.
