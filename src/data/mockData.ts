// Realistic fictional data for the Meridian HMS demo surfaces.
// Names, MRNs, and readings are invented for design purposes only.

export type OccupancyStatus = 'healthy' | 'warning' | 'critical'

export interface WardOccupancy {
  ward: string
  beds: number
  occupied: number
}

export const wardOccupancy: WardOccupancy[] = [
  { ward: 'Cardiac ICU', beds: 18, occupied: 15 },
  { ward: 'Medical / Surgical', beds: 64, occupied: 49 },
  { ward: 'Neuro Step-Down', beds: 22, occupied: 16 },
  { ward: 'Labor & Delivery', beds: 14, occupied: 9 },
  { ward: 'Emergency Bay', beds: 30, occupied: 26 },
]

export const totalBeds = wardOccupancy.reduce((sum, w) => sum + w.beds, 0)
export const totalOccupied = wardOccupancy.reduce((sum, w) => sum + w.occupied, 0)
export const occupancyPct = Math.round((totalOccupied / totalBeds) * 100)

export function occupancyStatus(pct: number): OccupancyStatus {
  if (pct >= 90) return 'critical'
  if (pct >= 75) return 'warning'
  return 'healthy'
}

export interface DashboardMetric {
  label: string
  value: string
  delta: string
  trend: 'up' | 'down' | 'flat'
}

export const dashboardMetrics: DashboardMetric[] = [
  { label: 'Avg. Length of Stay', value: '4.2 days', delta: '-0.3d vs last wk', trend: 'down' },
  { label: 'ED Wait Time', value: '38 min', delta: '+6 min vs last wk', trend: 'up' },
  { label: 'Discharges Today', value: '24', delta: '+5 vs yesterday', trend: 'up' },
  { label: 'Staff on Shift', value: '212', delta: 'nominal', trend: 'flat' },
]

export interface Alert {
  id: string
  severity: OccupancyStatus
  message: string
  time: string
}

export const alerts: Alert[] = [
  { id: 'a1', severity: 'critical', message: 'ICU-4 ventilator inventory below threshold', time: '2m ago' },
  { id: 'a2', severity: 'warning', message: 'Emergency Bay approaching capacity (26/30)', time: '11m ago' },
  { id: 'a3', severity: 'healthy', message: 'Pharmacy restock completed — Ward B', time: '48m ago' },
]

export interface VitalReading {
  label: string
  value: string
  unit: string
  status: OccupancyStatus
}

export const patient = {
  name: 'Eleanor Vasquez',
  mrn: 'MRN-central 208-4471',
  dob: 'March 14, 1958',
  age: 68,
  sex: 'Female',
  bloodType: 'O Negative',
  room: 'Cardiac ICU · Bed 6',
  primaryPhysician: 'Dr. Amara Osei, MD',
  admitted: 'Jul 29, 2026 · 09:14',
  allergies: ['Penicillin', 'Shellfish'],
  code: 'Full Code',
  avatarInitials: 'EV',
}

export const vitals: VitalReading[] = [
  { label: 'Heart Rate', value: '78', unit: 'bpm', status: 'healthy' },
  { label: 'Blood Pressure', value: '128/82', unit: 'mmHg', status: 'healthy' },
  { label: 'SpO₂', value: '96', unit: '%', status: 'warning' },
  { label: 'Temperature', value: '99.1', unit: '°F', status: 'healthy' },
  { label: 'Resp. Rate', value: '18', unit: '/min', status: 'healthy' },
]

export interface LabResult {
  id: string
  test: string
  result: string
  range: string
  flag: 'normal' | 'low' | 'high'
  collected: string
}

export const labResults: LabResult[] = [
  { id: 'l1', test: 'Troponin I', result: '0.02 ng/mL', range: '< 0.04 ng/mL', flag: 'normal', collected: 'Aug 2, 06:10' },
  { id: 'l2', test: 'Hemoglobin A1c', result: '7.4 %', range: '4.0 – 5.6 %', flag: 'high', collected: 'Aug 1, 22:40' },
  { id: 'l3', test: 'Potassium', result: '3.3 mmol/L', range: '3.5 – 5.1 mmol/L', flag: 'low', collected: 'Aug 2, 06:10' },
  { id: 'l4', test: 'Creatinine', result: '0.9 mg/dL', range: '0.6 – 1.3 mg/dL', flag: 'normal', collected: 'Aug 1, 22:40' },
  { id: 'l5', test: 'White Blood Cell Count', result: '11.8 x10⁹/L', range: '4.5 – 11.0 x10⁹/L', flag: 'high', collected: 'Aug 2, 06:10' },
  { id: 'l6', test: 'B-type Natriuretic Peptide', result: '142 pg/mL', range: '< 100 pg/mL', flag: 'high', collected: 'Aug 1, 18:05' },
]

