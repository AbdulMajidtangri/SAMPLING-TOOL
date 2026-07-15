/**
 * Implementation audit vs updated project brief (source of truth).
 *
 * IMPLEMENTED:
 * - Upload → worksheet → mapping → confirm → planning
 *   → design (method/size/risk) → selection → testing → WP
 * - Required header mapping (hard-stop validateRequiredMappings); editable data start/end
 * - Confirm population: count + coverage value; Debit/Credit resolution; exclusions with reason
 * - No auto positional fill on continue; no auto useMax — auditor resolves both-sides rows
 * - Full planning fields (test type, assertion, objective, unit, error definition)
 * - Method recommendation with override rationale
 * - Path A / Path B sample-size guidance; Path B zero-coverage hard stop
 * - Path B post-selection coverage review (§13.8) + untested remainder basis
 * - Sampling-risk acknowledgement statement
 * - §20 remove-from-sample → full re-selection required
 * - Reproducibility details per method
 * - Working paper §17 fields + mapping summary + config JSON + sign-off / lock / amendment
 * - Firm config snapshot
 *
 * NOT USED IN THIS ENGAGEMENT FLOW:
 * - Interactive clean step as a separate wizard page (flags / exclusions live on confirm + WP)
 * - High-value separation as a wizard step
 * - Stratification as a wizard step
 *
 * CONFIGURABLE (firmConfig.ts):
 * - Audit areas, assertions, test types
 * - HV default threshold (retained in firm config / DesignInputs defaults; not a wizard step)
 * - Small-pop band, large-pop % by risk
 * - File assembly deadline days
 */
export const IMPLEMENTATION_AUDIT = true
