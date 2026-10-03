import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allItems, answerableItems, computeScores, maxScore, primaryScoreId } from "../src/lib/scales/evaluate";
import type { Answers, ScaleDef } from "../src/lib/scales/types";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Demo password for every seeded account — shared across roles so coworkers
// can log in as any of the demo users listed below.
const DEMO_PASSWORD = "neurodash123";

// Two sites — Priya + Vikram staff CMC Ranipet together (so "secondary
// therapist edits Priya's patient's plan" is directly demonstrable); Rohan
// is alone at CMC Vellore (no consultant yet, to show an under-staffed
// location in the admin Locations list).
const LOCATIONS = [
  { id: "downtown", name: "CMC Ranipet" },
  { id: "north", name: "CMC Vellore" },
];

const USERS = [
  { id: "U-T1", role: "THERAPIST" as const, name: "Dr. Priya Nair", title: "Senior Occupational Therapist", email: "priya.nair@neurodash.care", initials: "PN", location: "downtown" },
  { id: "U-T2", role: "THERAPIST" as const, name: "Dr. Rohan Mehta", title: "Physiotherapist", email: "rohan.mehta@neurodash.care", initials: "RM", location: "north" },
  { id: "U-C1", role: "CONSULTANT" as const, name: "Dr. Vikram Suresh", title: "Senior Neuro-Rehabilitation Consultant", email: "vikram.suresh@neurodash.care", initials: "VS", location: "downtown" },
  { id: "U-E1", role: "ENGINEER" as const, name: "Arjun Rao", title: "Biomedical Engineer", email: "arjun.rao@neurodash.care", initials: "AR", location: null },
  { id: "U-A1", role: "ADMIN" as const, name: "Homer", title: "System Administrator", email: "biorehabilitationgroup@gmail.com", initials: "HA", location: null },
];

const DEVICE_TYPES = [
  { id: "PLUTO", name: "Pluto", category: "Hand & Wrist Rehabilitation Robot", colorSeries: "series-1",
    mechanisms: ["Wrist Flexion/Extension", "Forearm Pronation/Supination", "Grip Cylindrical"], games: [{ id: "HAT", label: "HAT — Hand Trainer Arcade" }, { id: "FruitBasket", label: "Fruit Basket" }] },
  { id: "MARS", name: "Mars", category: "Arm Reaching Robot", colorSeries: "series-2",
    mechanisms: ["Shoulder Flexion", "Elbow Extension", "Reach & Grasp"], games: [{ id: "PongGame", label: "PongGame" }, { id: "TukTuk", label: "TukTuk Drive" }] },
  // Training devices the local server (localserver/s2.py) accepts uploads from. Categories are generic until the
  // clinical team supplies the proper descriptions.
  { id: "ATOBOT", name: "Atobot", category: "Rehabilitation training device", colorSeries: "series-10", mechanisms: [], games: [] },
  { id: "HYPERCUBE", name: "Hypercube", category: "Rehabilitation training device", colorSeries: "series-9", mechanisms: [], games: [] },
  { id: "NOARK", name: "Noark", category: "Rehabilitation training device", colorSeries: "series-7", mechanisms: [], games: [] },
  { id: "DYNABO", name: "Dynabo", category: "Rehabilitation training device", colorSeries: "series-3", mechanisms: [], games: [] },
  { id: "MOBBO", name: "Mobbo", category: "Rehabilitation training device", colorSeries: "series-8", mechanisms: [], games: [] },
  { id: "WEARABLE", name: "Wearable devices", category: "Wearable sensors", colorSeries: "series-4", mechanisms: [], games: [] },
];


