// Grounding configuration.
//
// The grounding layer decides which sentences in an agent's output assert a
// *claim* that demands a citation. What counts as a claim is domain-specific:
// a consumer support agent has very different "must be cited" language than a
// regulated medical-device agent quoting CFR/ISO clauses. So we make it
// configurable: a `GroundingConfig` pairs a set of claim-name patterns with a
// set of imperative markers, and a sentence is a citable claim only when it
// matches BOTH (a named subject AND imperative language asserting a rule).
//
// Two presets ship by default:
//   - GENERIC_PRESET   - sensible defaults for any factual assistant.
//   - REGULATED_PRESET  - CFR/ISO/IEC/MDR/IVDR/USC regulation patterns plus
//                         regulatory imperative markers. Extracted from the
//                         Deminn regulatoryClaimDetector regex set, cleaned of
//                         all DB / orchestration coupling.

/** Configuration for what counts as a citable claim in agent output. */
export interface GroundingConfig {
  /**
   * Patterns that name the *subject* of a claim (a regulation, a standard, a
   * statistic). A sentence must contain at least one of these AND an imperative
   * marker to be treated as a claim requiring a citation. Each RegExp should be
   * global (`g`) so callers can scan repeatedly; the detector resets lastIndex
   * defensively regardless.
   */
  claimPatterns: RegExp[];
  /**
   * Lowercase imperative words/phrases that signal an asserted rule rather than
   * a passing mention (e.g. "shall", "must", "required"). Matched
   * case-insensitively on word boundaries.
   */
  imperativeMarkers: string[];
}

// ─────────────────────────────────────────────
// Regulated preset
// ─────────────────────────────────────────────

// Regulation-name patterns. Match a specific regulation by jurisdictional
// shorthand (CFR, ISO, IEC, MDR, IVDR, USC). Subpart / section / annex suffixes
// are optional - the imperative-near-pattern check is what promotes a match
// from a passing mention to an asserted CLAIM. Extracted verbatim (logic-only)
// from Deminn's regulatoryClaimDetector REG_PATTERNS.
const REGULATED_CLAIM_PATTERNS: RegExp[] = [
  /\b\d+\s*CFR\s*(?:Part\s*)?\d+(?:\.\d+(?:\([a-z\d]+\))*)?/gi,
  /\bISO\s+\d+(?:[-:]?\d{4})?(?:\s+(?:Section|Clause)\s*[\d.]+)?/gi,
  /\bIEC\s+\d+(?:-\d+)?/gi,
  /\bMDR\s+(?:Article|Annex)\s*[\dIVX]+/gi,
  /\bIVDR\s+(?:Article|Annex)\s*[\dIVX]+/gi,
  /\b21\s*USC\s*\d+/gi,
];

/**
 * Preset for regulated / compliance domains (medical device, pharma, etc.).
 * Flags any sentence that names a specific regulation and asserts a rule about
 * it without a citation.
 */
export const REGULATED_PRESET: GroundingConfig = {
  claimPatterns: REGULATED_CLAIM_PATTERNS,
  imperativeMarkers: ['shall', 'must', 'required', 'prohibited'],
};

// ─────────────────────────────────────────────
// Generic preset
// ─────────────────────────────────────────────

// Generic claim-subject patterns. These catch the most common shapes of a
// factual assertion that a careful assistant should back with a source:
//   - quantified / statistical claims ("42%", "3.5x", "1,200 users")
//   - studies / research / data references
//   - dated facts ("in 2024", "as of 2023")
const GENERIC_CLAIM_PATTERNS: RegExp[] = [
  // A number with a unit-ish suffix or a percentage/multiplier - the classic
  // "needs a source" statistic. Note: the trailing word-boundary applies only
  // to the alphabetic suffixes; "%" is non-word so it must not require a \b
  // after it (otherwise "80% " never matches).
  /\b\d[\d,]*(?:\.\d+)?\s*(?:%|(?:percent|x|users?|customers?|cases?)\b)/gi,
  // Explicit appeals to evidence the reader cannot see inline.
  /\b(?:studies?|research|data|surveys?|reports?|according to)\b/gi,
  // Dated factual assertions.
  /\b(?:in|as of|by)\s+(?:19|20)\d{2}\b/gi,
];

/**
 * Preset for general-purpose assistants. Flags statistical, study-backed, or
 * dated assertions phrased as definitive rules without a citation. Tuned to be
 * conservative (fewer false positives) since generic prose is noisier than
 * regulatory text.
 */
export const GENERIC_PRESET: GroundingConfig = {
  claimPatterns: GENERIC_CLAIM_PATTERNS,
  imperativeMarkers: ['shall', 'must', 'always', 'never', 'guarantees', 'proven'],
};
