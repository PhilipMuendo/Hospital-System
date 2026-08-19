import { PrintDocument, PrintFields, PrintSection, PrintTable } from './PrintDocument'
import { calculateAge, formatDate, formatDateTime, formatKES } from '../../lib/format'

const payerLabel: Record<string, string> = {
  SHA: 'SHA (Social Health Authority)',
  IMARA_HEALTH_ASSURANCE: 'Imara Health Assurance',
  SELF_PAY: 'Self-Pay',
}

const sexLabel: Record<string, string> = { MALE: 'Male', FEMALE: 'Female', INTERSEX: 'Intersex' }

const codeStatusLabel: Record<string, string> = {
  FULL_CODE: 'Full Code',
  DNR: 'Do Not Resuscitate',
  DNI: 'Do Not Intubate',
  COMFORT_CARE: 'Comfort Care',
}

/* ------------------------------------------------------------------ */
/* Discharge summary                                                   */
/* ------------------------------------------------------------------ */

export function DischargeSummaryDoc({ data }: { data: any }) {
  const p = data.patient
  const los = p.dischargedAt
    ? Math.max(
        1,
        Math.round((new Date(p.dischargedAt).getTime() - new Date(p.admittedAt).getTime()) / 86400000),
      )
    : Math.max(1, Math.round((Date.now() - new Date(p.admittedAt).getTime()) / 86400000))

  return (
    <PrintDocument
      title="Discharge Summary"
      subtitle="Discharge Summary"
      reference={p.ipNumber}
      meta={[
        { label: 'IP Number', value: p.ipNumber },
        { label: 'Admitted', value: formatDate(p.admittedAt) },
        {
          label: p.dischargedAt ? 'Discharged' : 'Status',
          value: p.dischargedAt ? formatDate(p.dischargedAt) : 'Still admitted',
        },
        { label: 'Length of Stay', value: `${los} day${los === 1 ? '' : 's'}` },
      ]}
      note="This summary is issued for continuity of care. Please present it to your next treating clinician. Queries: records@uzimageneral.ke"
      signatories={[
        { role: 'Attending Physician', name: p.physician },
        { role: 'Patient / Guardian' },
      ]}
    >
      <PrintSection heading="Patient Identification">
        <PrintFields
          fields={[
            { label: 'Full Name', value: p.name },
            { label: 'National ID', value: p.nationalId ?? 'Not on file' },
            { label: 'Date of Birth', value: `${formatDate(p.dob)} (${calculateAge(p.dob)} yrs)` },
            { label: 'Sex', value: sexLabel[p.sex] ?? p.sex },
            { label: 'Blood Type', value: p.bloodType },
            { label: 'Telephone', value: p.phone ?? 'Not on file' },
            { label: 'Ward / Bed', value: `${p.ward} · ${p.bed}` },
            { label: 'Code Status', value: codeStatusLabel[p.codeStatus] ?? p.codeStatus },
            {
              label: 'Next of Kin',
              value: `${p.nextOfKin.name} (${p.nextOfKin.relation}) · ${p.nextOfKin.phone}`,
            },
            {
              label: 'Known Allergies',
              value: p.allergies.length > 0 ? p.allergies.join(', ') : 'None recorded',
            },
          ]}
        />
      </PrintSection>

      <PrintSection heading="Presenting Complaint & Assessment">
        <p style={{ margin: '0 0 2mm' }}>
          <strong>Chief complaint:</strong> {p.chiefComplaint ?? 'Not recorded'}
        </p>
        <p style={{ margin: 0 }}>
          <strong>Assessment:</strong> {p.assessment ?? 'Not recorded'}
        </p>
      </PrintSection>

      {p.carePlan?.length > 0 && (
        <PrintSection heading="Care Plan">
          <ol style={{ margin: 0, paddingLeft: '5mm' }}>
            {p.carePlan.map((c: string, i: number) => (
              <li key={i} style={{ marginBottom: '1mm' }}>
                {c}
              </li>
            ))}
          </ol>
        </PrintSection>
      )}

      {data.surgeries?.length > 0 && (
        <PrintSection heading="Procedures Performed">
          <PrintTable
            columns={[
              { key: 'p', label: 'Procedure' },
              { key: 's', label: 'Surgeon' },
              { key: 'd', label: 'Date' },
              { key: 'st', label: 'Status' },
            ]}
          >
            {data.surgeries.map((s: any, i: number) => (
              <tr key={i}>
                <td>{s.procedure}</td>
                <td>{s.surgeon}</td>
                <td>{formatDateTime(s.startsAt)}</td>
                <td>{s.status}</td>
              </tr>
            ))}
          </PrintTable>
        </PrintSection>
      )}

      {data.labs?.length > 0 && (
        <PrintSection heading="Laboratory Results">
          <PrintTable
            columns={[
              { key: 't', label: 'Test' },
              { key: 'r', label: 'Result' },
              { key: 'g', label: 'Reference Range' },
              { key: 'f', label: 'Flag' },
              { key: 'c', label: 'Collected' },
            ]}
          >
            {data.labs.slice(0, 15).map((l: any) => (
              <tr key={l.id}>
                <td>{l.test}</td>
                <td className="num">{l.result}</td>
                <td>{l.range}</td>
                <td>{l.flag === 'NORMAL' ? '—' : l.flag}</td>
                <td>{formatDate(l.collectedAt)}</td>
              </tr>
            ))}
          </PrintTable>
        </PrintSection>
      )}

      {data.imaging?.length > 0 && (
        <PrintSection heading="Imaging">
          {data.imaging.map((s: any) => (
            <div key={s.id} style={{ marginBottom: '2.5mm' }}>
              <p style={{ margin: 0, fontWeight: 600 }}>
                {s.study} ({s.modality}) — {formatDate(s.performedAt)}
              </p>
              <p style={{ margin: '0.5mm 0 0' }}>
                <em>Reported by {s.radiologistName}:</em> {s.impression}
              </p>
            </div>
          ))}
        </PrintSection>
      )}

      {data.prescriptions?.length > 0 && (
        <PrintSection heading="Discharge Medication">
          <PrintTable
            columns={[
              { key: 'd', label: 'Drug' },
              { key: 'ds', label: 'Dose' },
              { key: 'r', label: 'Route' },
              { key: 'f', label: 'Frequency' },
              { key: 'du', label: 'Duration' },
              { key: 'q', label: 'Qty', align: 'right' },
            ]}
          >
            {data.prescriptions.flatMap((pr: any) =>
              pr.items.map((i: any, ix: number) => (
                <tr key={`${pr.id}-${ix}`}>
                  <td>
                    {i.drug}
                    {i.instructions ? <div style={{ fontSize: '8pt' }}>{i.instructions}</div> : null}
                  </td>
                  <td>{i.dose}</td>
                  <td>{i.route}</td>
                  <td>{i.frequency}</td>
                  <td>{i.durationDays ? `${i.durationDays} d` : '—'}</td>
                  <td className="num">{i.quantityPrescribed}</td>
                </tr>
              )),
            )}
          </PrintTable>
        </PrintSection>
      )}
    </PrintDocument>
  )
}

