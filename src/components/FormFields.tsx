import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from 'react'
import './FormFields.css'

type ComboFieldProps = {
  id?: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

/** Professional combobox: type freely or pick from a filtered list. */
export function ComboField({
  id,
  value,
  options,
  onChange,
  placeholder,
  disabled,
}: ComboFieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const listboxId = `${fieldId}-listbox`
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return [...options]
    const matches = options.filter((opt) => opt.toLowerCase().includes(q))
    if (value && !options.some((opt) => opt.toLowerCase() === q)) {
      return matches
    }
    return matches
  }, [options, value])

  useEffect(() => {
    if (!open) setActiveIndex(-1)
  }, [open])

  useEffect(() => {
    function onDocPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocPointer)
    return () => document.removeEventListener('mousedown', onDocPointer)
  }, [])

  function selectOption(opt: string) {
    onChange(opt)
    setOpen(false)
    inputRef.current?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter' && open && activeIndex >= 0 && filtered[activeIndex]) {
      e.preventDefault()
      selectOption(filtered[activeIndex])
      return
    }
    if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className={`combo-field ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''}`}
    >
      <div className="combo-control">
        <input
          ref={inputRef}
          id={fieldId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          value={value}
          disabled={disabled}
          placeholder={placeholder ?? 'Select or type…'}
          autoComplete="off"
          className="combo-input"
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
            setActiveIndex(0)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="combo-toggle"
          tabIndex={-1}
          disabled={disabled}
          aria-label="Show options"
          onClick={() => {
            setOpen((v) => !v)
            inputRef.current?.focus()
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M3.5 5.25L7 8.75L10.5 5.25"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {open && !disabled && (
        <ul id={listboxId} role="listbox" className="combo-menu">
          {filtered.length === 0 ? (
            <li className="combo-empty">No matching options — your typed value will be used.</li>
          ) : (
            filtered.map((opt, index) => (
              <li
                key={opt}
                role="option"
                aria-selected={value === opt}
                className={[
                  'combo-option',
                  value === opt ? 'is-selected' : '',
                  index === activeIndex ? 'is-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectOption(opt)}
              >
                {opt}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

/** @deprecated Use ComboField — kept as alias for existing imports. */
export const SuggestField = ComboField

type NumberTextInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'min' | 'max'
> & {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max?: number
  emptyAs?: number
  integer?: boolean
}

export function NumberTextInput({
  value,
  onValueChange,
  min,
  max,
  emptyAs = 0,
  integer = true,
  onBlur,
  className,
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
      className={['num-text-input', className].filter(Boolean).join(' ')}
      value={text}
      onChange={(e) => {
        const raw = e.target.value
        const pattern = integer ? /^\d*$/ : /^\d*\.?\d*$/
        if (!pattern.test(raw)) return
        setText(raw)
        if (raw === '' || raw === '.') return
        const parsed = integer ? Number.parseInt(raw, 10) : Number.parseFloat(raw)
        if (!Number.isFinite(parsed)) return
        onValueChange(parsed)
      }}
      onBlur={(e) => {
        commit(text)
        onBlur?.(e)
      }}
    />
  )
}
