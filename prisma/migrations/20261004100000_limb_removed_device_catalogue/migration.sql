-- patients.json no longer carries a limb, so the column goes.
ALTER TABLE "patients" DROP COLUMN "limb";

-- Device catalogue is now PLUTO, MARS, ATOBOT, HYPERCUBE, NOARK, DYNABO, MOBBO and WEARABLE.
-- Old demo types are removed together with anything that only referred to them (units that already logged
-- sessions are kept, and so is their type).
DELETE FROM "device_requests" WHERE "device_type_id" IN ('ORION', 'VEGA', 'COSMOS', 'ATLAS');
DELETE FROM "plan_devices" WHERE "device_type_id" IN ('ORION', 'VEGA', 'COSMOS', 'ATLAS');
DELETE FROM "patient_devices" WHERE "device_type_id" IN ('ORION', 'VEGA', 'COSMOS', 'ATLAS');
DELETE FROM "devices" d WHERE d."device_type_id" IN ('ORION', 'VEGA', 'COSMOS', 'ATLAS')
  AND NOT EXISTS (SELECT 1 FROM "therapy_sessions" s WHERE s."device_id" = d."id");
DELETE FROM "device_types" t WHERE t."id" IN ('ORION', 'VEGA', 'COSMOS', 'ATLAS')
  AND NOT EXISTS (SELECT 1 FROM "devices" d WHERE d."device_type_id" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "session_trials" st JOIN "device_games" g ON g."id" = st."game_id" WHERE g."device_type_id" = t."id");
