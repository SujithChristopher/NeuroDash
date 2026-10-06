-- Postgres cut the unique index name of robotic_assessments to 63 characters when it was created; give it the name Prisma expects.
-- (This replaces 20261006054509_new_v, which sorted before the table existed and so failed on a fresh database. IF EXISTS keeps it
-- harmless on a database that already has the new name.)
ALTER INDEX IF EXISTS "robotic_assessments_patient_id_device_type_id_limb_timepoint_ke" RENAME TO "robotic_assessments_patient_id_device_type_id_limb_timepoin_key";
