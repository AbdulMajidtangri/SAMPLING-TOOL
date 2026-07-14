/**
 * Implementation audit vs updated project brief (source of truth).
 *
 * IMPLEMENTED:
 * - Upload → worksheet → headers/mapping → clean → planning
 *   → high-value → stratify → design (method/size/risk) → selection → testing → WP
 * - Flexible header mapping + positional fallback
 * - Population cleaning flags (totals, opening/closing, zero/negative, duplicates)
 * - Full planning fields (test type, assertion, objective, unit, error definition)
 * - High-value separation before residual sampling
 * - Stratification as design only
 * - Method recommendation with override rationale
 * - Residual coverage guidance (≤30 high risk 60–70%; large-pop % by risk)
 * - Sampling-risk acknowledgement statement
 * - Reproducibility details per method
 * - Working paper §17 fields + sign-off / lock / amendment
 * - Firm config snapshot
 *
 * CONFIGURABLE (firmConfig.ts):
 * - Audit areas, assertions, test types
 * - HV default threshold, small-pop band, large-pop % by risk
 * - File assembly deadline days
 */
export const IMPLEMENTATION_AUDIT = true
