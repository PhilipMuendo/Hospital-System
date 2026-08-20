-- Performance indexes for a facility that accumulates records for years.
--
-- Everything here was chosen from an actual query plan, not from guessing.
-- At seed volume (122 patients) none of these change anything measurable;
-- the point is what happens at 200,000, which is an ordinary decade of
-- attendances for a mid-size Kenyan hospital.

-- ---------------------------------------------------------------------------
-- 1. Patient search
--
-- Reception searches with ILIKE '%term%'. A btree index cannot serve a leading
-- wildcard, so the planner was doing a Seq Scan on Patient for every keystroke
-- of a debounced search, on every desk, concurrently.
--
-- Trigram GIN indexes make that an index scan.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Patient_name_trgm_idx" ON "Patient" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Patient_opNumber_trgm_idx" ON "Patient" USING GIN ("opNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Patient_ipNumber_trgm_idx" ON "Patient" USING GIN ("ipNumber" gin_trgm_ops);
-- Phone is matched on a trailing fragment (last 9 digits), also a wildcard.
CREATE INDEX IF NOT EXISTS "Patient_phone_trgm_idx" ON "Patient" USING GIN ("phone" gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 2. Ward board
--
-- Filters wardId + status and orders by bed. Without the composite the planner
-- filters the whole Patient table for each ward view, which every nurse loads
-- at handover simultaneously.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "Patient_wardId_status_bed_idx" ON "Patient" ("wardId", "status", "bed");

-- Dashboard counts admitted patients hospital-wide.
CREATE INDEX IF NOT EXISTS "Patient_status_idx" ON "Patient" ("status");

-- ---------------------------------------------------------------------------
-- 3. Chart reads
--
-- A monitored ICU patient generates hundreds of observations a day. These are
-- always "latest N for this patient", so the index carries the sort order.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "LabResult_patientId_collectedAt_idx" ON "LabResult" ("patientId", "collectedAt" DESC);
CREATE INDEX IF NOT EXISTS "ImagingStudy_patientId_performedAt_idx" ON "ImagingStudy" ("patientId", "performedAt" DESC);
CREATE INDEX IF NOT EXISTS "BillingLine_patientId_createdAt_idx" ON "BillingLine" ("patientId", "createdAt" DESC);

-- Unreviewed results drive a ward-board badge; the partial index keeps it
-- small because the reviewed rows vastly outnumber the unreviewed ones.
CREATE INDEX IF NOT EXISTS "LabResult_unreviewed_idx" ON "LabResult" ("patientId") WHERE "reviewed" = false;

-- ---------------------------------------------------------------------------
-- 4. Queue
--
-- The hottest path in the building: every station polls its own queue and the
-- board polls all of them.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "QueueTicket_status_station_idx" ON "QueueTicket" ("status", "stationId");
CREATE INDEX IF NOT EXISTS "Visit_status_arrivedAt_idx" ON "Visit" ("status", "arrivedAt");

-- ---------------------------------------------------------------------------
-- 5. Worklists
--
-- Lab and imaging worklists filter on status across a table that only grows.
-- Partial indexes so the index tracks the open work, not the archive.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "LabOrderItem_open_idx" ON "LabOrderItem" ("status")
  WHERE "status" IN ('ORDERED', 'COLLECTED', 'IN_PROGRESS', 'RESULTED', 'REJECTED');
CREATE INDEX IF NOT EXISTS "ImagingOrder_open_idx" ON "ImagingOrder" ("status", "createdAt")
  WHERE "status" IN ('ORDERED', 'PERFORMED', 'REPORTED');

-- ---------------------------------------------------------------------------
-- 6. Audit
--
-- The fastest-growing table in the system — one row per request. Retrieval is
-- always newest-first, optionally filtered by actor, patient or action.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_desc_idx" ON "AuditLog" ("createdAt" DESC);

-- Drug round: "administrations for this item today".
CREATE INDEX IF NOT EXISTS "MedicationAdministration_item_at_idx"
  ON "MedicationAdministration" ("prescriptionItemId", "administeredAt" DESC);
