-- Device goals of a therapy plan: a typed target per device, mechanism and task, with the baseline taken from the robotic assessment.
CREATE TABLE "plan_goals" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "device_type_id" TEXT NOT NULL,
    "mechanism" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "unit" TEXT,
    "limb" TEXT,
    "baseline_value" DOUBLE PRECISION,
    "baseline_timepoint" TEXT,
    "target_value" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plan_goals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plan_goals_plan_id_device_type_id_mechanism_task_key" ON "plan_goals"("plan_id", "device_type_id", "mechanism", "task");
ALTER TABLE "plan_goals" ADD CONSTRAINT "plan_goals_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "therapy_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_goals" ADD CONSTRAINT "plan_goals_device_type_id_fkey" FOREIGN KEY ("device_type_id") REFERENCES "device_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
