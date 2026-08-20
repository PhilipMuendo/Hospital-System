import { Select } from '../ui/Field'

/**
 * Deprecated — use `Select` from `components/ui`.
 *
 * Adapter over a native `<select>`, which brings keyboard type-ahead and the
 * platform picker on mobile. The previous implementation was a custom popover
 * that had neither.
 */
export function Dropdown({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
  className?: string
}) {
  return (
    <Select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={options.map((o) => ({ value: o, label: o }))}
      containerClassName={className}
    />
  )
}
