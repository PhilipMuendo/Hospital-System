import type { ReactNode } from 'react'

export const FACILITY = {
  name: 'Uzima General Hospital',
  address: 'Ngong Road, Nairobi',
  postal: 'P.O. Box 30125–00100, Nairobi, Kenya',
  phone: '+254 20 271 8000',
  email: 'records@uzimageneral.ke',
  /** Facility code as issued in the Kenya Master Health Facility List. */
  mfl: 'MFL 13742',
  /** Shown on anything that functions as a tax invoice. */
  kraPin: 'P051234567X',
  shaAccreditation: 'SHA/FAC/2024/13742',
}

interface PrintDocumentProps {
  title: string
  /** e.g. "Discharge Summary", printed under the facility block. */
  subtitle?: string
  /** Document number — invoice no., report no. Printed and used in the footer. */
  reference?: string
  /** Right-hand metadata block: label/value pairs. */
  meta?: { label: string; value: string }[]
  children: ReactNode
  /** Statutory or clinical footnote printed above the signature strip. */
  note?: string
  signatories?: { role: string; name?: string }[]
}

/**
 * A single printable hospital document.
 *
 * Print output is deliberately light-on-white regardless of the app's dark
 * theme — a dark chart wastes toner and is unreadable when photocopied, and
 * Kenyan facilities photocopy everything for the paper file.
 *
 * Sizing is A4, which is what hospital printers here are loaded with.
 */
export function PrintDocument({
  title,
  subtitle,
  reference,
  meta,
  children,
  note,
  signatories,
}: PrintDocumentProps) {
  return (
    <article className="print-document">
      <header className="print-letterhead">
        <div>
          <h1 className="print-facility">{FACILITY.name}</h1>
          <p className="print-facility-line">
            {FACILITY.address} · {FACILITY.postal}
          </p>
          <p className="print-facility-line">
            Tel {FACILITY.phone} · {FACILITY.email}
          </p>
          <p className="print-facility-line">
            {FACILITY.mfl} · KRA PIN {FACILITY.kraPin} · {FACILITY.shaAccreditation}
          </p>
        </div>
        <div className="print-crest" aria-hidden="true">
          <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
            <circle cx="26" cy="26" r="24" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M8 27h7l4-10 5 19 4-13 3 6h13"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </header>

      <div className="print-titlebar">
        <div>
          <h2 className="print-title">{subtitle ?? title}</h2>
          {reference && <p className="print-reference">Ref: {reference}</p>}
        </div>
        {meta && meta.length > 0 && (
          <table className="print-meta">
            <tbody>
              {meta.map((m) => (
                <tr key={m.label}>
                  <th>{m.label}</th>
                  <td>{m.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="print-body">{children}</div>

      {note && <p className="print-note">{note}</p>}

      {signatories && signatories.length > 0 && (
        <div className="print-signatures">
          {signatories.map((s) => (
            <div key={s.role} className="print-signature">
              <div className="print-signature-rule" />
              <p className="print-signature-role">{s.role}</p>
              {s.name && <p className="print-signature-name">{s.name}</p>}
            </div>
          ))}
        </div>
      )}

      <footer className="print-docfooter">
        <span>
          {FACILITY.name} · {subtitle ?? title}
          {reference ? ` · ${reference}` : ''}
        </span>
        <span>
          Generated{' '}
          {new Date().toLocaleString('en-KE', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </footer>
    </article>
  )
}

/** Standard bordered table used inside printed documents. */
export function PrintTable({
  columns,
  children,
}: {
  columns: { key: string; label: string; align?: 'left' | 'right' }[]
  children: ReactNode
}) {
  return (
    <table className="print-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} style={{ textAlign: c.align ?? 'left' }}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  )
}

export function PrintSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="print-section">
      <h3 className="print-section-heading">{heading}</h3>
      {children}
    </section>
  )
}

/** Label/value grid for identity blocks. */
export function PrintFields({ fields }: { fields: { label: string; value: string }[] }) {
  return (
    <dl className="print-fields">
      {fields.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}
