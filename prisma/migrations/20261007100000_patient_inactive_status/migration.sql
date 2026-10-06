-- Patient status is now Inactive (no therapy plan) | Active (has a plan) | Paused | Completed | Discontinued.
-- "Ongoing" is gone: those patients are simply Active; Active patients without a plan become Inactive.
ALTER TABLE "patients" ALTER COLUMN "status" SET DEFAULT 'Inactive';
UPDATE "patients" SET "status" = 'Active' WHERE "status" = 'Ongoing';
UPDATE "patients" p SET "status" = 'Inactive'
WHERE p."status" = 'Active' AND NOT EXISTS (SELECT 1 FROM "therapy_plans" t WHERE t."patient_id" = p."id");
