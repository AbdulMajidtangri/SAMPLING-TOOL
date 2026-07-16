import { useEffect, useId, useState, type InputHTMLAttributes } from 'react'

type SuggestFieldProps = {
  id?: string
  label?: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

/** Text field with dropdown suggestions — user can pick or type freely. */
export function SuggestField({
  id,
  value,
  options,
  onChange,
  placeholder,
  disabled,
}: SuggestFieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const listId = `${fieldId}-suggestions`

  return (
    <>
      <input
        id={fieldId}
        list={listId}
        value={value}
        disabled={disabled}
        placeholder={placeholder ?? 'Select or type…'}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {options.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>
    </>
  )
}

type NumberTextInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'min' | 'max'
> & {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max?: number
  /** Allow clearing while typing; on blur empty becomes `emptyAs`. Default 0. */
  emptyAs?: number
  integer?: boolean
}

/**
 * Text input that only accepts digits (optional one decimal if integer=false).
 * Avoids React controlled `type="number"` quirks when clearing / editing.
 */
export function NumberTextInput({
  value,
  onValueChange,
  min,
  max,
  emptyAs = 0,
  integer = true,
  onBlur,
  ...rest
}: NumberTextInputProps) {
  const [text, setText] = useState(() => String(value))

  useEffect(() => {
    setText(String(value))
  }, [value])

  function clamp(n: number): number {
    let next = n
    if (min != null && Number.isFinite(min)) next = Math.max(min, next)
    if (max != null && Number.isFinite(max)) next = Math.min(max, next)
    return next
  }

  function commit(raw: string) {
    if (raw.trim() === '') {
      const fallback = clamp(emptyAs)
      setText(String(fallback))
      onValueChange(fallback)
      return
    }
    const parsed = integer ? Number.parseInt(raw, 10) : Number.parseFloat(raw)
    if (!Number.isFinite(parsed)) {
      setText(String(value))
      return
    }
    const next = clamp(parsed)
    setText(String(next))
    onValueChange(next)
  }

  return (
    <input
      {...rest}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      autoComplete="off"
      value={text}
      onChange={(e) => {
        const raw = e.target.value
        const pattern = integer ? /^\d*$/ : /^\d*\.?\d*$/
        if (!pattern.test(raw)) return
        setText(raw)
        if (raw === '' || raw === '.') return
        const parsed = integer ? Number.parseInt(raw, 10) : Number.parseFloat(raw)
        if (!Number.isFinite(parsed)) return
        // Do not clamp while typing — only sync the numeric draft to parent.
        onValueChange(parsed)
      }}
      onBlur={(e) => {
        commit(text)
        onBlur?.(e)
      }}
    />
  )
}
