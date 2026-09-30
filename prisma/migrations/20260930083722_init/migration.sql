-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('THERAPIST', 'CONSULTANT', 'ENGINEER', 'ADMIN');

-- CreateEnum
CREATE TYPE "TrialType" AS ENUM ('GAME', 'AROM', 'PROM', 'APROM');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "display_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "title" TEXT,
    "email" TEXT NOT NULL,
    "initials" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "password_hash" TEXT NOT NULL,
    "must_reset_password" BOOLEAN NOT NULL DEFAULT false,
    "location_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "color_series" TEXT,

    CONSTRAINT "device_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_mechanisms" (
    "id" TEXT NOT NULL,
    "device_type_id" TEXT NOT NULL,
    "mechanism_name" TEXT NOT NULL,

    CONSTRAINT "device_mechanisms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_games" (
    "id" TEXT NOT NULL,
    "device_type_id" TEXT NOT NULL,
    "display_label" TEXT NOT NULL,

    CONSTRAINT "device_games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "display_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dob" DATE,
    "gender" TEXT,
    "contact_phone" TEXT,
    "emergency_contact" TEXT,
    "registration_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "therapist_id" TEXT NOT NULL,
    "diagnosis" TEXT,
    "affected_side" TEXT,
    "stroke_date" DATE,
    "mobility_status" TEXT,
    "therapy_goals" TEXT[],
    "initial_observations" TEXT,
    "clinical_info" TEXT,
    "status" TEXT NOT NULL DEFAULT 'New',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_documents" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "doc_type" TEXT,
    "upload_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" TEXT,
    "size_kb" INTEGER,
    "storage_ref" TEXT,
    "mime_type" TEXT,
    "data" BYTEA,
    "assessment_id" TEXT,

    CONSTRAINT "patient_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_notes" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "note_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "text" TEXT NOT NULL,

    CONSTRAINT "patient_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "scale_id" TEXT NOT NULL,
    "scale_version" INTEGER NOT NULL DEFAULT 1,
    "administered_by" TEXT,
    "assessment_date" DATE NOT NULL,
    "label" TEXT,
    "answers" JSONB NOT NULL,
    "score_item" TEXT,
    "score" DOUBLE PRECISION,
    "max_score" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapy_plans" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "daily_target_minutes" INTEGER NOT NULL,
    "target_sessions" INTEGER,
    "goals" TEXT[],
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "therapy_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_devices" (
    "plan_id" TEXT NOT NULL,
    "device_type_id" TEXT NOT NULL,

    CONSTRAINT "plan_devices_pkey" PRIMARY KEY ("plan_id","device_type_id")
);

-- CreateTable
CREATE TABLE "plan_revisions" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "field_changed" TEXT NOT NULL,
    "previous_value" TEXT,
    "new_value" TEXT,
    "modified_by" TEXT NOT NULL,
    "modified_by_role" TEXT NOT NULL,
    "modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "plan_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_day_log" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "day_number" INTEGER NOT NULL,
    "log_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "target_minutes" INTEGER NOT NULL,
    "actual_minutes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "plan_day_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "display_code" TEXT NOT NULL,
    "device_type_id" TEXT NOT NULL,
    "serial_number" TEXT NOT NULL,
    "firmware_version" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Available',
    "location" TEXT,
    "registered_on" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_patient_id" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_assignments" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "assigned_date" DATE NOT NULL,
    "returned_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'In Use',
    "assigned_by" TEXT,

    CONSTRAINT "device_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_requests" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "therapist_id" TEXT NOT NULL,
    "device_type_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Pending Engineer Review',
    "engineer_id" TEXT,
    "notes" TEXT,
    "cleared_at" TIMESTAMP(3),

    CONSTRAINT "device_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_issues" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_by" TEXT NOT NULL,
    "engineer_id" TEXT,
    "diagnostics" TEXT,
    "parts_replaced" TEXT,
    "resolution" TEXT,
    "resolved_at" TIMESTAMP(3),
    "cleared_at" TIMESTAMP(3),
    "verified_by" TEXT,

    CONSTRAINT "device_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_troubleshooting_log" (
    "id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "logged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logged_by" TEXT NOT NULL,
    "note" TEXT NOT NULL,

    CONSTRAINT "issue_troubleshooting_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_maintenance" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "maintenance_date" DATE NOT NULL,
    "maintenance_type" TEXT NOT NULL,
    "engineer_id" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "device_maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_events" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "event_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "device_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapy_sessions" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "plan_id" TEXT,
    "plan_day_log_id" TEXT,
    "device_id" TEXT NOT NULL,
    "session_number" INTEGER,
    "session_date" DATE NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "duration_minutes" DECIMAL(6,2),
    "total_targets" INTEGER NOT NULL DEFAULT 0,
    "total_hits" INTEGER NOT NULL DEFAULT 0,
    "total_misses" INTEGER NOT NULL DEFAULT 0,
    "total_stars" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "therapy_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_notes" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "image_data_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_trials" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "trial_number_session" INTEGER NOT NULL,
    "trial_number_day" INTEGER,
    "trial_type" "TrialType" NOT NULL,
    "game_id" TEXT,
    "mechanism" TEXT,
    "targets" INTEGER NOT NULL,
    "hits" INTEGER NOT NULL,
    "misses" INTEGER NOT NULL,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "start_time" TIMESTAMP(3),
    "stop_time" TIMESTAMP(3),
    "cumulative_targets" INTEGER,
    "cumulative_hits" INTEGER,
    "cumulative_misses" INTEGER,
    "cumulative_stars" INTEGER,
    "raw_data_ref" TEXT,

    CONSTRAINT "session_trials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "target_role" "UserRole",
    "target_user_id" TEXT,
    "notif_type" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'info',
    "icon" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "link" JSONB,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previous_value" JSONB,
    "new_value" JSONB,
    "notes" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'access',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_display_code_key" ON "users"("display_code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "locations_name_key" ON "locations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "patients_display_code_key" ON "patients"("display_code");

-- CreateIndex
CREATE INDEX "patients_therapist_id_idx" ON "patients"("therapist_id");

-- CreateIndex
CREATE INDEX "patients_status_idx" ON "patients"("status");

-- CreateIndex
CREATE INDEX "patients_registration_date_idx" ON "patients"("registration_date");

-- CreateIndex
CREATE INDEX "patient_documents_patient_id_idx" ON "patient_documents"("patient_id");

-- CreateIndex
CREATE INDEX "patient_documents_assessment_id_idx" ON "patient_documents"("assessment_id");

-- CreateIndex
CREATE INDEX "patient_notes_patient_id_note_date_idx" ON "patient_notes"("patient_id", "note_date" DESC);

-- CreateIndex
CREATE INDEX "assessments_patient_id_assessment_date_idx" ON "assessments"("patient_id", "assessment_date");

-- CreateIndex
CREATE INDEX "assessments_scale_id_idx" ON "assessments"("scale_id");

-- CreateIndex
CREATE INDEX "therapy_plans_patient_id_idx" ON "therapy_plans"("patient_id");

-- CreateIndex
CREATE INDEX "therapy_plans_status_idx" ON "therapy_plans"("status");

-- CreateIndex
CREATE INDEX "plan_revisions_plan_id_modified_at_idx" ON "plan_revisions"("plan_id", "modified_at");

-- CreateIndex
CREATE INDEX "plan_day_log_plan_id_log_date_idx" ON "plan_day_log"("plan_id", "log_date");

-- CreateIndex
CREATE UNIQUE INDEX "plan_day_log_plan_id_day_number_key" ON "plan_day_log"("plan_id", "day_number");

-- CreateIndex
CREATE UNIQUE INDEX "devices_display_code_key" ON "devices"("display_code");

-- CreateIndex
CREATE INDEX "devices_device_type_id_idx" ON "devices"("device_type_id");

-- CreateIndex
CREATE INDEX "devices_status_idx" ON "devices"("status");

-- CreateIndex
CREATE INDEX "devices_current_patient_id_idx" ON "devices"("current_patient_id");

-- CreateIndex
CREATE INDEX "device_assignments_device_id_idx" ON "device_assignments"("device_id");

-- CreateIndex
CREATE INDEX "device_assignments_patient_id_idx" ON "device_assignments"("patient_id");

-- CreateIndex
CREATE INDEX "device_requests_status_idx" ON "device_requests"("status");

-- CreateIndex
CREATE INDEX "device_requests_therapist_id_idx" ON "device_requests"("therapist_id");

-- CreateIndex
CREATE INDEX "device_issues_device_id_idx" ON "device_issues"("device_id");

-- CreateIndex
CREATE INDEX "device_issues_status_idx" ON "device_issues"("status");

-- CreateIndex
CREATE INDEX "device_issues_severity_idx" ON "device_issues"("severity");

-- CreateIndex
CREATE INDEX "issue_troubleshooting_log_issue_id_logged_at_idx" ON "issue_troubleshooting_log"("issue_id", "logged_at");

-- CreateIndex
CREATE INDEX "device_maintenance_device_id_maintenance_date_idx" ON "device_maintenance"("device_id", "maintenance_date" DESC);

-- CreateIndex
CREATE INDEX "device_events_device_id_event_date_idx" ON "device_events"("device_id", "event_date" DESC);

-- CreateIndex
CREATE INDEX "therapy_sessions_patient_id_session_date_idx" ON "therapy_sessions"("patient_id", "session_date");

-- CreateIndex
CREATE INDEX "therapy_sessions_device_id_session_date_idx" ON "therapy_sessions"("device_id", "session_date");

-- CreateIndex
CREATE INDEX "therapy_sessions_plan_id_idx" ON "therapy_sessions"("plan_id");

-- CreateIndex
CREATE INDEX "session_notes_session_id_created_at_idx" ON "session_notes"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "session_trials_session_id_trial_number_session_idx" ON "session_trials"("session_id", "trial_number_session");

-- CreateIndex
CREATE INDEX "notifications_target_user_id_is_read_idx" ON "notifications"("target_user_id", "is_read");

-- CreateIndex
CREATE INDEX "notifications_target_role_is_read_idx" ON "notifications"("target_role", "is_read");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_occurred_at_idx" ON "audit_log"("actor_user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log"("occurred_at" DESC);

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_mechanisms" ADD CONSTRAINT "device_mechanisms_device_type_id_fkey" FOREIGN KEY ("device_type_id") REFERENCES "device_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_games" ADD CONSTRAINT "device_games_device_type_id_fkey" FOREIGN KEY ("device_type_id") REFERENCES "device_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_therapist_id_fkey" FOREIGN KEY ("therapist_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_notes" ADD CONSTRAINT "patient_notes_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_notes" ADD CONSTRAINT "patient_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_administered_by_fkey" FOREIGN KEY ("administered_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_plans" ADD CONSTRAINT "therapy_plans_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_plans" ADD CONSTRAINT "therapy_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_devices" ADD CONSTRAINT "plan_devices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "therapy_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_devices" ADD CONSTRAINT "plan_devices_device_type_id_fkey" FOREIGN KEY ("device_type_id") REFERENCES "device_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_revisions" ADD CONSTRAINT "plan_revisions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "therapy_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_revisions" ADD CONSTRAINT "plan_revisions_modified_by_fkey" FOREIGN KEY ("modified_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_day_log" ADD CONSTRAINT "plan_day_log_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "therapy_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_device_type_id_fkey" FOREIGN KEY ("device_type_id") REFERENCES "device_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_current_patient_id_fkey" FOREIGN KEY ("current_patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_requests" ADD CONSTRAINT "device_requests_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_requests" ADD CONSTRAINT "device_requests_therapist_id_fkey" FOREIGN KEY ("therapist_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_requests" ADD CONSTRAINT "device_requests_device_type_id_fkey" FOREIGN KEY ("device_type_id") REFERENCES "device_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_requests" ADD CONSTRAINT "device_requests_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_issues" ADD CONSTRAINT "device_issues_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_issues" ADD CONSTRAINT "device_issues_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_issues" ADD CONSTRAINT "device_issues_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_issues" ADD CONSTRAINT "device_issues_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_troubleshooting_log" ADD CONSTRAINT "issue_troubleshooting_log_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "device_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_troubleshooting_log" ADD CONSTRAINT "issue_troubleshooting_log_logged_by_fkey" FOREIGN KEY ("logged_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_maintenance" ADD CONSTRAINT "device_maintenance_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_maintenance" ADD CONSTRAINT "device_maintenance_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "therapy_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_plan_day_log_id_fkey" FOREIGN KEY ("plan_day_log_id") REFERENCES "plan_day_log"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_notes" ADD CONSTRAINT "session_notes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "therapy_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_notes" ADD CONSTRAINT "session_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_trials" ADD CONSTRAINT "session_trials_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "therapy_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_trials" ADD CONSTRAINT "session_trials_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "device_games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
