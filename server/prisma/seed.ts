import { dosesPerDayFrom } from '../src/lib/lab.js'
import { PrismaClient, type Role, type Sex } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// Nairobi is UTC+3 year-round (no DST) — bake the offset directly into
// seeded timestamps so "today's" surgery schedule lands on the correct
// local day regardless of the container's own system timezone.
function nairobi(dateStr: string, time: string) {
  return new Date(`${dateStr}T${time}:00+03:00`)
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function birthDate(age: number) {
  const d = new Date()
  d.setFullYear(d.getFullYear() - age)
  d.setMonth(0, 15)
  return d
}

const FIRST_NAMES_MALE = [
  'Peter', 'John', 'James', 'David', 'Samuel', 'Joseph', 'Daniel', 'Kevin', 'Brian', 'Dennis',
  'Elijah', 'Felix', 'George', 'Harun', 'Ian', 'Julius', 'Kelvin', 'Levi', 'Martin', 'Nicholas',
  'Oscar', 'Patrick', 'Robert', 'Simon', 'Titus', 'Vincent', 'Wilson', 'Xavier', 'Yusuf', 'Zachary',
]
const FIRST_NAMES_FEMALE = [
  'Grace', 'Mary', 'Faith', 'Ann', 'Joyce', 'Esther', 'Lucy', 'Ruth', 'Agnes', 'Beatrice',
  'Caroline', 'Diana', 'Eunice', 'Florence', 'Gladys', 'Hellen', 'Irene', 'Jane', 'Purity', 'Winnie',
  'Brenda', 'Catherine', 'Dorcas', 'Edith', 'Fridah', 'Gloria', 'Halima', 'Immaculate', 'Josephine', 'Khadija',
]
const SURNAMES = [
  'Wanjiru', 'Kamau', 'Otieno', 'Odhiambo', 'Wafula', 'Kiptoo', 'Chebet', 'Njeri', 'Mwangi', 'Achieng',
  'Wambui', 'Njoroge', 'Adhiambo', 'Rotich', 'Cherono', 'Muthoni', 'Karanja', 'Onyango', 'Wekesa', 'Nyambura',
  'Kariuki', 'Langat', 'Mutiso', 'Musyoka', 'Hassan', 'Abdi', 'Ali', 'Mohamed', 'Omondi', 'Kibet',
]
const RELATIONS = ['Spouse', 'Sibling', 'Parent', 'Child', 'Cousin', 'Friend']
const BLOOD_TYPES = [
  'O Positive', 'O Negative', 'A Positive', 'A Negative',
  'B Positive', 'B Negative', 'AB Positive', 'AB Negative',
]

function generatedPerson(index: number, sex: Sex) {
  const firstPool = sex === 'MALE' ? FIRST_NAMES_MALE : FIRST_NAMES_FEMALE
  const first = firstPool[index % firstPool.length]
  const surname = SURNAMES[(index * 7) % SURNAMES.length]
  return { first, surname, name: `${first} ${surname}` }
}

function generatedPhone(seed: number) {
  const digits = String(700000000 + ((seed * 104729) % 99999999)).slice(0, 9)
  return `+254 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`
}


/** Mirrors what the prescribing API does, so seeded rounds behave the same. */
function withDoses<T extends { frequency: string }>(items: T[]) {
  return items.map((i) => ({ ...i, dosesPerDay: dosesPerDayFrom(i.frequency) }))
}

async function main() {
  console.log('Clearing existing data...')
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.mpesaTransaction.deleteMany(),
    prisma.dispenseEvent.deleteMany(),
    prisma.prescriptionItem.deleteMany(),
    prisma.prescription.deleteMany(),
    prisma.stockMovement.deleteMany(),
    prisma.medicationAdministration.deleteMany(),
    prisma.labOrderItem.deleteMany(),
    prisma.labOrder.deleteMany(),
    prisma.labTest.deleteMany(),
    prisma.queueTicket.deleteMany(),
    prisma.triageAssessment.deleteMany(),
    prisma.visit.deleteMany(),
    prisma.station.deleteMany(),
    prisma.deviceReading.deleteMany(),
    prisma.deviceMessage.deleteMany(),
    prisma.device.deleteMany(),
    prisma.drugBatch.deleteMany(),
    prisma.drug.deleteMany(),
    prisma.billingLine.deleteMany(),
    prisma.surgery.deleteMany(),
    prisma.imagingStudy.deleteMany(),
    prisma.labResult.deleteMany(),
    prisma.vitalReading.deleteMany(),
    prisma.alert.deleteMany(),
    prisma.hospitalMetric.deleteMany(),
    prisma.patient.deleteMany(),
    prisma.user.deleteMany(),
    prisma.ward.deleteMany(),
  ])

  console.log('Seeding wards...')
  const wardDefs = [
    { name: 'Cardiac ICU', bedCapacity: 18, targetOccupied: 15 },
    { name: 'General Ward', bedCapacity: 64, targetOccupied: 49 },
    { name: 'High Dependency Unit', bedCapacity: 22, targetOccupied: 16 },
    { name: 'Maternity Ward', bedCapacity: 14, targetOccupied: 9 },
    { name: 'Casualty', bedCapacity: 30, targetOccupied: 26 },
  ]
  const wards = new Map<string, { id: string; bedCapacity: number; targetOccupied: number }>()
  for (const w of wardDefs) {
    const created = await prisma.ward.create({ data: { name: w.name, bedCapacity: w.bedCapacity } })
    wards.set(w.name, { id: created.id, bedCapacity: w.bedCapacity, targetOccupied: w.targetOccupied })
  }

  console.log('Seeding staff users...')
  const demoPasswordHash = await bcrypt.hash('Passw0rd!', 10)
  async function createUser(name: string, email: string, role: Role) {
    return prisma.user.create({ data: { name, email, role, passwordHash: demoPasswordHash } })
  }
  const admin = await createUser('Faith Wambui', 'admin@uzimageneral.ke', 'ADMIN')
  const drNjeri = await createUser('Dr. Anne Njeri', 'a.njeri@uzimageneral.ke', 'PHYSICIAN')
  const drKiptoo = await createUser('Dr. Brian Kiptoo', 'b.kiptoo@uzimageneral.ke', 'PHYSICIAN')
  const drWafula = await createUser('Dr. Susan Wafula', 's.wafula@uzimageneral.ke', 'PHYSICIAN')
  const drAbdi = await createUser('Dr. Halima Abdi', 'h.abdi@uzimageneral.ke', 'PHYSICIAN')
  const nurseAchieng = await createUser('Achieng Otieno', 'achieng.otieno@uzimageneral.ke', 'NURSE')
  const nurseChebet = await createUser('Chebet Kiptoo', 'chebet.kiptoo@uzimageneral.ke', 'NURSE')
  const billingBrenda = await createUser('Brenda Nyambura', 'b.nyambura@uzimageneral.ke', 'BILLING')
  const pharmJoseph = await createUser('Joseph Kariuki', 'j.kariuki@uzimageneral.ke', 'PHARMACIST')
  // Two technologists, because a result must be verified by someone other
  // than the person who ran it.
  await createUser('Mercy Adhiambo', 'm.adhiambo@uzimageneral.ke', 'LAB_TECH')
  await createUser('Kevin Mutiso', 'k.mutiso@uzimageneral.ke', 'LAB_TECH')
  await createUser('Dennis Kiprop', 'd.kiprop@uzimageneral.ke', 'RADIOGRAPHER')
  const physicians = [drNjeri, drKiptoo, drWafula, drAbdi]

  console.log('Seeding richly-detailed patients...')
  const today = todayStr()

  // 1. Grace Wanjiru Mwangi — Cardiac ICU — acute decompensated heart failure
  const grace = await prisma.patient.create({
    data: {
      ipNumber: 'IP/2026/04471',
      nationalId: '23841126',
      name: 'Grace Wanjiru Mwangi',
      dob: birthDate(68),
      sex: 'FEMALE',
      bloodType: 'O Negative',
      phone: '+254 722 118 904',
      nextOfKinName: 'David Mwangi',
      nextOfKinPhone: '+254 722 445 810',
      nextOfKinRelation: 'Son',
      allergies: ['Penicillin', 'Shellfish'],
      codeStatus: 'FULL_CODE',
      chiefComplaint:
        'Progressive dyspnoea on exertion and lower-extremity oedema over 5 days, with one episode of orthopnoea.',
      assessment:
        'Acute decompensated heart failure, preserved ejection fraction, on a background of Type 2 diabetes and hypertension. Responding to IV diuresis; potassium trending low, monitor with repletion.',
      carePlan: [
        'Continue IV furosemide, reassess weight and I/O every shift',
        'Repeat BNP and BMP in the morning',
        'Cardiology follow-up echo in 48 hours',
        'Diabetic diet, continue home metformin',
      ],
      avatarInitials: 'GW',
      wardId: wards.get('Cardiac ICU')!.id,
      bed: 'Bed 6',
      primaryPhysicianId: drNjeri.id,
      status: 'ADMITTED', admittedAt: daysAgo(4),
      vitals: {
        create: [
          { label: 'Heart Rate', value: '78', unit: 'bpm', status: 'HEALTHY' },
          { label: 'Blood Pressure', value: '128/82', unit: 'mmHg', status: 'HEALTHY' },
          { label: 'SpO₂', value: '96', unit: '%', status: 'WARNING' },
          { label: 'Temperature', value: '99.1', unit: '°F', status: 'HEALTHY' },
          { label: 'Resp. Rate', value: '18', unit: '/min', status: 'HEALTHY' },
        ],
      },
      labs: {
        create: [
          { test: 'Troponin I', result: '0.02 ng/mL', range: '< 0.04 ng/mL', flag: 'NORMAL', collectedAt: nairobi(today, '06:10') },
          { test: 'Haemoglobin A1c', result: '7.4 %', range: '4.0 – 5.6 %', flag: 'HIGH', collectedAt: nairobi(today, '05:40'), reviewed: true, reviewedById: drNjeri.id, reviewedAt: nairobi(today, '07:00') },
          { test: 'Potassium', result: '3.3 mmol/L', range: '3.5 – 5.1 mmol/L', flag: 'LOW', collectedAt: nairobi(today, '06:10') },
          { test: 'Creatinine', result: '0.9 mg/dL', range: '0.6 – 1.3 mg/dL', flag: 'NORMAL', collectedAt: nairobi(today, '05:40') },
          { test: 'White Blood Cell Count', result: '11.8 x10⁹/L', range: '4.5 – 11.0 x10⁹/L', flag: 'HIGH', collectedAt: nairobi(today, '06:10') },
          { test: 'B-type Natriuretic Peptide', result: '142 pg/mL', range: '< 100 pg/mL', flag: 'HIGH', collectedAt: nairobi(today, '02:05') },
        ],
      },
      imaging: {
        create: [
          { study: 'Chest X-Ray, 2 views', modality: 'XR', performedAt: daysAgo(3), radiologistName: 'Dr. James Kariuki', impression: 'Mild pulmonary vascular congestion, no consolidation.' },
          { study: 'Echocardiogram, transthoracic', modality: 'ECHO', performedAt: daysAgo(4), radiologistName: 'Dr. Lucy Adhiambo', impression: 'LVEF 48%, mild mitral regurgitation.' },
          { study: 'CT Chest, contrast', modality: 'CT', performedAt: daysAgo(4), radiologistName: 'Dr. James Kariuki', impression: 'No evidence of pulmonary embolism.' },
        ],
      },
      billingLines: {
        create: [
          { description: 'ICU Room & Board — Level 3', code: 'ICU-014', amount: 48200, payer: 'SHA', status: 'PENDING', createdById: billingBrenda.id },
          { description: 'Echocardiogram, complete', code: 'CARD-022', amount: 12500, payer: 'SHA', status: 'PAID', createdById: billingBrenda.id },
          { description: 'Cardiology Consult', code: 'CARD-004', amount: 6500, payer: 'IMARA_HEALTH_ASSURANCE', status: 'PAID', createdById: billingBrenda.id },
          { description: 'Basic Metabolic Panel', code: 'LAB-031', amount: 2800, payer: 'SHA', status: 'DENIED', createdById: billingBrenda.id },
          { description: 'IV Furosemide, per dose', code: 'PHARM-118', amount: 850, payer: 'SELF_PAY', status: 'PENDING', createdById: billingBrenda.id },
        ],
      },
    },
  })

  // 2. Peter Otieno Onyango — General Ward — post-appendectomy recovery
  const peter = await prisma.patient.create({
    data: {
      ipNumber: 'IP/2026/04512', nationalId: '27650312', name: 'Peter Otieno Onyango',
      dob: birthDate(54), sex: 'MALE', bloodType: 'A Positive',
      nextOfKinName: 'Mary Onyango', phone: '+254 701 445 220', nextOfKinPhone: '+254 733 118 402', nextOfKinRelation: 'Spouse',
      allergies: [], codeStatus: 'FULL_CODE',
      chiefComplaint: 'Post-operative day 2 following laparoscopic appendectomy, low-grade fever overnight.',
      assessment: 'Uncomplicated post-appendectomy recovery; mild surgical site inflammation, afebrile since this morning.',
      carePlan: ['Continue oral antibiotics', 'Mobilise and encourage ambulation', 'Wound check before discharge planning'],
      avatarInitials: 'PO', wardId: wards.get('General Ward')!.id, bed: 'Bed 12',
      primaryPhysicianId: drWafula.id, status: 'ADMITTED', admittedAt: daysAgo(2),
      vitals: { create: [
        { label: 'Heart Rate', value: '88', unit: 'bpm', status: 'HEALTHY' },
        { label: 'Blood Pressure', value: '118/76', unit: 'mmHg', status: 'HEALTHY' },
        { label: 'SpO₂', value: '98', unit: '%', status: 'HEALTHY' },
        { label: 'Temperature', value: '99.6', unit: '°F', status: 'WARNING' },
        { label: 'Resp. Rate', value: '16', unit: '/min', status: 'HEALTHY' },
      ] },
      labs: { create: [
        { test: 'White Blood Cell Count', result: '10.2 x10⁹/L', range: '4.5 – 11.0 x10⁹/L', flag: 'NORMAL', collectedAt: nairobi(today, '05:30') },
        { test: 'C-Reactive Protein', result: '18 mg/L', range: '< 10 mg/L', flag: 'HIGH', collectedAt: nairobi(today, '05:30') },
      ] },
      imaging: { create: [
        { study: 'Abdominal Ultrasound', modality: 'US', performedAt: daysAgo(1), radiologistName: 'Dr. Kiplagat Rotich', impression: 'No collection at surgical site, post-operative changes only.' },
      ] },
      billingLines: { create: [
        { description: 'General Ward Room & Board', code: 'GEN-002', amount: 9800, payer: 'SHA', status: 'PENDING', createdById: billingBrenda.id },
        { description: 'Laparoscopic Appendectomy', code: 'SURG-041', amount: 85000, payer: 'SHA', status: 'PAID', createdById: billingBrenda.id },
        { description: 'IV Antibiotics, course', code: 'PHARM-076', amount: 3200, payer: 'SELF_PAY', status: 'PAID', mpesaReference: 'RJK7T2Q1PX', createdById: billingBrenda.id },
      ] },
    },
  })

  // 3. Amina Hassan Ali — Maternity Ward — pre-eclampsia monitoring
  const amina = await prisma.patient.create({
    data: {
      ipNumber: 'IP/2026/04530', nationalId: '31029487', name: 'Amina Hassan Ali',
      dob: birthDate(31), sex: 'FEMALE', bloodType: 'B Positive',
      nextOfKinName: 'Yusuf Ali', phone: '+254 729 663 118', nextOfKinPhone: '+254 711 902 337', nextOfKinRelation: 'Spouse',
      allergies: ['Sulfa drugs'], codeStatus: 'FULL_CODE',
      chiefComplaint: '38 weeks gestation, admitted for pre-eclampsia monitoring after elevated BP at antenatal visit.',
      assessment: 'Mild pre-eclampsia; blood pressure trending down on labetalol, foetal monitoring reassuring.',
      carePlan: ['4-hourly BP and urine protein checks', 'Continue labetalol', 'Daily CTG monitoring', 'Plan for induction if BP does not stabilise by 40 weeks'],
      avatarInitials: 'AH', wardId: wards.get('Maternity Ward')!.id, bed: 'Bed 3',
      primaryPhysicianId: drAbdi.id, status: 'ADMITTED', admittedAt: daysAgo(1),
      vitals: { create: [
        { label: 'Heart Rate', value: '92', unit: 'bpm', status: 'HEALTHY' },
        { label: 'Blood Pressure', value: '142/94', unit: 'mmHg', status: 'WARNING' },
        { label: 'SpO₂', value: '99', unit: '%', status: 'HEALTHY' },
        { label: 'Temperature', value: '98.4', unit: '°F', status: 'HEALTHY' },
        { label: 'Resp. Rate', value: '17', unit: '/min', status: 'HEALTHY' },
      ] },
      labs: { create: [
        { test: 'Urine Protein', result: '2+', range: 'Negative', flag: 'HIGH', collectedAt: nairobi(today, '06:00') },
        { test: 'Platelet Count', result: '168 x10⁹/L', range: '150 – 400 x10⁹/L', flag: 'NORMAL', collectedAt: nairobi(today, '06:00') },
        { test: 'ALT', result: '32 U/L', range: '7 – 35 U/L', flag: 'NORMAL', collectedAt: nairobi(today, '06:00') },
      ] },
      imaging: { create: [
        { study: 'Obstetric Ultrasound', modality: 'US', performedAt: daysAgo(1), radiologistName: 'Dr. Nasieku Sankale', impression: 'Single live foetus, cephalic, growth appropriate for gestational age.' },
      ] },
      billingLines: { create: [
        { description: 'Maternity Ward Room & Board', code: 'MATN-005', amount: 7200, payer: 'SHA', status: 'PENDING', createdById: billingBrenda.id },
        { description: 'Obstetric Ultrasound', code: 'MATN-011', amount: 4500, payer: 'SHA', status: 'PAID', createdById: billingBrenda.id },
      ] },
    },
  })

  // 4. Kiptoo Chebet Langat — High Dependency Unit — closed head injury post-RTA
  await prisma.patient.create({
    data: {
      ipNumber: 'IP/2026/04498', nationalId: '29871034', name: 'Kiptoo Chebet Langat',
      dob: birthDate(45), sex: 'MALE', bloodType: 'O Positive',
      nextOfKinName: 'Rebecca Langat', phone: '+254 714 208 553', nextOfKinPhone: '+254 720 556 981', nextOfKinRelation: 'Spouse',
      allergies: [], codeStatus: 'FULL_CODE',
      chiefComplaint: 'Closed head injury following a road traffic accident, brief loss of consciousness at scene.',
      assessment: 'GCS improved from 13 to 15 over 24 hours; CT head shows no acute intracranial haemorrhage. Neuro observations stable.',
      carePlan: ['Hourly neuro observations', 'Repeat CT if any deterioration', 'Analgesia as required', 'Physiotherapy review before step-down'],
      avatarInitials: 'KL', wardId: wards.get('High Dependency Unit')!.id, bed: 'Bed 8',
      primaryPhysicianId: drKiptoo.id, status: 'ADMITTED', admittedAt: daysAgo(2),
      vitals: { create: [
        { label: 'Heart Rate', value: '74', unit: 'bpm', status: 'HEALTHY' },
        { label: 'Blood Pressure', value: '132/85', unit: 'mmHg', status: 'HEALTHY' },
        { label: 'SpO₂', value: '97', unit: '%', status: 'HEALTHY' },
        { label: 'Temperature', value: '98.9', unit: '°F', status: 'HEALTHY' },
        { label: 'Resp. Rate', value: '15', unit: '/min', status: 'HEALTHY' },
      ] },
      labs: { create: [
        { test: 'Haemoglobin', result: '13.8 g/dL', range: '13.5 – 17.5 g/dL', flag: 'NORMAL', collectedAt: nairobi(today, '05:15') },
        { test: 'INR', result: '1.0', range: '0.8 – 1.1', flag: 'NORMAL', collectedAt: nairobi(today, '05:15') },
      ] },
      imaging: { create: [
        { study: 'CT Head, non-contrast', modality: 'CT', performedAt: daysAgo(2), radiologistName: 'Dr. James Kariuki', impression: 'No acute intracranial haemorrhage or mass effect.' },
      ] },
      billingLines: { create: [
        { description: 'High Dependency Unit Room & Board', code: 'HDU-003', amount: 22000, payer: 'SHA', status: 'PENDING', createdById: billingBrenda.id },
        { description: 'CT Head, non-contrast', code: 'RAD-018', amount: 15500, payer: 'IMARA_HEALTH_ASSURANCE', status: 'PAID', createdById: billingBrenda.id },
      ] },
    },
  })

  // 5. Njoroge Mwangi Kamau — Casualty — acute chest pain, rule out MI
  await prisma.patient.create({
    data: {
      ipNumber: 'IP/2026/04555', nationalId: '19340221', name: 'Njoroge Mwangi Kamau',
      dob: birthDate(60), sex: 'MALE', bloodType: 'A Negative',
      nextOfKinName: 'Wanjiku Kamau', phone: '+254 738 991 407', nextOfKinPhone: '+254 715 224 660', nextOfKinRelation: 'Spouse',
      allergies: ['Aspirin'], codeStatus: 'FULL_CODE',
      chiefComplaint: 'Sudden-onset central chest pain radiating to the left arm, 2 hours prior to arrival.',
      assessment: 'Serial troponins negative, ECG without ST changes; low-risk chest pain, likely musculoskeletal but observing per protocol.',
      carePlan: ['Repeat troponin in 3 hours', 'Continuous cardiac monitoring', 'Cardiology review if any change'],
      avatarInitials: 'NK', wardId: wards.get('Casualty')!.id, bed: 'Bed 2',
      primaryPhysicianId: drNjeri.id, status: 'ADMITTED', admittedAt: daysAgo(0),
      vitals: { create: [
        { label: 'Heart Rate', value: '96', unit: 'bpm', status: 'WARNING' },
        { label: 'Blood Pressure', value: '148/90', unit: 'mmHg', status: 'WARNING' },
        { label: 'SpO₂', value: '98', unit: '%', status: 'HEALTHY' },
        { label: 'Temperature', value: '98.2', unit: '°F', status: 'HEALTHY' },
        { label: 'Resp. Rate', value: '19', unit: '/min', status: 'HEALTHY' },
      ] },
      labs: { create: [
        { test: 'Troponin I', result: '0.01 ng/mL', range: '< 0.04 ng/mL', flag: 'NORMAL', collectedAt: nairobi(today, '08:20') },
      ] },
      imaging: { create: [
        { study: 'Chest X-Ray, 2 views', modality: 'XR', performedAt: nairobi(today, '08:30'), radiologistName: 'Dr. Lucy Adhiambo', impression: 'No acute cardiopulmonary process.' },
      ] },
      billingLines: { create: [
        { description: 'Casualty Triage & Observation', code: 'CAS-001', amount: 4800, payer: 'SELF_PAY', status: 'PAID', mpesaReference: 'QWX9M4L2VT', createdById: billingBrenda.id },
        { description: 'Troponin Panel, serial', code: 'LAB-052', amount: 3400, payer: 'SHA', status: 'PENDING', createdById: billingBrenda.id },
      ] },
    },
  })

  // 6. Akinyi Odera Achieng — General Ward — malaria
  const akinyi = await prisma.patient.create({
    data: {
      ipNumber: 'IP/2026/04561', nationalId: '35120876', name: 'Akinyi Odera Achieng',
      dob: birthDate(29), sex: 'FEMALE', bloodType: 'O Positive',
      nextOfKinName: 'Brian Odera', phone: '+254 706 552 813', nextOfKinPhone: '+254 708 337 129', nextOfKinRelation: 'Sibling',
      allergies: [], codeStatus: 'FULL_CODE',
      chiefComplaint: 'Three days of fever, chills, and headache; positive malaria rapid diagnostic test at triage.',
      assessment: 'Uncomplicated P. falciparum malaria, responding well to IV artesunate, afebrile for 12 hours.',
      carePlan: ['Complete IV artesunate course', 'Transition to oral ACT once tolerating orally', 'Repeat blood film before discharge'],
      avatarInitials: 'AA', wardId: wards.get('General Ward')!.id, bed: 'Bed 20',
      primaryPhysicianId: drWafula.id, status: 'ADMITTED', admittedAt: daysAgo(1),
      vitals: { create: [
        { label: 'Heart Rate', value: '102', unit: 'bpm', status: 'WARNING' },
        { label: 'Blood Pressure', value: '108/70', unit: 'mmHg', status: 'HEALTHY' },
        { label: 'SpO₂', value: '97', unit: '%', status: 'HEALTHY' },
        { label: 'Temperature', value: '99.9', unit: '°F', status: 'WARNING' },
        { label: 'Resp. Rate', value: '18', unit: '/min', status: 'HEALTHY' },
      ] },
      labs: { create: [
        { test: 'Malaria Blood Film', result: 'Positive, P. falciparum', range: 'Negative', flag: 'HIGH', collectedAt: nairobi(today, '04:50') },
        { test: 'White Blood Cell Count', result: '5.1 x10⁹/L', range: '4.5 – 11.0 x10⁹/L', flag: 'NORMAL', collectedAt: nairobi(today, '04:50') },
      ] },
      imaging: { create: [] },
      billingLines: { create: [
        { description: 'General Ward Room & Board', code: 'GEN-002', amount: 9800, payer: 'SHA', status: 'PENDING', createdById: billingBrenda.id },
        { description: 'IV Artesunate, course', code: 'PHARM-093', amount: 2600, payer: 'SELF_PAY', status: 'PAID', mpesaReference: 'LKD3P8N5RC', createdById: billingBrenda.id },
      ] },
    },
  })

  // 7. Fatuma Ali Mohamed — Casualty — paediatric asthma exacerbation
  await prisma.patient.create({
    data: {
      ipNumber: 'IP/2026/04570', nationalId: null, name: 'Fatuma Ali Mohamed',
      dob: birthDate(8), sex: 'FEMALE', bloodType: 'AB Positive',
      nextOfKinName: 'Khadija Mohamed', phone: '+254 745 330 671', nextOfKinPhone: '+254 726 884 213', nextOfKinRelation: 'Parent',
      allergies: ['Dust mites'], codeStatus: 'FULL_CODE',
      chiefComplaint: 'Acute wheeze and shortness of breath, known asthmatic, poor response to home inhaler.',
      assessment: 'Moderate asthma exacerbation, improving with nebulised salbutamol and oral steroids.',
      carePlan: ['Continue 4-hourly nebulisation', 'Oral prednisolone, 3-day course', 'Asthma action plan review before discharge'],
      avatarInitials: 'FM', wardId: wards.get('Casualty')!.id, bed: 'Bed 5',
      primaryPhysicianId: drAbdi.id, status: 'ADMITTED', admittedAt: daysAgo(0),
      vitals: { create: [
        { label: 'Heart Rate', value: '118', unit: 'bpm', status: 'WARNING' },
        { label: 'Blood Pressure', value: '102/64', unit: 'mmHg', status: 'HEALTHY' },
        { label: 'SpO₂', value: '94', unit: '%', status: 'WARNING' },
        { label: 'Temperature', value: '98.1', unit: '°F', status: 'HEALTHY' },
        { label: 'Resp. Rate', value: '28', unit: '/min', status: 'WARNING' },
      ] },
      labs: { create: [] },
      imaging: { create: [
        { study: 'Chest X-Ray, 1 view', modality: 'XR', performedAt: nairobi(today, '09:10'), radiologistName: 'Dr. James Kariuki', impression: 'Hyperinflated lung fields, no focal consolidation.' },
      ] },
      billingLines: { create: [
        { description: 'Casualty Triage & Observation', code: 'CAS-001', amount: 4800, payer: 'SHA', status: 'PENDING', createdById: billingBrenda.id },
        { description: 'Nebuliser Treatment, per session', code: 'PHARM-027', amount: 950, payer: 'SELF_PAY', status: 'PAID', mpesaReference: 'HTG6W1K8YB', createdById: billingBrenda.id },
      ] },
    },
  })

  // 8. Mutua Musyoka Kioko — Cardiac ICU — post-CABG day 3
  await prisma.patient.create({
    data: {
      ipNumber: 'IP/2026/04580', nationalId: '15602398', name: 'Mutua Musyoka Kioko',
      dob: birthDate(72), sex: 'MALE', bloodType: 'B Negative',
      nextOfKinName: 'Grace Musyoka', phone: '+254 799 104 288', nextOfKinPhone: '+254 733 774 502', nextOfKinRelation: 'Spouse',
      allergies: ['Iodine contrast'], codeStatus: 'FULL_CODE',
      chiefComplaint: 'Post-operative day 3 following coronary artery bypass grafting, routine recovery.',
      assessment: 'Stable post-CABG course; sternal wound clean, chest tube removed yesterday, mobilising with physiotherapy.',
      carePlan: ['Continue beta-blocker and statin', 'Daily wound checks', 'Cardiac rehabilitation referral before discharge'],
      avatarInitials: 'MK', wardId: wards.get('Cardiac ICU')!.id, bed: 'Bed 2',
      primaryPhysicianId: drNjeri.id, status: 'ADMITTED', admittedAt: daysAgo(3),
      vitals: { create: [
        { label: 'Heart Rate', value: '68', unit: 'bpm', status: 'HEALTHY' },
        { label: 'Blood Pressure', value: '122/78', unit: 'mmHg', status: 'HEALTHY' },
        { label: 'SpO₂', value: '97', unit: '%', status: 'HEALTHY' },
        { label: 'Temperature', value: '98.6', unit: '°F', status: 'HEALTHY' },
        { label: 'Resp. Rate', value: '16', unit: '/min', status: 'HEALTHY' },
      ] },
      labs: { create: [
        { test: 'Haemoglobin', result: '11.4 g/dL', range: '13.5 – 17.5 g/dL', flag: 'LOW', collectedAt: nairobi(today, '05:00') },
        { test: 'Potassium', result: '4.1 mmol/L', range: '3.5 – 5.1 mmol/L', flag: 'NORMAL', collectedAt: nairobi(today, '05:00') },
      ] },
      imaging: { create: [
        { study: 'Chest X-Ray, portable', modality: 'XR', performedAt: daysAgo(1), radiologistName: 'Dr. Lucy Adhiambo', impression: 'Post-sternotomy changes, no effusion, lungs clear.' },
      ] },
      billingLines: { create: [
        { description: 'ICU Room & Board — Level 3', code: 'ICU-014', amount: 48200, payer: 'SHA', status: 'PAID', createdById: billingBrenda.id },
        { description: 'Coronary Artery Bypass Grafting', code: 'CARD-051', amount: 620000, payer: 'IMARA_HEALTH_ASSURANCE', status: 'PAID', createdById: billingBrenda.id },
      ] },
    },
  })

  const richPatientCountByWard: Record<string, number> = {
    'Cardiac ICU': 2,
    'General Ward': 2,
    'High Dependency Unit': 1,
    'Maternity Ward': 1,
    Casualty: 2,
  }

  console.log('Seeding filler patients to fill out realistic ward occupancy...')
  let genIndex = 0
  let bedCounter = 100 // rich patients already used low bed numbers; fillers start well clear of them
  for (const [wardName, ward] of wards) {
    const fillerCount = ward.targetOccupied - (richPatientCountByWard[wardName] ?? 0)
    for (let i = 0; i < fillerCount; i++) {
      const sex: Sex = genIndex % 2 === 0 ? 'MALE' : 'FEMALE'
      const person = generatedPerson(genIndex, sex)
      const nok = generatedPerson(genIndex + 53, genIndex % 2 === 0 ? 'FEMALE' : 'MALE')
      const age = 19 + (genIndex % 65)
      await prisma.patient.create({
        data: {
          ipNumber: `IP/2026/${(6000 + genIndex).toString().padStart(5, '0')}`,
          name: person.name,
          dob: birthDate(age),
          sex,
          bloodType: BLOOD_TYPES[genIndex % BLOOD_TYPES.length],
          nextOfKinName: nok.name,
          phone: generatedPhone(genIndex + 900),
          nextOfKinPhone: generatedPhone(genIndex),
          nextOfKinRelation: RELATIONS[genIndex % RELATIONS.length],
          avatarInitials: `${person.first[0]}${person.surname[0]}`,
          wardId: ward.id,
          bed: `Bed ${bedCounter++}`,
          primaryPhysicianId: physicians[genIndex % physicians.length].id,
          status: 'ADMITTED', admittedAt: daysAgo(genIndex % 6),
        },
      })
      genIndex++
    }
    bedCounter = 100 // reset bed numbering per ward
  }

  console.log('Seeding today\'s surgical schedule (with one deliberate room collision)...')
  const surgeryPatientDefs = [
    { ip: 'IP/2026/05001', name: 'Margaret Chege', sex: 'FEMALE' as Sex, age: 41 },
    { ip: 'IP/2026/05002', name: 'James Otieno', sex: 'MALE' as Sex, age: 58 },
    { ip: 'IP/2026/05003', name: 'Sarah Wambui', sex: 'FEMALE' as Sex, age: 63 },
    { ip: 'IP/2026/05004', name: 'Daniel Kimani', sex: 'MALE' as Sex, age: 34 },
    { ip: 'IP/2026/05005', name: 'Hellen Njoroge', sex: 'FEMALE' as Sex, age: 70 },
    { ip: 'IP/2026/05006', name: 'Nancy Achieng', sex: 'FEMALE' as Sex, age: 46 },
    { ip: 'IP/2026/05007', name: 'Felix Rotich', sex: 'MALE' as Sex, age: 52 },
  ]
  const surgeryPatients = new Map<string, string>()
  for (const [i, d] of surgeryPatientDefs.entries()) {
    const initials = d.name.split(' ').map((p) => p[0]).join('')
    const p = await prisma.patient.create({
      data: {
        ipNumber: d.ip, name: d.name, dob: birthDate(d.age), sex: d.sex,
        bloodType: BLOOD_TYPES[i % BLOOD_TYPES.length],
        nextOfKinName: generatedPerson(200 + i, d.sex === 'MALE' ? 'FEMALE' : 'MALE').name,
        phone: generatedPhone(500 + i), nextOfKinPhone: generatedPhone(200 + i), nextOfKinRelation: RELATIONS[i % RELATIONS.length],
        avatarInitials: initials, wardId: wards.get('General Ward')!.id, bed: `Pre-op ${i + 1}`,
        primaryPhysicianId: physicians[i % physicians.length].id, status: 'ADMITTED', admittedAt: daysAgo(1),
      },
    })
    surgeryPatients.set(d.ip, p.id)
  }

  await prisma.surgery.createMany({
    data: [
      { patientId: surgeryPatients.get('IP/2026/05001')!, procedure: 'Laparoscopic Cholecystectomy', surgeonId: drKiptoo.id, room: 'OR_1', startsAt: nairobi(today, '07:30'), endsAt: nairobi(today, '09:00'), status: 'CONFIRMED' },
      { patientId: surgeryPatients.get('IP/2026/05002')!, procedure: 'Total Knee Arthroplasty', surgeonId: drWafula.id, room: 'OR_2', startsAt: nairobi(today, '08:00'), endsAt: nairobi(today, '10:30'), status: 'IN_PROGRESS' },
      { patientId: surgeryPatients.get('IP/2026/05003')!, procedure: 'Coronary Artery Bypass', surgeonId: drNjeri.id, room: 'OR_3', startsAt: nairobi(today, '07:00'), endsAt: nairobi(today, '11:00'), status: 'CONFIRMED' },
      { patientId: surgeryPatients.get('IP/2026/05004')!, procedure: 'Appendectomy', surgeonId: drKiptoo.id, room: 'OR_1', startsAt: nairobi(today, '08:45'), endsAt: nairobi(today, '10:00'), status: 'DELAYED' },
      { patientId: surgeryPatients.get('IP/2026/05005')!, procedure: 'Cataract Extraction', surgeonId: drAbdi.id, room: 'OR_4', startsAt: nairobi(today, '08:30'), endsAt: nairobi(today, '09:15'), status: 'CONFIRMED' },
      { patientId: surgeryPatients.get('IP/2026/05006')!, procedure: 'Spinal Fusion, L4-L5', surgeonId: drWafula.id, room: 'OR_2', startsAt: nairobi(today, '11:00'), endsAt: nairobi(today, '14:30'), status: 'CONFIRMED' },
      { patientId: surgeryPatients.get('IP/2026/05007')!, procedure: 'Hernia Repair', surgeonId: drAbdi.id, room: 'OR_4', startsAt: nairobi(today, '10:30'), endsAt: nairobi(today, '11:45'), status: 'CONFIRMED' },
    ],
  })

  console.log('Seeding alerts...')
  await prisma.alert.create({
    data: { severity: 'CRITICAL', message: 'ICU-4 ventilator inventory below threshold', wardId: wards.get('Cardiac ICU')!.id },
  })
  await prisma.alert.create({
    data: { severity: 'WARNING', message: 'Casualty approaching capacity (26/30)', wardId: wards.get('Casualty')!.id },
  })
  await prisma.alert.create({
    data: {
      severity: 'HEALTHY', message: 'Pharmacy restock completed — Maternity Ward', wardId: wards.get('Maternity Ward')!.id,
      resolved: true, resolvedById: admin.id, resolvedAt: daysAgo(0),
    },
  })

  console.log('Seeding pharmacy formulary...')
  // Indicative Nairobi private-hospital unit prices, in KES. kemlListed marks
  // the Kenya Essential Medicines List, which is what SHA benefit rules and
  // county stock-out returns key off.
  const drugDefs = [
    { code: 'PHARM-118', genericName: 'Furosemide', brandName: 'Lasix', form: 'INJECTION' as const, strength: '20mg/2ml', unit: 'ampoule', kemlListed: true, unitPrice: 850, reorderLevel: 40 },
    { code: 'PHARM-076', genericName: 'Ceftriaxone', brandName: 'Rocephin', form: 'INJECTION' as const, strength: '1g', unit: 'vial', kemlListed: true, unitPrice: 640, reorderLevel: 60 },
    { code: 'PHARM-093', genericName: 'Artesunate', form: 'INJECTION' as const, strength: '60mg', unit: 'vial', kemlListed: true, unitPrice: 1300, reorderLevel: 30 },
    { code: 'PHARM-027', genericName: 'Salbutamol', brandName: 'Ventolin', form: 'INHALER' as const, strength: '100mcg', unit: 'inhaler', kemlListed: true, unitPrice: 950, reorderLevel: 25 },
    { code: 'PHARM-004', genericName: 'Paracetamol', form: 'TABLET' as const, strength: '500mg', unit: 'tablet', kemlListed: true, unitPrice: 12, reorderLevel: 500 },
    { code: 'PHARM-011', genericName: 'Amoxicillin', form: 'CAPSULE' as const, strength: '500mg', unit: 'capsule', kemlListed: true, unitPrice: 28, reorderLevel: 300 },
    { code: 'PHARM-052', genericName: 'Enalapril', form: 'TABLET' as const, strength: '5mg', unit: 'tablet', kemlListed: true, unitPrice: 22, reorderLevel: 200 },
    { code: 'PHARM-061', genericName: 'Metformin', form: 'TABLET' as const, strength: '500mg', unit: 'tablet', kemlListed: true, unitPrice: 15, reorderLevel: 400 },
    { code: 'PHARM-088', genericName: 'Nifedipine', form: 'TABLET' as const, strength: '20mg', unit: 'tablet', kemlListed: true, unitPrice: 30, reorderLevel: 150 },
    { code: 'PHARM-090', genericName: 'Magnesium Sulphate', form: 'INJECTION' as const, strength: '5g/10ml', unit: 'ampoule', kemlListed: true, unitPrice: 480, reorderLevel: 20 },
    { code: 'PHARM-102', genericName: 'Morphine Sulphate', form: 'INJECTION' as const, strength: '10mg/ml', unit: 'ampoule', kemlListed: true, controlled: true, unitPrice: 720, reorderLevel: 15 },
    { code: 'PHARM-131', genericName: 'Artemether/Lumefantrine', brandName: 'Coartem', form: 'TABLET' as const, strength: '20/120mg', unit: 'tablet', kemlListed: true, unitPrice: 45, reorderLevel: 240 },
    { code: 'PHARM-140', genericName: 'Omeprazole', form: 'CAPSULE' as const, strength: '20mg', unit: 'capsule', kemlListed: true, unitPrice: 35, reorderLevel: 200 },
    { code: 'PHARM-155', genericName: 'Benzylpenicillin', form: 'INJECTION' as const, strength: '1MU', unit: 'vial', kemlListed: true, unitPrice: 210, reorderLevel: 50 },
  ]

  const drugs = new Map<string, string>()
  for (const d of drugDefs) {
    const created = await prisma.drug.create({ data: { ...d, controlled: d.controlled ?? false } })
    drugs.set(d.code, created.id)
  }

  console.log('Seeding drug batches...')
  function inMonths(months: number) {
    const d = new Date()
    d.setMonth(d.getMonth() + months)
    return d
  }

  // Most lines carry two batches with different expiries so FEFO allocation
  // has something real to choose between. Salbutamol is deliberately seeded
  // below its reorder level and Magnesium Sulphate short-dated, so the
  // low-stock and expiring-soon views are not empty on a fresh install.
  const batchDefs = [
    { code: 'PHARM-118', batchNumber: 'FUR-2411A', months: 5, quantity: 120, supplier: 'Surgipharm' },
    { code: 'PHARM-118', batchNumber: 'FUR-2503B', months: 14, quantity: 200, supplier: 'Surgipharm' },
    { code: 'PHARM-076', batchNumber: 'CEF-2412C', months: 8, quantity: 180, supplier: 'Laborex Kenya' },
    { code: 'PHARM-076', batchNumber: 'CEF-2601D', months: 20, quantity: 240, supplier: 'Laborex Kenya' },
    { code: 'PHARM-093', batchNumber: 'ART-2502E', months: 11, quantity: 90, supplier: 'KEMSA' },
    { code: 'PHARM-027', batchNumber: 'SAL-2410F', months: 4, quantity: 18, supplier: 'Phillips Pharmaceuticals' },
    { code: 'PHARM-004', batchNumber: 'PCM-2505G', months: 22, quantity: 4200, supplier: 'Cosmos Pharmaceuticals' },
    { code: 'PHARM-011', batchNumber: 'AMX-2504H', months: 16, quantity: 1600, supplier: 'Cosmos Pharmaceuticals' },
    { code: 'PHARM-052', batchNumber: 'ENA-2506J', months: 19, quantity: 900, supplier: 'Surgipharm' },
    { code: 'PHARM-061', batchNumber: 'MET-2507K', months: 24, quantity: 2400, supplier: 'Cosmos Pharmaceuticals' },
    { code: 'PHARM-088', batchNumber: 'NIF-2503L', months: 13, quantity: 640, supplier: 'Laborex Kenya' },
    { code: 'PHARM-090', batchNumber: 'MGS-2409M', months: 2, quantity: 46, supplier: 'KEMSA' },
    { code: 'PHARM-102', batchNumber: 'MOR-2505N', months: 17, quantity: 60, supplier: 'KEMSA' },
    { code: 'PHARM-131', batchNumber: 'COA-2502P', months: 9, quantity: 720, supplier: 'KEMSA' },
    { code: 'PHARM-131', batchNumber: 'COA-2508Q', months: 21, quantity: 960, supplier: 'KEMSA' },
    { code: 'PHARM-140', batchNumber: 'OME-2506R', months: 18, quantity: 850, supplier: 'Surgipharm' },
    { code: 'PHARM-155', batchNumber: 'BPN-2504S', months: 12, quantity: 140, supplier: 'Laborex Kenya' },
  ]

  for (const b of batchDefs) {
    const drugId = drugs.get(b.code)!
    const batch = await prisma.drugBatch.create({
      data: {
        drugId,
        batchNumber: b.batchNumber,
        expiryDate: inMonths(b.months),
        quantity: b.quantity,
        supplier: b.supplier,
        receivedAt: daysAgo(30),
      },
    })
    await prisma.stockMovement.create({
      data: {
        drugId,
        batchId: batch.id,
        type: 'RECEIPT',
        quantity: b.quantity,
        balanceAfter: b.quantity,
        reason: `Opening stock - ${b.supplier}`,
        performedById: pharmJoseph.id,
        createdAt: daysAgo(30),
      },
    })
  }

  console.log('Seeding prescriptions...')

  // Grace - Cardiac ICU, decompensated heart failure. Note her recorded
  // penicillin allergy: prescribing Benzylpenicillin for her through the API
  // is refused unless the prescriber supplies an override reason.
  await prisma.prescription.create({
    data: {
      patientId: grace.id,
      prescriberId: drNjeri.id,
      status: 'PARTIALLY_DISPENSED',
      notes: 'Diurese to euvolaemia; daily U/E while on IV furosemide.',
      items: {
        create: withDoses([
          { drugId: drugs.get('PHARM-118')!, dose: '40mg', route: 'IV', frequency: 'BD', durationDays: 3, quantityPrescribed: 6, quantityDispensed: 4, instructions: 'Give slowly over 2 minutes.' },
          { drugId: drugs.get('PHARM-052')!, dose: '5mg', route: 'PO', frequency: 'OD', durationDays: 14, quantityPrescribed: 14, quantityDispensed: 0 },
        ]),
      },
    },
  })

  // Amina - Maternity, pre-eclampsia.
  await prisma.prescription.create({
    data: {
      patientId: amina.id,
      prescriberId: drWafula.id,
      status: 'ACTIVE',
      notes: 'MgSO4 per eclampsia protocol; monitor reflexes and urine output hourly.',
      items: {
        create: withDoses([
          { drugId: drugs.get('PHARM-090')!, dose: '4g loading', route: 'IV', frequency: 'STAT', quantityPrescribed: 2, quantityDispensed: 0 },
          { drugId: drugs.get('PHARM-088')!, dose: '20mg', route: 'PO', frequency: 'TDS', durationDays: 5, quantityPrescribed: 15, quantityDispensed: 0 },
        ]),
      },
    },
  })

  // Akinyi - General Ward, malaria.
  await prisma.prescription.create({
    data: {
      patientId: akinyi.id,
      prescriberId: drAbdi.id,
      status: 'ACTIVE',
      notes: 'Step down to oral AL once tolerating fluids.',
      items: {
        create: withDoses([
          { drugId: drugs.get('PHARM-093')!, dose: '120mg', route: 'IV', frequency: 'At 0, 12, 24h', quantityPrescribed: 3, quantityDispensed: 0 },
          { drugId: drugs.get('PHARM-131')!, dose: '4 tabs', route: 'PO', frequency: 'BD', durationDays: 3, quantityPrescribed: 24, quantityDispensed: 0 },
          { drugId: drugs.get('PHARM-004')!, dose: '1g', route: 'PO', frequency: 'QDS PRN', durationDays: 3, quantityPrescribed: 12, quantityDispensed: 0 },
        ]),
      },
    },
  })

  // Peter - General Ward, post-appendectomy.
  await prisma.prescription.create({
    data: {
      patientId: peter.id,
      prescriberId: drKiptoo.id,
      status: 'ACTIVE',
      notes: 'Analgesia ladder; discontinue IV antibiotics at 48h if afebrile.',
      items: {
        create: withDoses([
          { drugId: drugs.get('PHARM-076')!, dose: '1g', route: 'IV', frequency: 'OD', durationDays: 3, quantityPrescribed: 3, quantityDispensed: 0 },
          { drugId: drugs.get('PHARM-102')!, dose: '5mg', route: 'IM', frequency: 'PRN 6-hourly', quantityPrescribed: 4, quantityDispensed: 0, instructions: 'Controlled drug - record in the DDA register on issue.' },
        ]),
      },
    },
  })

  console.log('Seeding lab catalogue...')
  // Reference ranges are adult values; the flag is derived from these rather
  // than typed at the bench.
  const labTests = [
    { code: 'HAEM-001', name: 'Full Haemogram', department: 'Haematology', specimen: 'EDTA blood', unit: 'x10^9/L', refLow: 4.0, refHigh: 11.0, refRange: '4.0-11.0', price: 900, turnaroundMins: 60 },
    { code: 'HAEM-004', name: 'Haemoglobin', department: 'Haematology', specimen: 'EDTA blood', unit: 'g/dL', refLow: 12.0, refHigh: 16.0, refRange: '12.0-16.0', price: 450, turnaroundMins: 45 },
    { code: 'HAEM-010', name: 'Platelet Count', department: 'Haematology', specimen: 'EDTA blood', unit: 'x10^9/L', refLow: 150, refHigh: 450, refRange: '150-450', price: 500, turnaroundMins: 45 },
    { code: 'CHEM-020', name: 'Serum Potassium', department: 'Chemistry', specimen: 'Serum', unit: 'mmol/L', refLow: 3.5, refHigh: 5.1, refRange: '3.5-5.1', price: 700, turnaroundMins: 90 },
    { code: 'CHEM-021', name: 'Serum Creatinine', department: 'Chemistry', specimen: 'Serum', unit: 'umol/L', refLow: 60, refHigh: 110, refRange: '60-110', price: 850, turnaroundMins: 90 },
    { code: 'CHEM-030', name: 'Random Blood Sugar', department: 'Chemistry', specimen: 'Fluoride plasma', unit: 'mmol/L', refLow: 3.9, refHigh: 7.8, refRange: '3.9-7.8', price: 300, turnaroundMins: 30 },
    { code: 'CARD-052', name: 'Troponin I', department: 'Chemistry', specimen: 'Serum', unit: 'ng/mL', refLow: null, refHigh: 0.04, refRange: '<0.04', price: 3400, turnaroundMins: 60 },
    // Qualitative: no numeric bounds, so the technologist sets the flag.
    { code: 'MICR-001', name: 'Malaria Rapid Diagnostic Test', department: 'Microbiology', specimen: 'Whole blood', unit: null, refLow: null, refHigh: null, refRange: 'Negative', price: 400, turnaroundMins: 20 },
    { code: 'MICR-005', name: 'Blood Culture', department: 'Microbiology', specimen: 'Blood culture bottle', unit: null, refLow: null, refHigh: null, refRange: 'No growth', price: 2800, turnaroundMins: 4320 },
    { code: 'MICR-012', name: 'Urinalysis', department: 'Microbiology', specimen: 'Mid-stream urine', unit: null, refLow: null, refHigh: null, refRange: 'Normal', price: 600, turnaroundMins: 40 },
    { code: 'SERO-002', name: 'HIV Rapid Test', department: 'Serology', specimen: 'Whole blood', unit: null, refLow: null, refHigh: null, refRange: 'Non-reactive', price: 0, turnaroundMins: 30 },
  ]
  for (const t of labTests) {
    await prisma.labTest.create({ data: { ...t, price: t.price } })
  }

  console.log('Seeding queue stations...')
  const stationDefs = [
    { code: 'REC-1', name: 'Reception Desk 1', kind: 'RECEPTION', tokenPrefix: 'R', room: 'Front Desk' },
    { code: 'TRI-1', name: 'Triage', kind: 'TRIAGE', tokenPrefix: 'T', room: 'Triage Room' },
    { code: 'CASH-1', name: 'Cashier', kind: 'CASHIER', tokenPrefix: 'B', room: 'Cash Office' },
    { code: 'CONS-1', name: 'Consultation Room 1', kind: 'CONSULTATION', tokenPrefix: 'C', room: 'Room 1' },
    { code: 'CONS-2', name: 'Consultation Room 2', kind: 'CONSULTATION', tokenPrefix: 'C', room: 'Room 2' },
    { code: 'CONS-3', name: 'Consultation Room 3', kind: 'CONSULTATION', tokenPrefix: 'C', room: 'Room 3' },
    // Renders as a bare token on the public board — the clinic name alone
    // would disclose a diagnosis to everyone in the waiting room.
    { code: 'CCC-1', name: 'Comprehensive Care Clinic', kind: 'CONSULTATION', tokenPrefix: 'P', room: 'Room 8', privateClinic: true },
    { code: 'LAB-1', name: 'Laboratory', kind: 'LAB', tokenPrefix: 'L', room: 'Lab Reception' },
    { code: 'IMG-1', name: 'Radiology', kind: 'IMAGING', tokenPrefix: 'X', room: 'X-Ray Suite' },
    { code: 'PHA-1', name: 'Pharmacy Window', kind: 'PHARMACY', tokenPrefix: 'D', room: 'Pharmacy' },
  ]
  for (const st of stationDefs) {
    await prisma.station.create({ data: { ...st, kind: st.kind as never } })
  }

  console.log('Seeding biomedical devices...')
  const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000)
  const deviceDefs = [
    { assetTag: 'BME-0121', name: 'IntelliVue MX450 — ICU Bay 1', kind: 'PATIENT_MONITOR', manufacturer: 'Philips', model: 'MX450', transport: 'HL7_MLLP', hl7SendingApplication: 'PHILIPS_MX450_A', ipAddress: '10.20.4.11', ward: 'Cardiac ICU', bed: 'Bed 1', serviceDueAt: days(120), calibrationDueAt: days(60) },
    { assetTag: 'BME-0122', name: 'IntelliVue MX450 — ICU Bay 2', kind: 'PATIENT_MONITOR', manufacturer: 'Philips', model: 'MX450', transport: 'HL7_MLLP', hl7SendingApplication: 'PHILIPS_MX450_B', ipAddress: '10.20.4.12', ward: 'Cardiac ICU', bed: 'Bed 2', serviceDueAt: days(-14), calibrationDueAt: days(45) },
    { assetTag: 'BME-0210', name: 'BeneVision N12 — HDU', kind: 'PATIENT_MONITOR', manufacturer: 'Mindray', model: 'N12', transport: 'HL7_MLLP', hl7SendingApplication: 'MINDRAY_N12_HDU', ipAddress: '10.20.4.31', ward: 'High Dependency Unit', bed: 'Bed 4', serviceDueAt: days(200), calibrationDueAt: days(-5) },
    { assetTag: 'BME-0340', name: 'Cobas c311 Chemistry Analyser', kind: 'LAB_ANALYSER', manufacturer: 'Roche', model: 'c311', transport: 'HL7_MLLP', hl7SendingApplication: 'ROCHE_C311', ipAddress: '10.20.6.5', ward: null, bed: null, serviceDueAt: days(75), calibrationDueAt: days(20) },
    { assetTag: 'BME-0402', name: 'Alaris GP Volumetric Pump', kind: 'INFUSION_PUMP', manufacturer: 'BD', model: 'Alaris GP', transport: 'MANUAL', hl7SendingApplication: null, ipAddress: null, ward: 'General Ward', bed: 'Bed 12', serviceDueAt: days(30), calibrationDueAt: days(30) },
    { assetTag: 'BME-0455', name: 'Savina 300 Ventilator', kind: 'VENTILATOR', manufacturer: 'Draeger', model: 'Savina 300', transport: 'MANUAL', hl7SendingApplication: null, ipAddress: null, ward: 'Cardiac ICU', bed: 'Bed 3', serviceDueAt: days(-3), calibrationDueAt: days(90) },
    { assetTag: 'BME-0510', name: 'Seca 878 Floor Scale — Casualty', kind: 'WEIGHING_SCALE', manufacturer: 'Seca', model: '878', transport: 'SERIAL_BRIDGE', hl7SendingApplication: null, ipAddress: null, ward: 'Casualty', bed: null, serviceDueAt: days(150), calibrationDueAt: days(150) },
    { assetTag: 'BME-0620', name: 'Nellcor PM10N Pulse Oximeter', kind: 'PULSE_OXIMETER', manufacturer: 'Medtronic', model: 'PM10N', transport: 'MANUAL', hl7SendingApplication: null, ipAddress: null, ward: 'Maternity Ward', bed: null, serviceDueAt: days(60), calibrationDueAt: days(60) },
  ]
  for (const d of deviceDefs) {
    const { ward, ...rest } = d
    await prisma.device.create({
      data: {
        ...rest,
        kind: rest.kind as never,
        transport: rest.transport as never,
        status: rest.transport === 'MANUAL' ? 'ONLINE' : 'OFFLINE',
        wardId: ward ? wards.get(ward)!.id : null,
        commissionedAt: days(-540),
        lastServicedAt: days(-180),
      },
    })
  }

  console.log('Seeding hospital metrics...')
  await prisma.hospitalMetric.createMany({
    data: [
      { key: 'casualty_wait_time', label: 'Casualty Wait Time', value: '38 min', delta: '+6 min vs last wk', trend: 'up' },
      { key: 'staff_on_shift', label: 'Staff on Shift', value: '212', delta: 'nominal', trend: 'flat' },
    ],
  })

  console.log('\nSeed complete.')
  console.log('Pharmacy: 14 formulary lines, 17 batches, 4 live prescriptions.')
  console.log('Demo login — any staff email above with password: Passw0rd!')
  console.log(`Featured patient: ${grace.name} (${grace.ipNumber})`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
