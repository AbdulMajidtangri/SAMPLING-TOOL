import { useId } from 'react'

/**
 * Peter & Co. logo symbol, inlined as SVG.
 *
 * Inlined rather than loaded from a file because the packaged app is served
 * over file:// (electron loadFile) and prints to PDF — an inline mark needs no
 * asset resolution and is always present in the print rendering.
 *
 * The purple gradient id is made unique per instance so several marks can be
 * rendered on the same page without the definitions colliding.
 */
export function PeterCoMark({ className }: { className?: string }) {
  const gradientId = `peterco-grad-${useId().replace(/:/g, '')}`

  return (
    <svg
      className={className}
      viewBox="0 0 200 200"
      role="img"
      aria-label="Peter & Co."
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#982598" />
          <stop offset="100%" stopColor="#A78BFA" />
        </linearGradient>
      </defs>

      {/* Connection lines */}
      <line x1="70" y1="80" x2="50" y2="60" stroke="#CBD5E1" strokeWidth="4" strokeLinecap="round" />
      <line x1="130" y1="85" x2="170" y2="70" stroke="#CBD5E1" strokeWidth="4" strokeLinecap="round" />
      <line x1="125" y1="125" x2="145" y2="150" stroke="#CBD5E1" strokeWidth="4" strokeLinecap="round" />
      <line x1="70" y1="120" x2="45" y2="135" stroke="#CBD5E1" strokeWidth="4" strokeLinecap="round" />

      {/* Satellite nodes */}
      <circle cx="38" cy="45" r="20" fill="#0F172A" />
      <circle cx="38" cy="45" r="10" fill={`url(#${gradientId})`} />
      <circle cx="170" cy="60" r="25" fill="#0F172A" />
      <circle cx="170" cy="60" r="12.5" fill={`url(#${gradientId})`} />
      <circle cx="162" cy="162" r="17.5" fill="#0F172A" />
      <circle cx="162" cy="162" r="8.75" fill={`url(#${gradientId})`} />
      <circle cx="30" cy="150" r="15" fill="#0F172A" />
      <circle cx="30" cy="150" r="7.5" fill={`url(#${gradientId})`} />

      {/* Central node */}
      <circle cx="100" cy="100" r="40" fill="#0F172A" />
      <circle cx="100" cy="100" r="30" fill={`url(#${gradientId})`} />
      <text
        x="100"
        y="112"
        textAnchor="middle"
        fill="#FFFFFF"
        fontFamily="Inter, 'Source Sans 3', Arial, sans-serif"
        fontSize="35"
        fontWeight="700"
      >
        P
      </text>
    </svg>
  )
}
