import { useState } from 'react'
import { Button } from './Button'
import { ChoiceGroup, TextArea } from './Field'
import { Dialog } from './Layout'

/**
 * Captures a coded reason for an action that will be audited.
 *
 * Replaces `window.prompt()` for anything a regulator or a finance controller
 * reads later. Free text alone is unusable for audit — you cannot count it,
 * chart it, or spot a pattern in it — so a coded option is required and the
 * free text is supplementary.
 */
export function ReasonDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  label,
  options,
  confirmLabel,
  tone = 'primary',
  pending,
  children,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
  title: string
  description?: string
  label: string
  options: { value: string; label: string }[]
  confirmLabel: string
  tone?: 'primary' | 'danger'
  pending?: boolean
  children?: React.ReactNode
}) {
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [touched, setTouched] = useState(false)

  function submit() {
    setTouched(true)
    if (!reason) return
    onConfirm([reason, notes.trim()].filter(Boolean).join(' — '))
    setReason('')
    setNotes('')
    setTouched(false)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={submit} loading={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      <div className={children ? 'mt-4' : ''}>
        <ChoiceGroup
          label={label}
          name="reason"
          required
          value={reason}
          onChange={setReason}
          options={options}
          error={touched && !reason ? 'Select a reason' : undefined}
        />
      </div>
      <div className="mt-4">
        <TextArea
          label="Additional notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          hint="Optional. Recorded in the audit trail."
        />
      </div>
    </Dialog>
  )
}
