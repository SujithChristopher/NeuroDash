-- Devices belong to a centre (location); requests are made for a centre, not for one patient.

ALTER TABLE "devices" ADD COLUMN "location_id" TEXT;

-- Keep where units already were: the centre of the therapist who had the unit's patient.
UPDATE "devices" d SET "location_id" = u."location_id"
  FROM "patients" p JOIN "users" u ON u."id" = p."therapist_id"
 WHERE d."current_patient_id" = p."id" AND u."location_id" IS NOT NULL;
UPDATE "devices" SET "status" = 'Available' WHERE "status" = 'In Use';

ALTER TABLE "devices" DROP COLUMN "current_patient_id";
DROP INDEX IF EXISTS "devices_current_patient_id_idx";
CREATE INDEX "devices_location_id_idx" ON "devices"("location_id");
ALTER TABLE "devices" ADD CONSTRAINT "devices_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE "device_assignments";

ALTER TABLE "device_requests" ADD COLUMN "location_id" TEXT;
UPDATE "device_requests" r SET "location_id" = u."location_id" FROM "users" u WHERE u."id" = r."therapist_id";
DELETE FROM "device_requests" WHERE "location_id" IS NULL;
ALTER TABLE "device_requests" ALTER COLUMN "location_id" SET NOT NULL;
ALTER TABLE "device_requests" DROP COLUMN "patient_id";
ALTER TABLE "device_requests" ADD CONSTRAINT "device_requests_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
