import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from '../../lib/utils'

/**
 * Form controls.
 *
 * Native elements, restyled — a real `<select>` inherits the platform's
 * keyboard handling, type-ahead and mobile picker, all of which a custom
 * dropdown has to reimplement and usually gets wrong.
 *
 * Every control is 40px tall (44px on touch), has a visible persistent label,
 * and wires `aria-describedby` / `aria-invalid` so an error is announced
 * rather than merely coloured.
 */

const controlBase = cn(
  'w-full rounded-sm border bg-canvas px-3 text-md text-ink-900',
  'placeholder:text-ink-400',
  'transition-colors duration-100',
  'disabled:cursor-not-allowed disabled:bg-neutral-bg disabled:text-ink-500',
)

const controlBorder = 'border-line-strong hover:border-ink-400'
const controlInvalid = 'border-critical hover:border-critical'

interface FieldShellProps {
  label: string
  htmlFor: string
  required?: boolean
  /** Guidance shown before the user acts. */
  hint?: string
  /** Validation message. Replaces the hint and marks the control invalid. */
  error?: string
  children: ReactNode
  className?: string
}

/**
 * Label + control + message. The label is always visible: placeholder-as-label
 * disappears the moment someone starts typing, which is exactly when a tired
 * user needs to confirm what field they are in.
 */
export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-semibold text-ink-700">
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="ml-1 text-critical">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </label>

      {children}

      {error ? (
        <p id={`${htmlFor}-msg`} role="alert" className="flex items-start gap-1.5 text-xs font-medium text-critical">
          <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7 4v3.5M7 9.8v.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-msg`} className="text-xs text-ink-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  label: string
  hint?: string
  error?: string
  /** Right-aligned tabular figures, for doses, amounts and results. */
  numeric?: boolean
  containerClassName?: string
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, hint, error, required, numeric, className, containerClassName, id, ...rest },
  ref,
) {
  const generated = useId()
  const fieldId = id ?? generated

  return (
    <Field
      label={label}
      htmlFor={fieldId}
      required={required}
      hint={hint}
      error={error}
      className={containerClassName}
    >
      <input
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${fieldId}-msg` : undefined}
        className={cn(
          controlBase,
          'h-10',
          error ? controlInvalid : controlBorder,
          numeric && 'text-right font-mono tabular',
          className,
        )}
        {...rest}
      />
    </Field>
  )
})

/* ------------------------------------------------------------------ */

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string
  hint?: string
  error?: string
  /** Shown as a disabled first option so the field has no silent default. */
  placeholder?: string
  options: { value: string; label: string; disabled?: boolean }[]
  containerClassName?: string
}

export function Select({
  label,
  hint,
  error,
  required,
  placeholder,
  options,
  className,
  containerClassName,
  id,
  ...rest
}: SelectProps) {
  const generated = useId()
  const fieldId = id ?? generated

  return (
    <Field
      label={label}
      htmlFor={fieldId}
      required={required}
      hint={hint}
      error={error}
      className={containerClassName}
    >
      <div className="relative">
        <select
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${fieldId}-msg` : undefined}
          className={cn(
            controlBase,
            'h-10 appearance-none pr-9',
            error ? controlInvalid : controlBorder,
            className,
          )}
          {...rest}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </Field>
  )
}

/* ------------------------------------------------------------------ */

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string
  hint?: string
  error?: string
  containerClassName?: string
}

export function TextArea({
  label,
  hint,
  error,
  required,
  className,
  containerClassName,
  id,
  rows = 3,
  ...rest
}: TextAreaProps) {
  const generated = useId()
  const fieldId = id ?? generated

  return (
    <Field
      label={label}
      htmlFor={fieldId}
      required={required}
      hint={hint}
      error={error}
      className={containerClassName}
    >
      <textarea
        id={fieldId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${fieldId}-msg` : undefined}
        className={cn(controlBase, 'resize-y py-2 leading-relaxed', error ? controlInvalid : controlBorder, className)}
        {...rest}
      />
    </Field>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Search box with an explicit clear control.
 *
 * `type="search"` so Escape clears it natively — the shortcut a fast typist
 * already expects at a reception desk.
 */
export const SearchInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> & { label: string; onClear?: () => void }
>(function SearchInput({ label, onClear, className, id, value, ...rest }, ref) {
  const generated = useId()
  const fieldId = id ?? generated

  return (
    <div className="relative">
      <label htmlFor={fieldId} className="sr-only">
        {label}
      </label>
      <svg
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        ref={ref}
        id={fieldId}
        type="search"
        value={value}
        className={cn(controlBase, controlBorder, 'h-10 pl-9', onClear && value ? 'pr-9' : '', className)}
        {...rest}
      />
      {onClear && value ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-xs text-ink-500 hover:bg-neutral-bg hover:text-ink-800"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="m3.5 3.5 7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>
  )
})

/* ------------------------------------------------------------------ */

/**
 * Radio group rendered as segmented buttons.
 *
 * Used where the options are few and the choice is consequential — triage
 * acuity, pregnancy status. Larger targets than radios, and the selected
 * state carries a check mark as well as fill, so it does not depend on colour.
 */
export function ChoiceGroup({
  label,
  name,
  value,
  onChange,
  options,
  required,
  error,
  columns = 1,
}: {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string; description?: string; swatch?: string }[]
  required?: boolean
  error?: string
  columns?: 1 | 2 | 3
}) {
  const groupId = useId()

  return (
    <fieldset className="min-w-0 border-0 p-0" aria-describedby={error ? `${groupId}-msg` : undefined}>
      <legend className="mb-1.5 text-xs font-semibold text-ink-700">
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="ml-1 text-critical">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </legend>

      <div
        role="radiogroup"
        aria-label={label}
        className={cn(
          'grid gap-1.5',
          columns === 2 && 'sm:grid-cols-2',
          columns === 3 && 'sm:grid-cols-3',
        )}
      >
        {options.map((o) => {
          const selected = value === o.value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              name={name}
              onClick={() => onChange(o.value)}
              className={cn(
                'flex min-h-11 items-center gap-2.5 rounded-sm border px-3 py-2 text-left transition-colors duration-100',
                selected
                  ? 'border-primary-600 bg-primary-50 ring-1 ring-primary-600'
                  : 'border-line-strong bg-canvas hover:border-ink-400',
              )}
            >
              {o.swatch && (
                <span
                  className="h-4 w-4 shrink-0 rounded-xs border border-black/15"
                  style={{ background: o.swatch }}
                  aria-hidden="true"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink-900">{o.label}</span>
                {o.description && <span className="block text-xs text-ink-600">{o.description}</span>}
              </span>
              {/* Non-colour confirmation of selection. */}
              <svg
                className={cn('h-4 w-4 shrink-0', selected ? 'text-primary-600' : 'text-transparent')}
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path d="m3 8.5 3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )
        })}
      </div>

      {error && (
        <p id={`${groupId}-msg`} role="alert" className="mt-1.5 text-xs font-medium text-critical">
          {error}
        </p>
      )}
    </fieldset>
  )
}
