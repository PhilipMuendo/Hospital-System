-- CreateEnum
CREATE TYPE "VisitType" AS ENUM ('NEW', 'REVISIT', 'FOLLOW_UP', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('OPEN', 'COMPLETED', 'ADMITTED', 'LWBS', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TriageAcuity" AS ENUM ('RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE');

-- CreateEnum
CREATE TYPE "StationKind" AS ENUM ('RECEPTION', 'TRIAGE', 'CASHIER', 'CONSULTATION', 'LAB', 'IMAGING', 'PHARMACY');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('WAITING', 'CALLED', 'IN_SERVICE', 'COMPLETED', 'NO_SHOW', 'CANCELLED');


-- DropForeignKey
ALTER TABLE "Patient" DROP CONSTRAINT "Patient_wardId_fkey";

-- DropForeignKey
ALTER TABLE "Patient" DROP CONSTRAINT "Patient_primaryPhysicianId_fkey";

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "opNumber" TEXT,
ADD COLUMN     "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "ipNumber" DROP NOT NULL,
ALTER COLUMN "wardId" DROP NOT NULL,
ALTER COLUMN "bed" DROP NOT NULL,
ALTER COLUMN "primaryPhysicianId" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'REGISTERED',
ALTER COLUMN "admittedAt" DROP NOT NULL,
ALTER COLUMN "admittedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StationKind" NOT NULL,
    "room" TEXT,
    "tokenPrefix" TEXT NOT NULL,
    "privateClinic" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "visitNumber" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" "VisitType" NOT NULL DEFAULT 'REVISIT',
    "status" "VisitStatus" NOT NULL DEFAULT 'OPEN',
    "chiefComplaint" TEXT,
    "payer" "Payer" NOT NULL DEFAULT 'SELF_PAY',
    "shaNumber" TEXT,
    "acuity" "TriageAcuity",
    "currentStationId" TEXT,
    "arrivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "registeredById" TEXT,
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueTicket" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "serviceDate" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "status" "TicketStatus" NOT NULL DEFAULT 'WAITING',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calledAt" TIMESTAMP(3),
    "servedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "calledById" TEXT,
    "servedById" TEXT,
    "counter" TEXT,

    CONSTRAINT "QueueTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageAssessment" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "acuity" "TriageAcuity" NOT NULL,
    "temperature" TEXT,
    "pulse" TEXT,
    "respiratory" TEXT,
    "bloodPressure" TEXT,
    "spo2" TEXT,
    "weightKg" TEXT,
    "heightCm" TEXT,
    "notes" TEXT,
    "performedById" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriageAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Station_code_key" ON "Station"("code");

-- CreateIndex
CREATE INDEX "Station_kind_active_idx" ON "Station"("kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_visitNumber_key" ON "Visit"("visitNumber");

-- CreateIndex
CREATE INDEX "Visit_status_arrivedAt_idx" ON "Visit"("status", "arrivedAt");

-- CreateIndex
CREATE INDEX "Visit_patientId_arrivedAt_idx" ON "Visit"("patientId", "arrivedAt");

-- CreateIndex
CREATE INDEX "Visit_currentStationId_idx" ON "Visit"("currentStationId");

-- CreateIndex
CREATE INDEX "QueueTicket_stationId_status_priority_issuedAt_idx" ON "QueueTicket"("stationId", "status", "priority", "issuedAt");

-- CreateIndex
CREATE INDEX "QueueTicket_serviceDate_status_idx" ON "QueueTicket"("serviceDate", "status");

-- CreateIndex
CREATE INDEX "QueueTicket_visitId_idx" ON "QueueTicket"("visitId");

-- CreateIndex
CREATE UNIQUE INDEX "QueueTicket_stationId_serviceDate_number_key" ON "QueueTicket"("stationId", "serviceDate", "number");

-- CreateIndex
CREATE UNIQUE INDEX "TriageAssessment_visitId_key" ON "TriageAssessment"("visitId");

-- CreateIndex
CREATE INDEX "TriageAssessment_acuity_performedAt_idx" ON "TriageAssessment"("acuity", "performedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_opNumber_key" ON "Patient"("opNumber");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_primaryPhysicianId_fkey" FOREIGN KEY ("primaryPhysicianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_currentStationId_fkey" FOREIGN KEY ("currentStationId") REFERENCES "Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueTicket" ADD CONSTRAINT "QueueTicket_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueTicket" ADD CONSTRAINT "QueueTicket_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageAssessment" ADD CONSTRAINT "TriageAssessment_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