/* ------------------------------------------------------------------ */
/* Invoice / statement of account                                      */
/* ------------------------------------------------------------------ */

export function InvoiceDoc({ data }: { data: any }) {
  const p = data.patient
  return (
    <PrintDocument
      title="Statement of Account"
      subtitle="Statement of Account"
      reference={`INV/${p.ipNumber.replace(/\//g, '-')}`}
      meta={[
        { label: 'IP Number', value: p.ipNumber },
        { label: 'Ward / Bed', value: `${p.ward} · ${p.bed}` },
        { label: 'Admitted', value: formatDate(p.admittedAt) },
        { label: 'Attending', value: p.physician },
      ]}
      note="This statement is a tax invoice for services rendered. Amounts are in Kenya Shillings and inclusive of applicable taxes. SHA-payable items are billed directly to the Social Health Authority; any shortfall after adjudication becomes payable by the patient. Payment by M-Pesa, card, or at the cash office."
      signatories={[{ role: 'Billing Officer' }, { role: 'Received By' }]}
    >
      <PrintSection heading="Billed To">
        <PrintFields
          fields={[
            { label: 'Patient', value: p.name },
            { label: 'National ID', value: p.nationalId ?? 'Not on file' },
            { label: 'Account Status', value: p.status === 'ADMITTED' ? 'Open (inpatient)' : 'Closed' },
            {
              label: 'Discharged',
              value: p.dischargedAt ? formatDate(p.dischargedAt) : 'Not yet discharged',
            },
          ]}
        />
      </PrintSection>

      <PrintSection heading="Charges">
        <table className="print-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Code</th>
              <th>Description</th>
              <th>Payer</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Amount (KES)</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l: any) => (
              <tr key={l.id}>
                <td>{formatDate(l.createdAt)}</td>
                <td>{l.code}</td>
                <td>
                  {l.description}
                  {l.mpesaReference ? (
                    <div style={{ fontSize: '8pt' }}>M-Pesa {l.mpesaReference}</div>
                  ) : null}
                </td>
                <td>{payerLabel[l.payer] ?? l.payer}</td>
                <td>{l.status}</td>
                <td className="num">{Number(l.amount).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>Total charged</td>
              <td className="num">{formatKES(data.totals.total)}</td>
            </tr>
            <tr>
              <td colSpan={5}>Less: settled</td>
              <td className="num">({formatKES(data.totals.paid)})</td>
            </tr>
            <tr>
              <td colSpan={5}>Balance outstanding</td>
              <td className="num">{formatKES(data.totals.outstanding)}</td>
            </tr>
          </tfoot>
        </table>
      </PrintSection>

      {data.payments?.length > 0 && (
        <PrintSection heading="Payments Received (M-Pesa)">
          <PrintTable
            columns={[
              { key: 'r', label: 'Receipt No.' },
              { key: 'd', label: 'Date' },
              { key: 'a', label: 'Amount (KES)', align: 'right' },
            ]}
          >
            {data.payments.map((pm: any, i: number) => (
              <tr key={i}>
                <td>{pm.receipt ?? '—'}</td>
                <td>{pm.at ? formatDateTime(pm.at) : '—'}</td>
                <td className="num">{Number(pm.amount).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </PrintTable>
        </PrintSection>
      )}
    </PrintDocument>
  )
}

/* ------------------------------------------------------------------ */
/* Ward census                                                         */
/* ------------------------------------------------------------------ */

export function WardCensusDoc({ data }: { data: any }) {
  return (
    <PrintDocument
      title="Daily Ward Census"
      subtitle="Daily Ward Census & Bed State"
      reference={`CENSUS/${data.date}`}
      meta={[
        { label: 'Census Date', value: formatDate(`${data.date}T00:00:00+03:00`) },
        { label: 'Total Beds', value: String(data.totals.bedCapacity) },
        { label: 'Occupied', value: String(data.totals.occupied) },
        { label: 'Occupancy', value: `${data.totals.occupancyPct}%` },
      ]}
      note="Bed state is computed live from admission records at the moment of printing. Occupancy above 85% in any ward should be escalated to the Nursing Officer in charge."
      signatories={[{ role: 'Nursing Officer in Charge' }, { role: 'Hospital Administrator' }]}
    >
      <PrintSection heading="Bed State by Ward">
        <table className="print-table">
          <thead>
            <tr>
              <th>Ward</th>
              <th style={{ textAlign: 'right' }}>Beds</th>
              <th style={{ textAlign: 'right' }}>Occupied</th>
              <th style={{ textAlign: 'right' }}>Available</th>
              <th style={{ textAlign: 'right' }}>Occupancy</th>
              <th style={{ textAlign: 'right' }}>Admissions</th>
              <th style={{ textAlign: 'right' }}>Discharges</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r: any) => (
              <tr key={r.ward}>
                <td>{r.ward}</td>
                <td className="num">{r.bedCapacity}</td>
                <td className="num">{r.occupied}</td>
                <td className="num">{r.available}</td>
                <td className="num">{r.occupancyPct}%</td>
                <td className="num">{r.admissionsToday}</td>
                <td className="num">{r.dischargesToday}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Hospital total</td>
              <td className="num">{data.totals.bedCapacity}</td>
              <td className="num">{data.totals.occupied}</td>
              <td className="num">{data.totals.available}</td>
              <td className="num">{data.totals.occupancyPct}%</td>
              <td className="num">{data.totals.admissionsToday}</td>
              <td className="num">{data.totals.dischargesToday}</td>
            </tr>
          </tfoot>
        </table>
      </PrintSection>
    </PrintDocument>
  )
}

/* ------------------------------------------------------------------ */
/* Daily revenue & M-Pesa reconciliation                               */
/* ------------------------------------------------------------------ */

export function RevenueDoc({ data }: { data: any }) {
  return (
    <PrintDocument
      title="Daily Revenue Report"
      subtitle="Daily Revenue & M-Pesa Reconciliation"
      reference={`REV/${data.date}`}
      meta={[
        { label: 'Business Date', value: formatDate(`${data.date}T00:00:00+03:00`) },
        { label: 'Charges Raised', value: formatKES(data.grandTotal) },
        { label: 'M-Pesa Receipts', value: String(data.mpesa.count) },
        { label: 'M-Pesa Collected', value: formatKES(data.mpesa.total) },
      ]}
      note="The M-Pesa section must reconcile line-for-line against the Safaricom paybill statement for the same business date. Any receipt appearing on the statement but not below indicates a callback that did not reach the system and must be investigated before close of business."
      signatories={[{ role: 'Cashier' }, { role: 'Finance Manager' }]}
    >
      <PrintSection heading="Revenue by Payer">
        <PrintTable
          columns={[
            { key: 'p', label: 'Payer' },
            { key: 'c', label: 'Lines', align: 'right' },
            { key: 't', label: 'Amount (KES)', align: 'right' },
          ]}
        >
          {data.byPayer.map((r: any) => (
            <tr key={r.payer}>
              <td>{payerLabel[r.payer] ?? r.payer}</td>
              <td className="num">{r.count}</td>
              <td className="num">{Number(r.total).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>

      <PrintSection heading="Revenue by Settlement Status">
        <PrintTable
          columns={[
            { key: 's', label: 'Status' },
            { key: 'c', label: 'Lines', align: 'right' },
            { key: 't', label: 'Amount (KES)', align: 'right' },
          ]}
        >
          {data.byStatus.map((r: any) => (
            <tr key={r.status}>
              <td>{r.status}</td>
              <td className="num">{r.count}</td>
              <td className="num">{Number(r.total).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>

      <PrintSection heading="M-Pesa Receipts for Reconciliation">
        {data.mpesa.receipts.length === 0 ? (
          <p style={{ margin: 0 }}>No M-Pesa receipts recorded for this business date.</p>
        ) : (
          <table className="print-table">
            <thead>
              <tr>
                <th>Receipt No.</th>
                <th>Time</th>
                <th>Patient</th>
                <th>IP Number</th>
                <th>Phone</th>
                <th style={{ textAlign: 'right' }}>Amount (KES)</th>
              </tr>
            </thead>
            <tbody>
              {data.mpesa.receipts.map((r: any, i: number) => (
                <tr key={i}>
                  <td>{r.receipt ?? '—'}</td>
                  <td>{r.at ? formatDateTime(r.at) : '—'}</td>
                  <td>{r.patient}</td>
                  <td>{r.ipNumber}</td>
                  <td>{r.phone}</td>
                  <td className="num">{Number(r.amount).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>Total collected via M-Pesa</td>
                <td className="num">{formatKES(data.mpesa.total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </PrintSection>
    </PrintDocument>
  )
}

/* ------------------------------------------------------------------ */
/* Pharmacy stock                                                      */
/* ------------------------------------------------------------------ */

export function StockDoc({ data }: { data: any }) {
  return (
    <PrintDocument
      title="Pharmacy Stock Report"
      subtitle="Pharmacy Stock & Expiry Report"
      reference={`STK/${new Date(data.generatedAt).toISOString().slice(0, 10)}`}
      meta={[
        { label: 'Formulary Lines', value: String(data.totals.lines) },
        { label: 'Below Reorder', value: String(data.totals.belowReorder) },
        { label: 'Expiring < 90d', value: String(data.totals.expiringSoon) },
        { label: 'Stock Value', value: formatKES(data.totals.stockValue) },
      ]}
      note="Quantities exclude expired batches, which are shown separately and must be quarantined pending write-off. KEML = Kenya Essential Medicines List."
      signatories={[{ role: 'Pharmacist in Charge' }, { role: 'Stores Officer' }]}
    >
      <PrintSection heading="Stock Position">
        <table className="print-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Drug</th>
              <th>Form</th>
              <th style={{ textAlign: 'right' }}>In Stock</th>
              <th style={{ textAlign: 'right' }}>Reorder</th>
              <th style={{ textAlign: 'right' }}>Expiring</th>
              <th style={{ textAlign: 'right' }}>Expired</th>
              <th style={{ textAlign: 'right' }}>Value (KES)</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r: any) => (
              <tr key={r.code}>
                <td>{r.code}</td>
                <td>
                  {r.drug}
                  {r.kemlListed ? ' · KEML' : ''}
                  {r.controlled ? ' · CONTROLLED' : ''}
                </td>
                <td>{r.form}</td>
                <td className="num">
                  {r.inStock}
                  {r.belowReorder ? ' ▲' : ''}
                </td>
                <td className="num">{r.reorderLevel}</td>
                <td className="num">{r.expiringSoon || '—'}</td>
                <td className="num">{r.expiredUnits || '—'}</td>
                <td className="num">{Number(r.stockValue).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7}>Total stock value at cost</td>
              <td className="num">{formatKES(data.totals.stockValue)}</td>
            </tr>
          </tfoot>
        </table>
        <p style={{ fontSize: '8pt', marginTop: '2mm' }}>▲ = at or below reorder level, raise a requisition.</p>
      </PrintSection>
    </PrintDocument>
  )
}

/* ------------------------------------------------------------------ */
/* Controlled drug register                                            */
/* ------------------------------------------------------------------ */

export function ControlledRegisterDoc({ data }: { data: any }) {
  return (
    <PrintDocument
      title="Controlled Drug Register"
      subtitle="Controlled Substances Movement Register"
      reference={`CDR/${new Date(data.from).toISOString().slice(0, 10)}`}
      meta={[
        { label: 'Period From', value: formatDate(data.from) },
        { label: 'Period To', value: formatDate(data.to) },
        { label: 'Movements', value: String(data.rows.length) },
      ]}
      note="Maintained under the Pharmacy and Poisons Act (Cap. 244). Every receipt and issue of a scheduled substance is recorded with the responsible officer. This register is generated from the system stock ledger and must be retained for inspection by the Pharmacy and Poisons Board."
      signatories={[{ role: 'Pharmacist in Charge' }, { role: 'Witness' }, { role: 'PPB Inspector' }]}
    >
      <PrintSection heading="Movements">
        {data.rows.length === 0 ? (
          <p style={{ margin: 0 }}>No controlled-substance movements recorded in this period.</p>
        ) : (
          <PrintTable
            columns={[
              { key: 'd', label: 'Date & Time' },
              { key: 'dr', label: 'Drug' },
              { key: 'b', label: 'Batch' },
              { key: 't', label: 'Movement' },
              { key: 'q', label: 'Qty', align: 'right' },
              { key: 'bal', label: 'Balance', align: 'right' },
              { key: 'by', label: 'Responsible Officer' },
            ]}
          >
            {data.rows.map((r: any, i: number) => (
              <tr key={i}>
                <td>{formatDateTime(r.at)}</td>
                <td>{r.drug}</td>
                <td>{r.batchNumber}</td>
                <td>
                  {r.type}
                  {r.reason ? <div style={{ fontSize: '8pt' }}>{r.reason}</div> : null}
                </td>
                <td className="num">{r.quantity > 0 ? `+${r.quantity}` : r.quantity}</td>
                <td className="num">{r.balanceAfter ?? '—'}</td>
                <td>{r.performedBy}</td>
              </tr>
            ))}
          </PrintTable>
        )}
      </PrintSection>
    </PrintDocument>
  )
}
