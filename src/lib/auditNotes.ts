/**
 * Implementation audit vs brief (source of truth)
 *
 * ALREADY IN PLACE (partial/full):
 * - Upload → worksheet → auto header/data → mapping → confirm → objective → size → select → test → WP
 * - Header synonyms, normalization, fuzzy match, confidence
 * - Optional Account No + Amount alternative (product need; brief Debit/Credit primary)
 * - Coverage from Debit/Credit/Amount with absolute values
 * - Path A matrix and Path B tiers + provisional sizing + min item floor 15
 * - Random/systematic/haphazard/block selection
 * - Basic warnings (zeros, both sides, duplicates, totals, repeated headers)
 * - Printable working paper (partial fields)
 *
 * MISSING / WEAK (to implement now):
 * - Hard stops for unmapped required fields + alternative ID when Voucher No missing
 * - Multiple header candidates must not auto-finalize
 * - Data-type assisted mapping
 * - Both Debit+Credit requires auditor resolution (not silent max)
 * - Exclude/confirm repeated headers and questionable rows with reason
 * - Change invalidation clearing downstream state
 * - Override rules (increase/reduce/reviewer approval below floor)
 * - Method-change rationale; systematic/block warnings + block rationale
 * - Extracted data hash + firm config snapshot on WP
 * - Full evaluation fields + untested remainder completeness
 * - WP: client, period, area, WP ref, signed debit/credit, 100% wording
 * - Edge-case unit tests
 */
export const IMPLEMENTATION_AUDIT = true
