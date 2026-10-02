// Resets the database to a clean demo: wipes every table, re-creates the reference data (users, centres, device types, devices)
// through prisma/seed.ts, then adds a handful of realistic patients across both centres and every status.
//
//   npm run demo:reset -- --yes
//
// DESTRUCTIVE. It truncates every table of the database in DATABASE_URL, so it refuses to run without --yes and prints which
// database it is about to wipe. Take a backup first (pg_dump) if there is anything worth keeping.
// It also writes the demo patients into <NEURODASH_DATA_DIR>/patients.json and creates their folders; it never deletes files.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allItems, answerableItems, computeScores, maxScore, primaryScoreId } from "../src/lib/scales/evaluate";
import type { Answers, ScaleDef } from "../src/lib/scales/types";
import { registryEntry } from "../src/lib/ingest/patientJson";

const url = process.env.DATABASE_URL ?? "";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

// ---------------------------------------------------------------- helpers
const DAY = 86400_000;
const utcMidnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const daysAgo = (n: number) => utcMidnight(new Date(Date.now() - n * DAY));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

/** Small deterministic random numbers, so every reset produces the same demo. */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const scale = (id: string) => JSON.parse(readFileSync(join(process.cwd(), "clinical_scales", "neuro", `${id}.json`), "utf8")) as ScaleDef;

/**
 * Answers every single-choice item so the total lands near `fraction` of the maximum. Items have few choices (0/1/2), so each
 * answer rounds up or down at random in proportion to where the target falls; the scores then rise smoothly over time.
 */
function answersAt(def: ScaleDef, fraction: number, date: Date, rand: () => number): Answers {
  const answers: Answers = {};
  for (const it of answerableItems(def)) {
    if (it.type !== "single_choice" || !it.choices?.length) continue;
    const nums = it.choices.map((c) => c.value).filter((v): v is number => typeof v === "number").sort((x, y) => x - y);
    if (!nums.length) continue;
    const target = nums[nums.length - 1]! * fraction;
    const lo = [...nums].reverse().find((v) => v <= target) ?? nums[0]!;
    const hi = nums.find((v) => v >= target) ?? nums[nums.length - 1]!;
    answers[it.id] = hi === lo ? lo : rand() < (target - lo) / (hi - lo) ? hi : lo;
  }
  for (const it of allItems(def)) if (it.type === "date") answers[it.id] = date.toISOString().slice(0, 10);
  return answers;
}

// What each device trains (codes as the devices write them in sessions.csv)
const TRAINING = {
  MARS: { mechanisms: ["ML", "AP", "MLAP"], games: ["MC", "TT", "TW", "DC"] },
  PLUTO: { mechanisms: ["WURD", "FPS", "WFE"], games: ["TUK", "HAT", "PONG"] },
} as const;

// ---------------------------------------------------------------- the demo patients
interface DemoPatient {
  code: string;
  centre: "downtown" | "north";
  therapist: string; // email
  gender: "Female" | "Male";
  age: number;
  side: "Left" | "Right" | "Bilateral";
  strokeDaysAgo: number;
  registeredDaysAgo: number;
  status: "Active" | "Ongoing" | "Paused" | "Completed" | "Discontinued";
  /** No plan yet when absent (a brand-new account) */
  plan?: {
    trainingSide: "Left" | "Right" | "Both";
    devices: ("MARS" | "PLUTO")[];
    durationDays: number;
    dailyMinutes: number;
    startedDaysAgo: number;
    /** Days (from the plan start) on which the patient trained; the rest are missed */
    trainsDay: (day: number) => boolean;
    status: "Active" | "Paused" | "Completed" | "Discontinued";
    startAccuracy: number;
    endAccuracy: number;
  };
  assessments: { scaleId: string; day: number; label: string; fraction: number }[];
  notes?: { by: "therapist" | "consultant"; daysAgo: number; text: string }[];
}

const T1 = "priya.nair@neurodash.care";
const T2 = "rohan.mehta@neurodash.care";

