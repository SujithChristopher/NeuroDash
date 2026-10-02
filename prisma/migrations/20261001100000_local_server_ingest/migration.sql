-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "limb" TEXT;

-- AlterTable
ALTER TABLE "session_trials" ADD COLUMN     "duration_sec" INTEGER,
ADD COLUMN     "game_code" TEXT,
ADD COLUMN     "game_parameter" DOUBLE PRECISION,
ADD COLUMN     "move_time" DOUBLE PRECISION,
ADD COLUMN     "plane_angle" DOUBLE PRECISION,
ADD COLUMN     "reach_speed" DOUBLE PRECISION,
ADD COLUMN     "success_rate" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "therapy_sessions" ADD COLUMN     "source_device" TEXT,
ADD COLUMN     "source_key" TEXT;

-- CreateTable
CREATE TABLE "patient_devices" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "device_type_id" TEXT NOT NULL,
    "allocated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allocated_by" TEXT,

    CONSTRAINT "patient_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_configs" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "total_time" INTEGER,
    "ml" INTEGER,
    "ap" INTEGER,
    "mlap" INTEGER,
    "fore_arm_length" DOUBLE PRECISION,
    "upper_arm_length" DOUBLE PRECISION,
    "training_side" TEXT,
    "location" TEXT,
    "group_name" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingested_files" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "patient_code" TEXT,
    "device" TEXT,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingested_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_devices_device_type_id_idx" ON "patient_devices"("device_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_devices_patient_id_device_type_id_key" ON "patient_devices"("patient_id", "device_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_configs_patient_id_device_start_date_key" ON "device_configs"("patient_id", "device", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "ingested_files_path_key" ON "ingested_files"("path");

-- CreateIndex
CREATE INDEX "ingested_files_status_idx" ON "ingested_files"("status");

-- CreateIndex
CREATE UNIQUE INDEX "therapy_sessions_source_key_key" ON "therapy_sessions"("source_key");

-- AddForeignKey
ALTER TABLE "patient_devices" ADD CONSTRAINT "patient_devices_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_devices" ADD CONSTRAINT "patient_devices_device_type_id_fkey" FOREIGN KEY ("device_type_id") REFERENCES "device_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_devices" ADD CONSTRAINT "patient_devices_allocated_by_fkey" FOREIGN KEY ("allocated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_configs" ADD CONSTRAINT "device_configs_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