async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // The demo centres used to be called "Downtown Clinic" and "North Campus": rename them in place on older databases
  // (otherwise the upsert below would create two new centres next to them).
  await prisma.location.updateMany({ where: { name: "Downtown Clinic" }, data: { name: "CMC Ranipet" } });
  await prisma.location.updateMany({ where: { name: "North Campus" }, data: { name: "CMC Vellore" } });

  const locationIdByKey = new Map<string, string>();
  for (const l of LOCATIONS) {
    const location = await prisma.location.upsert({ where: { name: l.name }, update: {}, create: { name: l.name } });
    locationIdByKey.set(l.id, location.id);
  }

  for (const u of USERS) {
    const locationId = u.location ? locationIdByKey.get(u.location) : null;
    await prisma.user.upsert({
      where: { email: u.email },
      update: { locationId },
      create: { displayCode: u.id, name: u.name, role: u.role, title: u.title, email: u.email, initials: u.initials, passwordHash, locationId },
    });
  }

  for (const dt of DEVICE_TYPES) {
    await prisma.deviceType.upsert({
      where: { id: dt.id },
      update: { colorSeries: dt.colorSeries }, // re-seeding corrects the colour; reference data is otherwise left alone
      create: {
        id: dt.id,
        name: dt.name,
        category: dt.category,
        colorSeries: dt.colorSeries,
        mechanisms: { create: dt.mechanisms.map((m) => ({ mechanismName: m })) },
        games: { create: dt.games.map((g) => ({ id: g.id, displayLabel: g.label })) },
      },
    });
  }

  function addDays(date: Date, n: number): Date {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  }
  function utcMidnight(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  const priya = await prisma.user.findUniqueOrThrow({ where: { email: "priya.nair@neurodash.care" } });
  const downtownId = locationIdByKey.get("downtown")!;
  const demoEngineer = await prisma.user.findUniqueOrThrow({ where: { email: "arjun.rao@neurodash.care" } });
  await prisma.location.updateMany({ where: { engineerId: null }, data: { engineerId: demoEngineer.id } });

  const patient = await prisma.patient.upsert({
    where: { displayCode: "P-10124" },
    update: { status: "Ongoing" },
    create: {
      displayCode: "P-10124",
      name: "Ananya R.",
      dob: new Date("1968-04-12"),
      gender: "Female",
      contactPhone: "+91 98765 43210",
      therapistId: priya.id,
      diagnosis: "Ischemic Stroke — Right MCA territory",
      affectedSide: "Left",
      strokeDate: new Date("2026-06-02"),
      mobilityStatus: "Ambulatory with cane",
      therapyGoals: ["Improve functional grasp for self-feeding", "Restore independent reach above shoulder height"],
      initialObservations: "Reduced grip strength on left hand; moderate spasticity.",
      status: "Ongoing",
    },
  });

  const PLAN_ID = "00000000-0000-0000-0000-000000000001";
  const PLAN_DURATION_DAYS = 42;
  const ELAPSED_DAYS = 35; // days 1..35 have happened (today is day 35); the rest are "upcoming"
  const PLAN_DAILY_TARGET_MIN = 75;
  const planStartDate = utcMidnight(addDays(new Date(), -(ELAPSED_DAYS - 1)));

  const plan = await prisma.therapyPlan.upsert({
    where: { id: PLAN_ID },
    update: {
      startDate: planStartDate,
      durationDays: PLAN_DURATION_DAYS,
      dailyTargetMinutes: PLAN_DAILY_TARGET_MIN,
    },
    create: {
      id: PLAN_ID,
      patientId: patient.id,
      name: "Upper-Limb Motor Recovery Plan",
      startDate: planStartDate,
      durationDays: PLAN_DURATION_DAYS,
      dailyTargetMinutes: PLAN_DAILY_TARGET_MIN,
      targetSessions: 60,
      goals: ["Improve functional grasp for self-feeding"],
      status: "Active",
      createdById: priya.id,
    },
  });

  // Multi-device plan — exercises the many-to-many plan/device-type selection. Synced
  // unconditionally (not just on first create) so a pre-existing plan row from an older
  // seed run still ends up with the right devices.
  await prisma.planDevice.deleteMany({ where: { planId: PLAN_ID } });
  await prisma.planDevice.createMany({
    data: [
      { planId: PLAN_ID, deviceTypeId: "PLUTO" },
      { planId: PLAN_ID, deviceTypeId: "MARS" },
    ],
  });

  // Training devices allocated to the demo patient (mirrors her plan; also what patients.json would carry).
  for (const deviceTypeId of ["PLUTO", "MARS"]) {
    await prisma.patientDevice.upsert({
      where: { patientId_deviceTypeId: { patientId: patient.id, deviceTypeId } },
      update: {},
      create: { patientId: patient.id, deviceTypeId, allocatedById: priya.id },
    });
  }

  // The patient whose real MARS + PLUTO sessions are in localserver/testdata (load them with `npm run demo:data`).
  const demo = await prisma.patient.upsert({
    where: { displayCode: "HOCMCV002" },
    update: {},
    create: {
      displayCode: "HOCMCV002",
      name: "Demo Trainee",
      therapistId: priya.id,
      diagnosis: "Hand rehabilitation (demo data)",
      affectedSide: "Right",
      status: "Active",
    },
  });
  for (const deviceTypeId of ["PLUTO", "MARS"]) {
    await prisma.patientDevice.upsert({
      where: { patientId_deviceTypeId: { patientId: demo.id, deviceTypeId } },
      update: {},
      create: { patientId: demo.id, deviceTypeId, allocatedById: priya.id },
    });
  }

  const pluto = await prisma.device.upsert({
    where: { displayCode: "PLUTO-001" },
    update: {},
    create: {
      displayCode: "PLUTO-001",
      deviceTypeId: "PLUTO",
      serialNumber: "SN-PL-0001",
      firmwareVersion: "2.3.1",
      status: "Available",
      location: "Therapy Bay 1",
      locationId: downtownId,
    },
  });

  const mars = await prisma.device.upsert({
    where: { displayCode: "MARS-001" },
    update: {},
    create: {
      displayCode: "MARS-001",
      deviceTypeId: "MARS",
      serialNumber: "SN-MA-0001",
      firmwareVersion: "3.1.0",
      status: "Available",
      location: "Therapy Bay 3",
      locationId: downtownId,
    },
  });

  // A few spare units in varied states so the fleet pages aren't one-note.
  for (const d of [
    { displayCode: "MARS-002", deviceTypeId: "MARS", serialNumber: "SN-MA-0002", firmwareVersion: "3.1.0", status: "Available", location: "Therapy Bay 3" },
    { displayCode: "PLUTO-002", deviceTypeId: "PLUTO", serialNumber: "SN-PL-0002", firmwareVersion: "2.3.1", status: "Available", location: "Therapy Bay 1", locationId: downtownId },
    { displayCode: "DYNABO-001", deviceTypeId: "DYNABO", serialNumber: "SN-DY-0001", firmwareVersion: "1.0.0", status: "Available", location: "Therapy Bay 4" },
    { displayCode: "WEARABLE-001", deviceTypeId: "WEARABLE", serialNumber: "SN-WE-0001", firmwareVersion: "1.0.0", status: "Available", location: "Therapy Bay 4", locationId: downtownId },
  ]) {
    await prisma.device.upsert({ where: { displayCode: d.displayCode }, update: { locationId: d.locationId ?? null }, create: d });
  }

  const orion = await prisma.device.upsert({
    where: { displayCode: "NOARK-001" },
    update: {},
    create: {
      displayCode: "NOARK-001",
      deviceTypeId: "NOARK",
      serialNumber: "SN-NO-0001",
      firmwareVersion: "1.8.0",
      status: "Issue Detected",
      location: "Therapy Bay 2",
      locationId: downtownId,
    },
  });

  const secondPatient = await prisma.patient.upsert({
    where: { displayCode: "P-20551" },
    update: {},
    create: {
      displayCode: "P-20551",
      name: "Rajiv K.",
      dob: new Date("1975-11-02"),
      gender: "Male",
      therapistId: priya.id,
      diagnosis: "Traumatic Brain Injury — Diffuse Axonal",
      affectedSide: "Bilateral",
      mobilityStatus: "Ambulatory with walker",
      therapyGoals: ["Improve bimanual coordination"],
      initialObservations: "Pending initial clinical observation.",
      status: "Active",
    },
  });

  const existingIssue = await prisma.deviceIssue.findFirst({ where: { deviceId: orion.id, status: "Open" } });
  if (!existingIssue) {
    await prisma.deviceIssue.create({
      data: { deviceId: orion.id, description: "Grip sensor reports intermittent zero readings.", severity: "Medium", openedById: priya.id },
    });
  }

  const existingRequest = await prisma.deviceRequest.findFirst({ where: { locationId: downtownId, deviceTypeId: "MARS" } });
  if (!existingRequest) {
    await prisma.deviceRequest.create({
      data: { locationId: downtownId, therapistId: priya.id, deviceTypeId: "MARS", notes: "A second MARS unit for the centre." },
    });
  }

  const arjun = await prisma.user.findUniqueOrThrow({ where: { email: "arjun.rao@neurodash.care" } });
  const existingNotification = await prisma.notification.findFirst({ where: { targetRole: "ENGINEER", notifType: "device" } });
  if (!existingNotification) {
    await prisma.notification.create({
      data: {
        targetRole: "ENGINEER",
        notifType: "device",
        tone: "critical",
        icon: "alert",
        title: "Device issue reported",
        description: "NOARK-001 flagged with a Medium severity issue — pending engineer review.",
        link: { page: "device-issues" },
      },
    });
    await prisma.notification.create({
      data: {
        targetUserId: arjun.id,
        notifType: "request",
        tone: "info",
        icon: "box",
        title: "New device request",
        description: "Dr. Priya Nair requested a Mars unit for CMC Ranipet.",
        link: { page: "devices" },
      },
    });
  }

  // Generate 35 days of plan history: mostly "done", a couple of "missed",
  // with a matching therapy session (+ trials) on any day actual therapy happened, and
  // accuracy trending upward over the plan — enough real data for the overview charts
  // to be meaningful instead of empty states.
  // Regenerate from scratch every run so plan/session/assessment history always matches
  // today's date (the plan is defined as "the last PLAN_DURATION_DAYS days" above).
  await prisma.sessionTrial.deleteMany({ where: { session: { planId: plan.id } } });
  await prisma.therapySession.deleteMany({ where: { planId: plan.id } });
  await prisma.assessment.deleteMany({ where: { patientId: patient.id, scaleId: "fma" } });
  await prisma.planDayLog.deleteMany({ where: { planId: plan.id } });
  {
    let sessionNumber = 0;
    for (let day = 0; day < PLAN_DURATION_DAYS; day++) {
      const logDate = addDays(planStartDate, day);
      const missed = day === 8 || day === 19; // a couple of skipped days, like real adherence
      const partial = day === 3 || day === 27;
      const upcoming = day >= ELAPSED_DAYS;
      const status = upcoming ? "upcoming" : missed ? "missed" : "done";
      const actualMinutes = upcoming || missed ? 0 : partial ? Math.round(PLAN_DAILY_TARGET_MIN * 0.5) : PLAN_DAILY_TARGET_MIN + (day % 5) - 2;

      const dayLog = await prisma.planDayLog.create({
        data: { planId: plan.id, dayNumber: day + 1, logDate, status, targetMinutes: PLAN_DAILY_TARGET_MIN, actualMinutes },
      });

      if (status !== "missed" && status !== "upcoming") {
        sessionNumber++;
        const useMars = day % 3 === 2;
        // accuracy trends from ~55% to ~88% across the plan
        const progress = day / (PLAN_DURATION_DAYS - 1);
        const baseAccuracy = 0.55 + progress * 0.33;
        const targets = 40;
        const hits = Math.round(targets * Math.min(0.97, baseAccuracy + (day % 3 === 0 ? 0.03 : -0.02)));
        const misses = targets - hits;

        await prisma.therapySession.create({
          data: {
            patientId: patient.id,
            planId: plan.id,
            planDayLogId: dayLog.id,
            deviceId: useMars ? mars.id : pluto.id,
            sessionNumber,
            sessionDate: logDate,
            startTime: new Date(logDate.getTime() + 10 * 3600 * 1000),
            endTime: new Date(logDate.getTime() + 10 * 3600 * 1000 + actualMinutes * 60 * 1000),
            durationMinutes: actualMinutes,
            totalTargets: targets,
            totalHits: hits,
            totalMisses: misses,
            totalStars: hits / targets > 0.8 ? 3 : hits / targets > 0.6 ? 2 : 1,
            trials: {
              create: [
                useMars
                  ? { trialNumberSession: 1, trialType: "GAME" as const, gameId: "PongGame", mechanism: "Shoulder Flexion", targets, hits, misses }
                  : { trialNumberSession: 1, trialType: "GAME" as const, gameId: "HAT", mechanism: "Wrist Flexion/Extension", targets, hits, misses },
              ],
            },
          },
        });
      }
    }

    // Baseline + follow-up FMA assessments built from the real scale definition, scores rising alongside
    // session accuracy. Answers use REDCap variable names; scores come from the same evaluator the app uses.
    const fma = JSON.parse(readFileSync(join(process.cwd(), "clinical_scales", "neuro", "fma.json"), "utf8")) as ScaleDef;
    const assessmentDays = [0, 7, 14, 21, 28, ELAPSED_DAYS - 1];
    const scoreFractions = [0.4, 0.5, 0.62, 0.7, 0.78, 0.85];
    const primary = primaryScoreId(fma, patient.affectedSide);
    for (let i = 0; i < assessmentDays.length; i++) {
      const fraction = scoreFractions[i]!;
      const answers: Answers = {};
      for (const it of answerableItems(fma)) {
        if (it.type === "single_choice" && it.choices?.length) {
          const nums = it.choices.map((c) => c.value).filter((v): v is number => typeof v === "number");
          if (nums.length) answers[it.id] = nums.reduce((best, v) => (Math.abs(v - Math.max(...nums) * fraction) < Math.abs(best - Math.max(...nums) * fraction) ? v : best), nums[0]!);
        }
      }
      const date = addDays(planStartDate, assessmentDays[i]!);
      for (const it of allItems(fma)) if (it.type === "date") answers[it.id] = date.toISOString().slice(0, 10);
      await prisma.assessment.create({
        data: {
          patientId: patient.id,
          scaleId: "fma",
          scaleVersion: fma.version,
          administeredById: priya.id,
          assessmentDate: date,
          label: i === 0 ? "Baseline" : `Day ${assessmentDays[i]}`,
          answers,
          scoreItem: primary,
          score: primary ? computeScores(fma, answers)[primary] : null,
          maxScore: primary ? maxScore(fma, primary) : null,
        },
      });
    }
  }

  console.log("Seed complete. Demo login password for every seeded user:", DEMO_PASSWORD);
  console.log("Demo emails:", USERS.map((u) => u.email).join(", "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