const PATIENTS: DemoPatient[] = [
  {
    code: "AG10001", centre: "downtown", therapist: T1, gender: "Female", age: 58, side: "Left", strokeDaysAgo: 120, registeredDaysAgo: 41, status: "Ongoing",
    plan: { trainingSide: "Left", devices: ["MARS", "PLUTO"], durationDays: 42, dailyMinutes: 60, startedDaysAgo: 34, trainsDay: (d) => d % 7 !== 6 && d !== 12, status: "Active", startAccuracy: 0.52, endAccuracy: 0.86 },
    assessments: [
      { scaleId: "fma", day: 0, label: "Baseline", fraction: 0.38 },
      { scaleId: "fma", day: 14, label: "Day 14", fraction: 0.55 },
      { scaleId: "fma", day: 28, label: "Day 28", fraction: 0.72 },
      { scaleId: "arat", day: 0, label: "Baseline", fraction: 0.3 },
      { scaleId: "arat", day: 28, label: "Day 28", fraction: 0.58 },
    ],
    notes: [
      { by: "therapist", daysAgo: 20, text: "Good engagement. Reaching above shoulder height is improving; keep MARS sessions at 20 minutes." },
      { by: "consultant", daysAgo: 6, text: "Reviewed progress: plan is working, continue the current intensity." },
    ],
  },
  {
    code: "AG10002", centre: "downtown", therapist: T1, gender: "Male", age: 64, side: "Right", strokeDaysAgo: 75, registeredDaysAgo: 19, status: "Ongoing",
    plan: { trainingSide: "Right", devices: ["PLUTO"], durationDays: 28, dailyMinutes: 45, startedDaysAgo: 16, trainsDay: (d) => d % 4 !== 3, status: "Active", startAccuracy: 0.45, endAccuracy: 0.74 },
    assessments: [
      { scaleId: "fma", day: 0, label: "Baseline", fraction: 0.3 },
      { scaleId: "fma", day: 14, label: "Day 14", fraction: 0.46 },
      { scaleId: "mas", day: 0, label: "Baseline", fraction: 0.4 },
      { scaleId: "mas", day: 14, label: "Day 14", fraction: 0.3 },
    ],
  },
  { code: "AG10003", centre: "downtown", therapist: T1, gender: "Female", age: 47, side: "Right", strokeDaysAgo: 30, registeredDaysAgo: 2, status: "Active", assessments: [] },
  {
    code: "AG10004", centre: "downtown", therapist: T1, gender: "Male", age: 71, side: "Left", strokeDaysAgo: 150, registeredDaysAgo: 30, status: "Paused",
    plan: { trainingSide: "Left", devices: ["MARS"], durationDays: 30, dailyMinutes: 40, startedDaysAgo: 24, trainsDay: (d) => d < 9 && d % 3 !== 2, status: "Paused", startAccuracy: 0.4, endAccuracy: 0.58 },
    assessments: [{ scaleId: "fma", day: 0, label: "Baseline", fraction: 0.28 }, { scaleId: "fma", day: 14, label: "Day 14", fraction: 0.36 }],
    notes: [{ by: "therapist", daysAgo: 12, text: "Paused: patient admitted for an unrelated procedure. Resume when discharged." }],
  },
  {
    code: "AG10005", centre: "downtown", therapist: T1, gender: "Female", age: 52, side: "Right", strokeDaysAgo: 160, registeredDaysAgo: 60, status: "Completed",
    plan: { trainingSide: "Right", devices: ["PLUTO", "MARS"], durationDays: 28, dailyMinutes: 60, startedDaysAgo: 50, trainsDay: (d) => d % 9 !== 8, status: "Completed", startAccuracy: 0.5, endAccuracy: 0.92 },
    assessments: [
      { scaleId: "fma", day: 0, label: "Baseline", fraction: 0.35 },
      { scaleId: "fma", day: 14, label: "Day 14", fraction: 0.6 },
      { scaleId: "fma", day: 27, label: "Discharge", fraction: 0.85 },
      { scaleId: "arat", day: 0, label: "Baseline", fraction: 0.25 },
      { scaleId: "arat", day: 27, label: "Discharge", fraction: 0.7 },
    ],
    notes: [{ by: "therapist", daysAgo: 22, text: "Programme completed. Discharged with a home exercise sheet." }],
  },
  {
    code: "AG20001", centre: "north", therapist: T2, gender: "Male", age: 49, side: "Left", strokeDaysAgo: 90, registeredDaysAgo: 25, status: "Ongoing",
    plan: { trainingSide: "Left", devices: ["MARS", "PLUTO"], durationDays: 35, dailyMinutes: 50, startedDaysAgo: 21, trainsDay: (d) => d % 5 !== 4, status: "Active", startAccuracy: 0.48, endAccuracy: 0.8 },
    assessments: [{ scaleId: "fma", day: 0, label: "Baseline", fraction: 0.33 }, { scaleId: "fma", day: 14, label: "Day 14", fraction: 0.5 }],
  },
  {
    code: "AG20002", centre: "north", therapist: T2, gender: "Female", age: 66, side: "Right", strokeDaysAgo: 200, registeredDaysAgo: 40, status: "Discontinued",
    plan: { trainingSide: "Right", devices: ["PLUTO"], durationDays: 28, dailyMinutes: 40, startedDaysAgo: 35, trainsDay: (d) => d < 5, status: "Discontinued", startAccuracy: 0.42, endAccuracy: 0.5 },
    assessments: [{ scaleId: "fma", day: 0, label: "Baseline", fraction: 0.25 }],
    notes: [{ by: "therapist", daysAgo: 28, text: "Discontinued at the patient's request (travel distance)." }],
  },
];

