-- CreateEnum
CREATE TYPE "DeviceKind" AS ENUM ('PATIENT_MONITOR', 'INFUSION_PUMP', 'VENTILATOR', 'LAB_ANALYSER', 'ECG', 'ULTRASOUND', 'XRAY', 'DEFIBRILLATOR', 'PULSE_OXIMETER', 'WEIGHING_SCALE', 'BARCODE_SCANNER', 'THERMOMETER');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ONLINE', 'OFFLINE', 'MAINTENANCE', 'FAULT', 'RETIRED');

-- CreateEnum
CREATE TYPE "DeviceTransport" AS ENUM ('HL7_MLLP', 'REST_PUSH', 'SERIAL_BRIDGE', 'MANUAL');

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "assetTag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DeviceKind" NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "transport" "DeviceTransport" NOT NULL DEFAULT 'MANUAL',
    "status" "DeviceStatus" NOT NULL DEFAULT 'OFFLINE',
    "wardId" TEXT,
    "bed" TEXT,
    "hl7SendingApplication" TEXT,
    "ipAddress" TEXT,
    "apiKeyHash" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "commissionedAt" TIMESTAMP(3),
    "lastServicedAt" TIMESTAMP(3),
    "serviceDueAt" TIMESTAMP(3),
    "calibrationDueAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceMessage" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT,
    "transport" "DeviceTransport" NOT NULL,
    "raw" TEXT NOT NULL,
    "messageType" TEXT,
    "controlId" TEXT,
    "parsed" BOOLEAN NOT NULL DEFAULT false,
    "parseError" TEXT,
    "patientId" TEXT,
    "sourceIp" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceReading" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "patientId" TEXT,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "abnormalFlag" TEXT,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,

    CONSTRAINT "DeviceReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_assetTag_key" ON "Device"("assetTag");

-- CreateIndex
CREATE UNIQUE INDEX "Device_hl7SendingApplication_key" ON "Device"("hl7SendingApplication");

-- CreateIndex
CREATE INDEX "Device_kind_status_idx" ON "Device"("kind", "status");

-- CreateIndex
CREATE INDEX "Device_wardId_idx" ON "Device"("wardId");

-- CreateIndex
CREATE INDEX "Device_serviceDueAt_idx" ON "Device"("serviceDueAt");

-- CreateIndex
CREATE INDEX "DeviceMessage_deviceId_receivedAt_idx" ON "DeviceMessage"("deviceId", "receivedAt");

-- CreateIndex
CREATE INDEX "DeviceMessage_parsed_receivedAt_idx" ON "DeviceMessage"("parsed", "receivedAt");

-- CreateIndex
CREATE INDEX "DeviceReading_deviceId_measuredAt_idx" ON "DeviceReading"("deviceId", "measuredAt");

-- CreateIndex
CREATE INDEX "DeviceReading_patientId_measuredAt_idx" ON "DeviceReading"("patientId", "measuredAt");

-- CreateIndex
CREATE INDEX "DeviceReading_accepted_receivedAt_idx" ON "DeviceReading"("accepted", "receivedAt");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceMessage" ADD CONSTRAINT "DeviceMessage_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceReading" ADD CONSTRAINT "DeviceReading_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

