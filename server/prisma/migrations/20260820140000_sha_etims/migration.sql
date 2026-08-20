-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ACKNOWLEDGED', 'APPROVED', 'PART_APPROVED', 'REJECTED', 'APPEALED', 'PAID');

-- CreateEnum
CREATE TYPE "EtimsStatus" AS ENUM ('PENDING', 'SIGNED', 'FAILED');

-- CreateTable
CREATE TABLE "ShaClaim" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "visitId" TEXT,
    "internalRef" TEXT NOT NULL,
    "claimNumber" TEXT,
    "memberNumber" TEXT NOT NULL,
    "memberName" TEXT NOT NULL,
    "nationalId" TEXT,
    "status" "ClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "amountClaimed" DECIMAL(12,2) NOT NULL,
    "amountApproved" DECIMAL(12,2),
    "adjudicationNotes" TEXT,
    "rejectionCode" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "adjudicatedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShaClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShaClaimLine" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "billingLineId" TEXT,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "approvedAmount" DECIMAL(10,2),
    "rejectionCode" TEXT,

    CONSTRAINT "ShaClaimLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EtimsInvoice" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "status" "EtimsStatus" NOT NULL DEFAULT 'PENDING',
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "taxableAmount" DECIMAL(12,2) NOT NULL,
    "vatAmount" DECIMAL(12,2) NOT NULL,
    "controlUnitNumber" TEXT,
    "invoiceSignature" TEXT,
    "qrCodeUrl" TEXT,
    "signedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EtimsInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShaClaim_internalRef_key" ON "ShaClaim"("internalRef");

-- CreateIndex
CREATE INDEX "ShaClaim_status_createdAt_idx" ON "ShaClaim"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ShaClaim_patientId_idx" ON "ShaClaim"("patientId");

-- CreateIndex
CREATE INDEX "ShaClaimLine_claimId_idx" ON "ShaClaimLine"("claimId");

-- CreateIndex
CREATE INDEX "ShaClaimLine_billingLineId_idx" ON "ShaClaimLine"("billingLineId");

-- CreateIndex
CREATE UNIQUE INDEX "EtimsInvoice_invoiceNumber_key" ON "EtimsInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "EtimsInvoice_status_createdAt_idx" ON "EtimsInvoice"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EtimsInvoice_patientId_idx" ON "EtimsInvoice"("patientId");

-- AddForeignKey
ALTER TABLE "ShaClaim" ADD CONSTRAINT "ShaClaim_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShaClaim" ADD CONSTRAINT "ShaClaim_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShaClaimLine" ADD CONSTRAINT "ShaClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ShaClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShaClaimLine" ADD CONSTRAINT "ShaClaimLine_billingLineId_fkey" FOREIGN KEY ("billingLineId") REFERENCES "BillingLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