// ---------------------------------------------------------------- main
async function main() {
  const target = new URL(url);
  console.log(`Target database: ${target.hostname}:${target.port || 5432}/${target.pathname.slice(1)}`);
  if (!process.argv.includes("--yes")) {
    console.error("This wipes EVERY table in that database. Run again with --yes to confirm (back it up first with pg_dump).");
    process.exit(1);
  }

  // 1. wipe everything except Prisma's own migration history
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  console.log(`Wiped ${tables.length} tables.`);

  // 2. reference data: users, centres, device types, devices (the seed also adds its own sample patients, removed below)
  const seed = spawnSync("npx tsx prisma/seed.ts", { shell: true, stdio: "inherit" });
  if (seed.status !== 0) throw new Error("prisma/seed.ts failed");
  await prisma.patient.deleteMany({});

  // 3. each centre gets its own MARS and PLUTO units
  const north = await prisma.location.findUniqueOrThrow({ where: { name: "North Campus" } });
  const downtown = await prisma.location.findUniqueOrThrow({ where: { name: "Downtown Clinic" } });
  for (const [displayCode, deviceTypeId, locationId, room] of [
    ["MARS-003", "MARS", north.id, "Therapy Room 1"],
    ["PLUTO-003", "PLUTO", north.id, "Therapy Room 1"],
  ] as const) {
    await prisma.device.upsert({ where: { displayCode }, update: {}, create: { displayCode, deviceTypeId, serialNumber: `SN-${displayCode}`, firmwareVersion: "3.1.0", status: "Available", location: room, locationId } });
  }
  const unitAt = async (centre: "downtown" | "north", type: string) =>
    (await prisma.device.findFirstOrThrow({ where: { deviceTypeId: type, locationId: (centre === "north" ? north : downtown).id }, orderBy: { displayCode: "asc" } })).id;

  const users = new Map((await prisma.user.findMany()).map((u) => [u.email, u]));
  const consultant = users.get("vikram.suresh@neurodash.care")!;
  const scales = new Map(["fma", "arat", "mas"].map((id) => [id, scale(id)]));
  const registry: ReturnType<typeof registryEntry>[] = [];

  for (const d of PATIENTS) {
    const therapist = users.get(d.therapist)!;
    const rand = rng(d.code);
    const registered = daysAgo(d.registeredDaysAgo);
    const patient = await prisma.patient.create({
      data: {
        displayCode: d.code,
        name: d.code,
        dob: new Date(Date.UTC(new Date().getUTCFullYear() - d.age, 5, 15)),
        gender: d.gender,
        affectedSide: d.side,
        strokeDate: daysAgo(d.strokeDaysAgo),
        therapistId: therapist.id,
        therapyGoals: [],
        status: d.status,
        registrationDate: registered,
        createdAt: registered,
      },
    });

    if (d.plan) {
      const p = d.plan;
      const start = daysAgo(p.startedDaysAgo);
      const elapsed = Math.min(p.durationDays, p.startedDaysAgo + 1);
      const plan = await prisma.therapyPlan.create({
        data: {
          patientId: patient.id,
          name: "Training plan",
          trainingSide: p.trainingSide,
          startDate: start,
          durationDays: p.durationDays,
          dailyTargetMinutes: p.dailyMinutes,
          targetSessions: p.durationDays,
          goals: [],
          status: p.status,
          createdById: therapist.id,
          createdAt: start,
          devices: { create: p.devices.map((deviceTypeId) => ({ deviceTypeId })) },
        },
      });
      await prisma.patientDevice.createMany({ data: p.devices.map((deviceTypeId) => ({ patientId: patient.id, deviceTypeId, allocatedById: therapist.id })) });

      let sessionNumber = 0;
      for (let day = 0; day < p.durationDays; day++) {
        const logDate = addDays(start, day);
        const upcoming = day >= elapsed;
        const trained = !upcoming && p.trainsDay(day);
        const progress = day / Math.max(1, p.durationDays - 1);
        const accuracy = Math.min(0.97, p.startAccuracy + (p.endAccuracy - p.startAccuracy) * progress + (rand() - 0.5) * 0.06);

        let minutes = 0;
        const trials: { type: "MARS" | "PLUTO"; n: number; targets: number; hits: number; sec: number; mech: string; game: string; stars: number }[] = [];
        const device = p.devices[day % p.devices.length]!;
        if (trained) {
          const nTrials = 5 + Math.floor(rand() * 4);
          for (let n = 1; n <= nTrials; n++) {
            const cfg = TRAINING[device];
            const targets = 10 + Math.floor(rand() * 5);
            const hits = Math.max(0, Math.min(targets, Math.round(targets * (accuracy + (rand() - 0.5) * 0.12))));
            const sec = Math.round(p.dailyMinutes * 60 * (0.85 + rand() * 0.3) / nTrials);
            const rate = hits / targets;
            trials.push({ type: device, n, targets, hits, sec, mech: cfg.mechanisms[Math.floor(rand() * cfg.mechanisms.length)]!, game: cfg.games[Math.floor(rand() * cfg.games.length)]!, stars: rate > 0.85 ? 3 : rate > 0.65 ? 2 : 1 });
          }
          minutes = Math.round((trials.reduce((s, t) => s + t.sec, 0) / 60) * 10) / 10;
        }

        const dayLog = await prisma.planDayLog.create({
          data: { planId: plan.id, dayNumber: day + 1, logDate, status: upcoming ? "upcoming" : trained ? "done" : "missed", targetMinutes: p.dailyMinutes, actualMinutes: Math.round(minutes) },
        });
        if (!trained) continue;

        sessionNumber++;
        const t0 = new Date(logDate.getTime() + (9 + Math.floor(rand() * 7)) * 3600_000);
        const targets = trials.reduce((s, t) => s + t.targets, 0);
        const hits = trials.reduce((s, t) => s + t.hits, 0);
        await prisma.therapySession.create({
          data: {
            patientId: patient.id,
            planId: plan.id,
            planDayLogId: dayLog.id,
            deviceId: await unitAt(d.centre, device),
            sourceDevice: device,
            sessionNumber,
            sessionDate: logDate,
            startTime: t0,
            endTime: new Date(t0.getTime() + minutes * 60_000),
            durationMinutes: minutes,
            totalTargets: targets,
            totalHits: hits,
            totalMisses: targets - hits,
            totalStars: trials.reduce((s, t) => s + t.stars, 0),
            trials: {
              create: trials.map((t) => ({
                trialNumberSession: t.n,
                trialType: "GAME" as const,
                gameCode: t.game,
                mechanism: t.mech,
                targets: t.targets,
                hits: t.hits,
                misses: t.targets - t.hits,
                stars: t.stars,
                durationSec: t.sec,
                moveTime: t.sec,
                successRate: Math.round((t.hits / t.targets) * 100),
              })),
            },
          },
        });
      }

      registry.push(registryEntry({ code: d.code, status: d.status, affectedSide: p.trainingSide, devices: p.devices }));

      // assessments, dated relative to the plan start; scores come from the real scale definitions
      for (const a of d.assessments) {
        const def = scales.get(a.scaleId)!;
        const date = addDays(start, a.day);
        const answers = answersAt(def, a.fraction, date, rng(`${d.code}:${a.scaleId}:${a.day}`));
        const primary = primaryScoreId(def, d.side);
        await prisma.assessment.create({
          data: {
            patientId: patient.id,
            scaleId: a.scaleId,
            scaleVersion: def.version,
            administeredById: therapist.id,
            assessmentDate: date,
            label: a.label,
            answers,
            scoreItem: primary,
            score: primary ? computeScores(def, answers)[primary] : null,
            maxScore: primary ? maxScore(def, primary) : null,
          },
        });
      }
    }

    for (const n of d.notes ?? []) {
      await prisma.patientNote.create({ data: { patientId: patient.id, authorId: (n.by === "consultant" ? consultant : therapist).id, text: n.text, noteDate: daysAgo(n.daysAgo) } });
    }
  }

  // 4. the laptops' view: patients.json + a folder per patient (nothing is deleted)
  const root = process.env.NEURODASH_DATA_DIR?.trim();
  if (root) {
    mkdirSync(root, { recursive: true });
    for (const d of PATIENTS) mkdirSync(join(root, d.code), { recursive: true });
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
    writeFileSync(join(root, "patients.json"), JSON.stringify({ version: 1, updated_at: local, patients: registry }, null, 2));
    console.log(`Wrote ${registry.length} patients to ${join(root, "patients.json")}`);
  }

  console.log(`Demo ready: ${PATIENTS.length} patients across Downtown Clinic and North Campus. Sign in with any seeded account (password neurodash123).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
