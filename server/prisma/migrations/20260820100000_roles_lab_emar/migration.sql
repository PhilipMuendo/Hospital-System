-- CreateEnum
CREATE TYPE "LabOrderStatus" AS ENUM ('ORDERED', 'COLLECTED', 'IN_PROGRESS', 'RESULTED', 'VERIFIED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LabUrgency" AS ENUM ('ROUTINE', 'URGENT', 'STAT');

-- CreateEnum
CREATE TYPE "AdministrationStatus" AS ENUM ('GIVEN', 'OMITTED', 'REFUSED', 'GIVEN_LATE');

-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.



-- AlterTable
ALTER TABLE "PrescriptionItem" ADD COLUMN     "dosesPerDay" INTEGER;

-- CreateTable
CREATE TABLE "LabTest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "specimen" TEXT NOT NULL,
    "unit" TEXT,
    "refLow" DOUBLE PRECISION,
    "refHigh" DOUBLE PRECISION,
    "refRange" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "turnaroundMins" INTEGER NOT NULL DEFAULT 120,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabOrder" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "visitId" TEXT,
    "orderedById" TEXT NOT NULL,
    "urgency" "LabUrgency" NOT NULL DEFAULT 'ROUTINE',
    "clinicalNotes" TEXT,
    "status" "LabOrderStatus" NOT NULL DEFAULT 'ORDERED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "labTestId" TEXT NOT NULL,
    "status" "LabOrderStatus" NOT NULL DEFAULT 'ORDERED',
    "specimenLabel" TEXT,
    "collectedAt" TIMESTAMP(3),
    "collectedById" TEXT,
    "rejectionReason" TEXT,
    "resultValue" TEXT,
    "flag" "LabFlag",
    "resultedAt" TIMESTAMP(3),
    "resultedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "labResultId" TEXT,

    CONSTRAINT "LabOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationAdministration" (
    "id" TEXT NOT NULL,
    "prescriptionItemId" TEXT NOT NULL,
    "status" "AdministrationStatus" NOT NULL,
    "doseGiven" TEXT,
    "route" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "administeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "administeredById" TEXT NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "witnessedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationAdministration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LabTest_code_key" ON "LabTest"("code");

-- CreateIndex
CREATE INDEX "LabTest_department_active_idx" ON "LabTest"("department", "active");

-- CreateIndex
CREATE INDEX "LabOrder_status_createdAt_idx" ON "LabOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LabOrder_patientId_createdAt_idx" ON "LabOrder"("patientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LabOrderItem_labResultId_key" ON "LabOrderItem"("labResultId");

-- CreateIndex
CREATE INDEX "LabOrderItem_orderId_idx" ON "LabOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "LabOrderItem_status_idx" ON "LabOrderItem"("status");

-- CreateIndex
CREATE INDEX "LabOrderItem_labTestId_idx" ON "LabOrderItem"("labTestId");

-- CreateIndex
CREATE INDEX "MedicationAdministration_prescriptionItemId_administeredAt_idx" ON "MedicationAdministration"("prescriptionItemId", "administeredAt");

-- CreateIndex
CREATE INDEX "MedicationAdministration_administeredAt_idx" ON "MedicationAdministration"("administeredAt");

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_orderedById_fkey" FOREIGN KEY ("orderedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrderItem" ADD CONSTRAINT "LabOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LabOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrderItem" ADD CONSTRAINT "LabOrderItem_labTestId_fkey" FOREIGN KEY ("labTestId") REFERENCES "LabTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrderItem" ADD CONSTRAINT "LabOrderItem_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrderItem" ADD CONSTRAINT "LabOrderItem_resultedById_fkey" FOREIGN KEY ("resultedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrderItem" ADD CONSTRAINT "LabOrderItem_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_prescriptionItemId_fkey" FOREIGN KEY ("prescriptionItemId") REFERENCES "PrescriptionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_administeredById_fkey" FOREIGN KEY ("administeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