export interface ImagingStudy {
  id: string
  study: string
  modality: string
  date: string
  radiologist: string
  impression: string
}

export const imagingStudies: ImagingStudy[] = [
  {
    id: 'i1',
    study: 'Chest X-Ray, 2 views',
    modality: 'XR',
    date: 'Aug 1, 2026',
    radiologist: 'Dr. Felix Nakamura',
    impression: 'Mild pulmonary vascular congestion, no consolidation.',
  },
  {
    id: 'i2',
    study: 'Echocardiogram, transthoracic',
    modality: 'ECHO',
    date: 'Jul 30, 2026',
    radiologist: 'Dr. Priya Ramanathan',
    impression: 'LVEF 48%, mild mitral regurgitation.',
  },
  {
    id: 'i3',
    study: 'CT Chest, contrast',
    modality: 'CT',
    date: 'Jul 29, 2026',
    radiologist: 'Dr. Felix Nakamura',
    impression: 'No evidence of pulmonary embolism.',
  },
]

export interface BillingLine {
  id: string
  description: string
  code: string
  amount: string
  status: 'paid' | 'pending' | 'denied'
}

export const billingLines: BillingLine[] = [
  { id: 'b1', description: 'ICU Room & Board — Level 3', code: '0206', amount: '$4,820.00', status: 'pending' },
  { id: 'b2', description: 'Echocardiogram, complete', code: '93306', amount: '$1,120.00', status: 'paid' },
  { id: 'b3', description: 'Cardiology Consult', code: '99254', amount: '$640.00', status: 'paid' },
  { id: 'b4', description: 'Basic Metabolic Panel', code: '80048', amount: '$95.00', status: 'denied' },
  { id: 'b5', description: 'IV Furosemide, per dose', code: 'J1940', amount: '$34.50', status: 'pending' },
]

export interface Surgery {
  id: string
  patient: string
  procedure: string
  surgeon: string
  room: string
  startHour: number // 24h decimal, e.g. 8.5 = 8:30
  durationHours: number
  status: 'confirmed' | 'in-progress' | 'delayed'
}

export const surgeries: Surgery[] = [
  { id: 's1', patient: 'M. Alvarado', procedure: 'Laparoscopic Cholecystectomy', surgeon: 'Dr. R. Whitfield', room: 'OR 1', startHour: 7.5, durationHours: 1.5, status: 'confirmed' },
  { id: 's2', patient: 'J. Okafor', procedure: 'Total Knee Arthroplasty', surgeon: 'Dr. L. Bergström', room: 'OR 2', startHour: 8, durationHours: 2.5, status: 'in-progress' },
  { id: 's3', patient: 'S. Petrova', procedure: 'Coronary Artery Bypass', surgeon: 'Dr. A. Osei', room: 'OR 3', startHour: 7, durationHours: 4, status: 'confirmed' },
  { id: 's4', patient: 'D. Kim', procedure: 'Appendectomy', surgeon: 'Dr. R. Whitfield', room: 'OR 1', startHour: 8.75, durationHours: 1.25, status: 'delayed' },
  { id: 's5', patient: 'H. Müller', procedure: 'Cataract Extraction', surgeon: 'Dr. C. Iyer', room: 'OR 4', startHour: 8.5, durationHours: 0.75, status: 'confirmed' },
  { id: 's6', patient: 'N. Adeyemi', procedure: 'Spinal Fusion, L4-L5', surgeon: 'Dr. L. Bergström', room: 'OR 2', startHour: 11, durationHours: 3.5, status: 'confirmed' },
  { id: 's7', patient: 'F. Rossi', procedure: 'Hernia Repair', surgeon: 'Dr. C. Iyer', room: 'OR 4', startHour: 10.5, durationHours: 1.25, status: 'confirmed' },
]
