-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'MPESA', 'CARD', 'INSURANCE', 'WAIVER');

-- CreateEnum
CREATE TYPE "ImagingModality" AS ENUM ('XRAY', 'ULTRASOUND', 'CT', 'MRI', 'MAMMOGRAPHY', 'FLUOROSCOPY');

-- CreateEnum
CREATE TYPE "ImagingOrderStatus" AS ENUM ('ORDERED', 'PERFORMED', 'REPORTED', 'VERIFIED', 'CANCELLED');

-- AlterTable
ALTER TABLE "BillingLine" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentMethod" "PaymentMethod",
ADD COLUMN     "receiptNumber" TEXT,
ADD COLUMN     "receivedById" TEXT;

-- CreateTable
CREATE TABLE "ImagingProcedure" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modality" "ImagingModality" NOT NULL,
    "bodyPart" TEXT NOT NULL,
    "ionising" BOOLEAN NOT NULL DEFAULT true,
    "preparation" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "durationMins" INTEGER NOT NULL DEFAULT 15,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImagingProcedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImagingOrder" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "visitId" TEXT,
    "procedureId" TEXT NOT NULL,
    "orderedById" TEXT NOT NULL,
    "urgency" "LabUrgency" NOT NULL DEFAULT 'ROUTINE',
    "clinicalNotes" TEXT,
    "status" "ImagingOrderStatus" NOT NULL DEFAULT 'ORDERED',
    "pregnancyChecked" BOOLEAN NOT NULL DEFAULT false,
    "pregnancyStatus" TEXT,
    "lmpDate" TIMESTAMP(3),
    "performedAt" TIMESTAMP(3),
    "performedById" TEXT,
    "technicalNotes" TEXT,
    "retakeCount" INTEGER NOT NULL DEFAULT 0,
    "reportedAt" TIMESTAMP(3),
    "reportedById" TEXT,
    "findings" TEXT,
    "impression" TEXT,
    "imagingStudyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImagingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImagingProcedure_code_key" ON "ImagingProcedure"("code");

-- CreateIndex
CREATE INDEX "ImagingProcedure_modality_active_idx" ON "ImagingProcedure"("modality", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ImagingOrder_imagingStudyId_key" ON "ImagingOrder"("imagingStudyId");

-- CreateIndex
CREATE INDEX "ImagingOrder_status_createdAt_idx" ON "ImagingOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ImagingOrder_patientId_createdAt_idx" ON "ImagingOrder"("patientId", "createdAt");

-- AddForeignKey
ALTER TABLE "ImagingOrder" ADD CONSTRAINT "ImagingOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingOrder" ADD CONSTRAINT "ImagingOrder_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "ImagingProcedure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingOrder" ADD CONSTRAINT "ImagingOrder_orderedById_fkey" FOREIGN KEY ("orderedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingOrder" ADD CONSTRAINT "ImagingOrder_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingOrder" ADD CONSTRAINT "ImagingOrder_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

