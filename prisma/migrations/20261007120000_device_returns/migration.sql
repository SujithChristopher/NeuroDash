-- A centre asks to return a device; an engineer takes it back into stock.
CREATE TABLE "device_returns" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "location_id" TEXT,
    "requested_by" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "reason" TEXT,
    "engineer_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    CONSTRAINT "device_returns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "device_returns_device_id_status_idx" ON "device_returns"("device_id", "status");
CREATE INDEX "device_returns_status_idx" ON "device_returns"("status");
ALTER TABLE "device_returns" ADD CONSTRAINT "device_returns_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_returns" ADD CONSTRAINT "device_returns_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "device_returns" ADD CONSTRAINT "device_returns_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
