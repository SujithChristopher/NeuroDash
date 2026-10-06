-- Devices chosen for a patient's robotic assessment.
CREATE TABLE "assessment_devices" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "device_type_id" TEXT NOT NULL,
    "selected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "selected_by" TEXT,
    CONSTRAINT "assessment_devices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "assessment_devices_patient_id_device_type_id_key" ON "assessment_devices"("patient_id", "device_type_id");
CREATE INDEX "assessment_devices_device_type_id_idx" ON "assessment_devices"("device_type_id");
ALTER TABLE "assessment_devices" ADD CONSTRAINT "assessment_devices_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessment_devices" ADD CONSTRAINT "assessment_devices_device_type_id_fkey" FOREIGN KEY ("device_type_id") REFERENCES "device_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
