ALTER TABLE "locations" ADD COLUMN "engineer_id" TEXT;
ALTER TABLE "locations" ADD CONSTRAINT "locations_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
