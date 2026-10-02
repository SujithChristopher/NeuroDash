-- Patient status is now Active | Ongoing | Paused | Completed | Discontinued.
ALTER TABLE "patients" ALTER COLUMN "status" SET DEFAULT 'Active';
UPDATE "patients" SET "status" = 'Active' WHERE "status" IN ('New', 'Assessment Pending');
UPDATE "patients" p SET "status" = 'Ongoing'
 WHERE p."status" = 'Active'
   AND EXISTS (SELECT 1 FROM "patient_devices" d WHERE d."patient_id" = p."id")
   AND EXISTS (SELECT 1 FROM "therapy_sessions" s WHERE s."patient_id" = p."id");

-- Which affected side a plan trains.
ALTER TABLE "therapy_plans" ADD COLUMN "training_side" TEXT;

-- The daily timeline no longer has a "partial" state: a day with any training is done.
UPDATE "plan_day_log" SET "status" = 'done' WHERE "status" = 'partial';
