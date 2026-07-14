/**
 * Implementation audit vs updated project brief (source of truth).
 *
 * IMPLEMENTED:
 * - Upload → worksheet → headers/mapping → planning
 *   → design (method/size/risk) → selection → testing → WP
 * - Flexible header mapping + positional fallback
 * - Auto coverage resolution (useMax) after mapping; population summary retained
 * - Full planning fields (test type, assertion, objective, unit, error definition)
 * - Method recommendation with override rationale
 * - Population coverage guidance (≤30 high risk 60–70%; large-pop % by risk)
 * - Sampling-risk acknowledgement statement
 * - Reproducibility details per method
 * - Working paper §17 fields + sign-off / lock / amendment
 * - Firm config snapshot
 *
 * NOT USED IN THIS ENGAGEMENT FLOW:
 * - Interactive clean step (flags remain in data model / WP summary)
 * - High-value separation
 * - Stratification as a wizard step
 *
 * CONFIGURABLE (firmConfig.ts):
 * - Audit areas, assertions, test types
 * - HV default threshold, small-pop band, large-pop % by risk
 * - File assembly deadline days
 */
export const IMPLEMENTATION_AUDIT = true
