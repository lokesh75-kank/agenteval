// Shared, presentation-layer helpers used by all three renderers (console,
// json, html). These turn the structured report types into short human-readable
// strings. Kept separate so the console and HTML renderers describe assertions
// and grounding identically.

import type { Assertion, AssertionResult, ScenarioRunSummary, SuiteReport } from '../core/types.js';

/**
 * A compact, human-readable label for an assertion. Used in failing-assertion
 * detail lines and the HTML evidence table. Exhaustive over the Assertion union.
 */
export function describeAssertion(a: Assertion): string {
  switch (a.kind) {
    case 'tool_called':
      return `tool_called: ${a.name}`;
    case 'tool_not_called':
      return `tool_not_called: ${a.name}`;
    case 'tool_input_contains_one_of':
      return `tool_input_contains_one_of: [${a.options.join(', ')}]${a.tool ? ` in ${a.tool}` : ''}`;
    case 'text_contains':
      return `text_contains: /${a.pattern}/${a.flags ?? ''}`;
    case 'text_contains_one_of':
      return `text_contains_one_of: [${a.options.join(', ')}]`;
    case 'text_does_not_contain':
      return `text_does_not_contain: [${a.patterns.join(', ')}]`;
    case 'output_contains_one_of':
      return `output_contains_one_of: [${a.options.join(', ')}]`;
    case 'iteration_count_under':
      return `iteration_count_under: ${a.n}`;
    case 'iteration_count_at_least':
      return `iteration_count_at_least: ${a.n}`;
    case 'recall_at_k':
      return `recall_at_k: ${a.all ? 'all' : a.k} of [${a.expected.join(', ')}]`;
    case 'every_claim_has_citation':
      return 'every_claim_has_citation';
    case 'citations_resolve':
      return 'citations_resolve';
    case 'quote_matches_source':
      return 'quote_matches_source';
    case 'refusal':
      return 'refusal';
    default: {
      // Exhaustiveness guard: if a new Assertion kind is added, TS flags this.
      const _never: never = a;
      return String((_never as { kind?: string }).kind ?? 'unknown');
    }
  }
}

/** The grounding-related assertion kinds, used to compute a grounding pass rate. */
const GROUNDING_KINDS = new Set<Assertion['kind']>([
  'every_claim_has_citation',
  'citations_resolve',
  'quote_matches_source',
]);

/** True if this assertion concerns grounding/citation evidence. */
export function isGroundingAssertion(a: Assertion): boolean {
  return GROUNDING_KINDS.has(a.kind);
}

/**
 * The grounding pass rate across the whole suite, or undefined if no scenario
 * exercised a grounding assertion. Computed over the representative (first) run
 * of each scenario so it reflects the attested behaviour, not flaky retries.
 */
export function groundingPassRate(report: SuiteReport): number | undefined {
  let total = 0;
  let passing = 0;
  for (const s of report.scenarios) {
    const rep = representativeRun(s);
    if (!rep) continue;
    for (const ar of rep.assertions) {
      if (!isGroundingAssertion(ar.assertion)) continue;
      total += 1;
      if (ar.pass) passing += 1;
    }
  }
  if (total === 0) return undefined;
  return passing / total;
}

/**
 * The run we treat as the representative run for a scenario: the first run if
 * present. Determinism across all runs is reported separately.
 */
export function representativeRun(s: ScenarioRunSummary): ScenarioRunSummary['perRun'][number] | undefined {
  return s.perRun[0];
}

/** The failing assertion results for a given run, with a stable order. */
export function failingAssertions(results: readonly AssertionResult[]): AssertionResult[] {
  return results.filter((r) => !r.pass);
}

/** Format a 0..1 ratio as a whole-number percentage string, e.g. "92%". */
export function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** Format a 0..1 ratio with one decimal, e.g. "91.7%". Used where precision matters. */
export function pct1(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}
