// Grounding module: the audit / citation layer.
//
// This is the differentiating layer of AgentEval. It answers, deterministically
// and with no model call, three questions about an agent's output:
//
//   1. Did the agent assert claims without citing them?   (claims.ts)
//   2. Do the citations it emitted resolve to real sources? (citations.ts)
//   3. When it quoted a source, does the quote match?       (quotes.ts)
//
// Plus a cross-section coherence check for multi-part documents (coherence.ts).
// All of it is configurable via GroundingConfig, with a GENERIC_PRESET for
// ordinary assistants and a REGULATED_PRESET for compliance domains.

import type { AgentTrace } from '../core/trace.js';
import type { GroundingConfig } from './config.js';
import { GENERIC_PRESET } from './config.js';
import { detectUncitedClaims, type UncitedClaim } from './claims.js';
import { parseCitations, resolveCitations } from './citations.js';
import { quoteMatchesSource } from './quotes.js';

// Re-export every public surface so callers import from one place.
export type { GroundingConfig } from './config.js';
export { GENERIC_PRESET, REGULATED_PRESET } from './config.js';

export type { UncitedClaim } from './claims.js';
export { detectUncitedClaims } from './claims.js';

export type { ParsedCitations } from './citations.js';
export { parseCitations, resolveCitations } from './citations.js';

export {
  normalizeForCompare,
  longestCommonSubstringLength,
  quoteMatchesSource,
} from './quotes.js';

export type { CoherenceSection, OrphanReference } from './coherence.js';
export { findOrphanReferences } from './coherence.js';

/** The combined grounding verdict for one agent run. */
export interface GroundingResult {
  /** Claims asserted without an attached citation. */
  uncitedClaims: UncitedClaim[];
  /** Reference tokens emitted that did not resolve to a known source. */
  unresolvedCitations: string[];
  /** Quotes whose text did not match the cited source, with similarity. */
  quoteMismatches: { ref: string; similarity: number }[];
}

/**
 * Run the full grounding pass over an agent trace.
 *
 * - Uncited claims are detected in `trace.finalText` using `opts.config`
 *   (defaults to GENERIC_PRESET).
 * - Inline reference tokens in `trace.finalText` are resolved against
 *   `opts.knownSources`. When no known-source set is supplied, citation
 *   resolution is skipped (we cannot judge what we cannot look up), so
 *   `unresolvedCitations` is empty.
 * - Quote matching runs over `trace.citations`: each citation that carries both
 *   a `quote` and a `source` is checked with `quoteMatchesSource`; mismatches
 *   are reported with their similarity and the citation's ref (or source).
 */
export function checkGrounding(
  trace: AgentTrace,
  opts?: { config?: GroundingConfig; knownSources?: Iterable<string> },
): GroundingResult {
  const config = opts?.config ?? GENERIC_PRESET;
  const text = trace.finalText ?? '';

  const uncitedClaims = detectUncitedClaims(text, config);

  // Resolve emitted references only when we have a source set to resolve
  // against. Without one, every ref would be reported as unresolved, which is
  // noise rather than signal.
  let unresolvedCitations: string[] = [];
  if (opts?.knownSources !== undefined) {
    const { refs } = parseCitations(text);
    unresolvedCitations = resolveCitations(refs, opts.knownSources).unresolved;
  }

  // Quote checks: each citation that has both a quote and a source text.
  const quoteMismatches: { ref: string; similarity: number }[] = [];
  for (const citation of trace.citations ?? []) {
    const quote = citation.quote;
    const source = citation.source;
    if (!quote || !source) continue;
    const { match, similarity } = quoteMatchesSource(quote, source);
    if (!match) {
      quoteMismatches.push({
        ref: citation.ref ?? citation.id ?? source,
        similarity,
      });
    }
  }

  return { uncitedClaims, unresolvedCitations, quoteMismatches };
}
