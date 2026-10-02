CREATE TABLE "patient_reports" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "storage" TEXT NOT NULL DEFAULT 'local',
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "patient_reports_patient_id_created_at_idx" ON "patient_reports"("patient_id", "created_at" DESC);

ALTER TABLE "patient_reports" ADD CONSTRAINT "patient_reports_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_reports" ADD CONSTRAINT "patient_reports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
