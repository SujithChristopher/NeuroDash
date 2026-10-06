-- What the devices measured in a robotic assessment (PLUTO range of motion, MARS reach range), one row per timepoint.
CREATE TABLE "robotic_assessments" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "device_type_id" TEXT NOT NULL,
    "limb" TEXT NOT NULL,
    "timepoint" TEXT NOT NULL,
    "assessed_at" TIMESTAMP(3) NOT NULL,
    "locked_at" TIMESTAMP(3),
    "mechanisms" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source_path" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "robotic_assessments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "robotic_assessments_patient_id_device_type_id_limb_timepoint_key" ON "robotic_assessments"("patient_id", "device_type_id", "limb", "timepoint");
CREATE INDEX "robotic_assessments_patient_id_assessed_at_idx" ON "robotic_assessments"("patient_id", "assessed_at");
ALTER TABLE "robotic_assessments" ADD CONSTRAINT "robotic_assessments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "robotic_assessments" ADD CONSTRAINT "robotic_assessments_device_type_id_fkey" FOREIGN KEY ("device_type_id") REFERENCES "device_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "robotic_assessment_results" (
    "id" TEXT NOT NULL,
    "assessment_id" TEXT NOT NULL,
    "mechanism" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "unit" TEXT,
    "rom_min" DOUBLE PRECISION,
    "rom_max" DOUBLE PRECISION,
    "rom_range" DOUBLE PRECISION,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "comment" TEXT,
    "extra" JSONB,
    CONSTRAINT "robotic_assessment_results_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "robotic_assessment_results_assessment_id_mechanism_task_key" ON "robotic_assessment_results"("assessment_id", "mechanism", "task");
ALTER TABLE "robotic_assessment_results" ADD CONSTRAINT "robotic_assessment_results_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "robotic_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
