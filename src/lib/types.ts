export type Role = 'ADMIN' | 'PHYSICIAN' | 'NURSE' | 'BILLING' | 'PHARMACIST' | 'LAB_TECH' | 'RADIOGRAPHER' | 'PHARMACIST'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: Role
}

export interface Ward {
  id: string
  name: string
  bedCapacity: number
  occupied: number
}

export interface PatientSummary {
  id: string
  ipNumber: string
  name: string
  avatarInitials: string
  bed: string
  status: 'ADMITTED' | 'DISCHARGED'
  ward: { id: string; name: string }
}

export interface PatientDetail {
  id: string
  ipNumber: string
  nationalId: string | null
  name: string
  dob: string
  phone: string | null
  sex: 'MALE' | 'FEMALE' | 'INTERSEX'
  bloodType: string
  nextOfKinName: string
  nextOfKinPhone: string
  nextOfKinRelation: string
  allergies: string[]
  codeStatus: 'FULL_CODE' | 'DNR' | 'DNI' | 'COMFORT_CARE'
  chiefComplaint: string | null
  assessment: string | null
  carePlan: string[]
  avatarInitials: string
  bed: string
  status: 'ADMITTED' | 'DISCHARGED'
  admittedAt: string
  ward: { id: string; name: string }
  primaryPhysician: { id: string; name: string }
}

export type Severity = 'HEALTHY' | 'WARNING' | 'CRITICAL'

export interface VitalReading {
  id: string
  label: string
  value: string
  unit: string
  status: Severity
  recordedAt: string
}

export interface LabResult {
  id: string
  test: string
  result: string
  range: string
  flag: 'NORMAL' | 'LOW' | 'HIGH'
  collectedAt: string
  reviewed: boolean
  reviewedById: string | null
  reviewedAt: string | null
}

export interface ImagingStudy {
  id: string
  study: string
  modality: string
  performedAt: string
  radiologistName: string
  impression: string
}

export type Payer = 'SHA' | 'IMARA_HEALTH_ASSURANCE' | 'SELF_PAY'
export type BillingStatus = 'PAID' | 'PENDING' | 'DENIED'

export interface BillingLine {
  id: string
  description: string
  code: string
  amount: string
  currency: string
  payer: Payer
  status: BillingStatus
  mpesaReference: string | null
  createdAt: string
}

export type ORRoom = 'OR_1' | 'OR_2' | 'OR_3' | 'OR_4'
export type SurgeryStatus = 'CONFIRMED' | 'IN_PROGRESS' | 'DELAYED' | 'CANCELLED'

export interface Surgery {
  id: string
  procedure: string
  room: ORRoom
  startsAt: string
  endsAt: string
  status: SurgeryStatus
  patient: { id: string; name: string; ipNumber: string }
  surgeon: { id: string; name: string }
}

export interface Alert {
  id: string
  severity: Severity
  message: string
  resolved: boolean
  createdAt: string
  ward: { id: string; name: string } | null
}

export interface DashboardMetric {
  key: string
  label: string
  value: string
  delta: string
  trend: 'up' | 'down' | 'flat'
}

export type DrugForm =
  | 'TABLET'
  | 'CAPSULE'
  | 'SYRUP'
  | 'SUSPENSION'
  | 'INJECTION'
  | 'INFUSION'
  | 'SUPPOSITORY'
  | 'TOPICAL'
  | 'INHALER'
  | 'DROPS'

export interface Drug {
  id: string
  code: string
  genericName: string
  brandName: string | null
  form: DrugForm
  strength: string
  unit: string
  unitPrice: string
  kemlListed: boolean
  controlled: boolean
}

export interface DrugStockRow extends Drug {
  currency: string
  reorderLevel: number
  inStock: number
  belowReorderLevel: boolean
  expiringSoon: number
  expiredUnits: number
  earliestExpiry: string | null
}

export interface DispenseEvent {
  id: string
  quantity: number
  createdAt: string
  dispensedBy: { id: string; name: string }
  batchBreakdown: { batchId: string; batchNumber: string; expiryDate: string; quantity: number }[]
}

export interface PrescriptionItem {
  id: string
  dose: string
  route: string
  frequency: string
  durationDays: number | null
  quantityPrescribed: number
  quantityDispensed: number
  quantityRemaining: number
  instructions: string | null
  drug: Drug
  dispenseEvents: DispenseEvent[]
}

export type PrescriptionStatus = 'ACTIVE' | 'PARTIALLY_DISPENSED' | 'DISPENSED' | 'CANCELLED'

export interface Prescription {
  id: string
  status: PrescriptionStatus
  notes: string | null
  allergyOverrideReason: string | null
  createdAt: string
  prescriber: { id: string; name: string }
  items: PrescriptionItem[]
}

export type MpesaStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'TIMEOUT'

export interface MpesaTransaction {
  id: string
  /** Masked by the server — full number never reaches the browser. */
  phone: string
  amount: string
  status: MpesaStatus
  resultDesc: string | null
  mpesaReceiptNumber: string | null
  transactionDate: string | null
  billingLineId: string | null
  createdAt: string
}

export interface MpesaPushResponse {
  id: string
  status: MpesaStatus
  checkoutRequestId: string | null
  customerMessage: string
  mocked: boolean
}
