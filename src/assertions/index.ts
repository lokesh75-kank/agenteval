// Evaluates the generalized Assertion vocabulary against an AgentTrace.
//
// Each Assertion `kind` has a small, self-contained handler; the evaluator
// returns one AssertionResult per assertion (pass/fail + a human detail string
// the runner prints on failure). This is a clean-room generalization of
// Deminn's CapturedRun assertion evaluator: it reads the agent-agnostic
// AgentTrace shape and delegates all grounding logic to the grounding module
// rather than scanning for Deminn-internal cleanup markers ([E?], paraphrase).

import {
  detectUncitedClaims,
  parseCitations,
  quoteMatchesSource,
  resolveCitations,
  type GroundingConfig,
} from '../grounding/index.js';
import type { AgentTrace, Citation, ToolCall } from '../core/trace.js';
import type { Assertion, AssertionResult } from '../core/types.js';

/**
 * Optional context for grounding-flavored assertions. When omitted, the
 * grounding checks fall back to sensible defaults (the trace's own citations as
 * the known source set, the grounding module's default config).
 */
export interface AssertionContext {
  /** Claim/citation detection config passed to the grounding module. */
  groundingConfig?: GroundingConfig;
  /**
   * The set of source identifiers a citation may resolve against. If omitted,
   * the ids are derived from the trace's own `citations` (id/ref fields).
   */
  knownSources?: Iterable<string>;
}

/** Evaluate every assertion against the trace, preserving order. */
export function evaluateAssertions(
  trace: AgentTrace,
  asserts: Assertion[],
  ctx?: AssertionContext,
): AssertionResult[] {
  return asserts.map((a) => evaluateOne(trace, a, ctx));
}

function evaluateOne(
  trace: AgentTrace,
  a: Assertion,
  ctx: AssertionContext | undefined,
): AssertionResult {
  switch (a.kind) {
    case 'tool_called': {
      const matches = trace.toolCalls.filter(
        (c) => c.name === a.name && argsMatch(c.input, a.args_match),
      );
      return matches.length > 0
        ? { assertion: a, pass: true }
        : {
            assertion: a,
            pass: false,
            detail: `expected tool ${a.name} to be called${
              a.args_match ? ` with args matching ${JSON.stringify(a.args_match)}` : ''
            }`,
          };
    }

    case 'tool_not_called': {
      const matches = trace.toolCalls.filter(
        (c) => c.name === a.name && argsMatch(c.input, a.args_match),
      );
      return matches.length === 0
        ? { assertion: a, pass: true }
        : {
            assertion: a,
            pass: false,
            detail: `expected tool ${a.name} NOT to be called${
              a.args_match ? ` with args matching ${JSON.stringify(a.args_match)}` : ''
            }; was called ${matches.length}x`,
          };
    }

    case 'tool_input_contains_one_of': {
      const calls = a.tool
        ? trace.toolCalls.filter((c) => c.name === a.tool)
        : trace.toolCalls;
      const haystack = toolInputText(calls).toLowerCase();
      const hit = a.options.find((opt) => haystack.includes(opt.toLowerCase()));
      return hit !== undefined
        ? { assertion: a, pass: true, detail: `matched "${hit}"${a.tool ? ` in ${a.tool}` : ''}` }
        : {
            assertion: a,
            pass: false,
            detail: `expected ${
              a.tool ? `${a.tool} input` : 'any tool input'
            } to contain one of: ${a.options.join(', ')}`,
          };
    }

    case 'text_contains': {
      // `flags` defaults to case-insensitive; an invalid pattern fails loudly
      // rather than silently passing.
      let re: RegExp;
      try {
        re = new RegExp(a.pattern, a.flags ?? 'i');
      } catch (err) {
        return {
          assertion: a,
          pass: false,
          detail: `invalid regex /${a.pattern}/${a.flags ?? 'i'}: ${String(err)}`,
        };
      }
      return re.test(trace.finalText)
        ? { assertion: a, pass: true }
        : {
            assertion: a,
            pass: false,
            detail: `expected final text to match /${a.pattern}/${a.flags ?? 'i'}`,
          };
    }

    case 'text_contains_one_of': {
      const lower = trace.finalText.toLowerCase();
      const hit = a.options.find((opt) => lower.includes(opt.toLowerCase()));
      return hit !== undefined
        ? { assertion: a, pass: true, detail: `matched "${hit}"` }
        : {
            assertion: a,
            pass: false,
            detail: `expected final text to contain one of: ${a.options.join(', ')}`,
          };
    }

    case 'text_does_not_contain': {
      const lower = trace.finalText.toLowerCase();
      const violations = a.patterns.filter((p) => lower.includes(p.toLowerCase()));
      return violations.length === 0
        ? { assertion: a, pass: true }
        : {
            assertion: a,
            pass: false,
            detail: `final text contained forbidden pattern(s): ${violations.join(', ')}`,
          };
    }

    case 'output_contains_one_of': {
      // Either the final text OR any tool input may satisfy this.
      const haystack = `${trace.finalText} ${toolInputText(trace.toolCalls)}`.toLowerCase();
      const hit = a.options.find((opt) => haystack.includes(opt.toLowerCase()));
      return hit !== undefined
        ? { assertion: a, pass: true, detail: `matched "${hit}"` }
        : {
            assertion: a,
            pass: false,
            detail: `expected final text or any tool input to contain one of: ${a.options.join(', ')}`,
          };
    }

    case 'iteration_count_under': {
      // Iterations may be unknown; treat absent as 0 (no loop observed).
      const iters = trace.iterations ?? 0;
      return iters < a.n
        ? { assertion: a, pass: true }
        : { assertion: a, pass: false, detail: `iteration count ${iters} >= ${a.n}` };
    }

    case 'iteration_count_at_least': {
      const iters = trace.iterations ?? 0;
      return iters >= a.n
        ? { assertion: a, pass: true }
        : { assertion: a, pass: false, detail: `iteration count ${iters} < ${a.n}` };
    }

    case 'recall_at_k': {
      // At least k (or all) of `expected` must appear in the final text.
      const lower = trace.finalText.toLowerCase();
      const present = a.expected.filter((e) => lower.includes(e.toLowerCase()));
      const target = a.all ? a.expected.length : a.k;
      if (present.length >= target) {
        return {
          assertion: a,
          pass: true,
          detail: `${present.length}/${a.expected.length} expected items present`,
        };
      }
      const missing = a.expected.filter((e) => !lower.includes(e.toLowerCase()));
      return {
        assertion: a,
        pass: false,
        detail: `expected at least ${target} of ${a.expected.length} items in final text, got ${present.length}; missing: ${missing.join(', ')}`,
      };
    }

    case 'every_claim_has_citation': {
      // Delegate to grounding: scan for factual/regulatory sentences that lack
      // an attached citation. Each is an ungrounded claim.
      const violations = detectUncitedClaims(trace.finalText, ctx?.groundingConfig);
      return violations.length === 0
        ? { assertion: a, pass: true }
        : {
            assertion: a,
            pass: false,
            detail: `${violations.length} uncited claim(s): ${violations
              .slice(0, 3)
              .map((v) => `"${v.pattern}"`)
              .join(', ')}${violations.length > 3 ? `, +${violations.length - 3} more` : ''}`,
          };
    }

    case 'citations_resolve': {
      // Parse inline citation tokens out of the final text and check each one
      // resolves against the known source set (explicit ctx, else the trace's
      // own citations).
      const { refs } = parseCitations(trace.finalText);
      if (refs.length === 0) {
        // Nothing claimed -> nothing can be unresolved.
        return { assertion: a, pass: true, detail: 'no citations to resolve' };
      }
      const known = ctx?.knownSources ?? knownIdsFromTrace(trace);
      const { resolved, unresolved } = resolveCitations(refs, known);
      return unresolved.length === 0
        ? { assertion: a, pass: true, detail: `${resolved.length} citation(s) resolved` }
        : {
            assertion: a,
            pass: false,
            detail: `${unresolved.length} unresolved citation(s): ${unresolved.join(', ')}`,
          };
    }

    case 'quote_matches_source': {
      // For every citation carrying both a quote and a source body, the quote
      // must be a verbatim / near-verbatim match of that source.
      const checkable = (trace.citations ?? []).filter(
        (c): c is Citation & { quote: string; source: string } =>
          typeof c.quote === 'string' &&
          c.quote.length > 0 &&
          typeof c.source === 'string' &&
          c.source.length > 0,
      );
      if (checkable.length === 0) {
        return { assertion: a, pass: true, detail: 'no quoted citations to verify' };
      }
      const mismatches = checkable
        .map((c) => ({ c, result: quoteMatchesSource(c.quote, c.source) }))
        .filter((x) => !x.result.match);
      return mismatches.length === 0
        ? { assertion: a, pass: true, detail: `${checkable.length} quote(s) verified` }
        : {
            assertion: a,
            pass: false,
            detail: `${mismatches.length} quote(s) did not match source: ${mismatches
              .slice(0, 3)
              .map((m) => `"${truncate(m.c.quote, 40)}" (sim ${m.result.similarity.toFixed(2)})`)
              .join(', ')}${mismatches.length > 3 ? `, +${mismatches.length - 3} more` : ''}`,
          };
    }

    case 'refusal': {
      // Tolerant heuristic for the agent declining / deferring rather than
      // answering. Kept generic (no Deminn workflow phrasing) so it works for
      // any agent: matches common "I can't / won't / that's outside ..." forms
      // and explicit safe-completion language.
      const t = trace.finalText;
      const refusalPattern =
        /\bi\s+(can(?:not|'?t)|won'?t|am\s+(?:un|not\s+)able|do\s*n['o]?t|will\s+not)\b/i.test(t) ||
        /\b(?:that(?:'s| is)|this(?:'s| is)|it(?:'s| is))\s+(?:not|outside|beyond)\b/i.test(t) ||
        /\b(?:unable|not able)\s+to\s+(?:help|assist|provide|answer|comply|do)\b/i.test(t) ||
        /\b(?:cannot|can'?t)\s+(?:help|assist|provide|answer|comply|fulfil|fulfill)\b/i.test(t) ||
        /\bi\s+must\s+(?:decline|refuse)\b/i.test(t);
      return refusalPattern
        ? { assertion: a, pass: true }
        : { assertion: a, pass: false, detail: 'expected a refusal / deferral phrase in the final text' };
    }
  }
}

/**
 * Tolerant argument matcher. For string expected values, treats the expected
 * string as a case-insensitive regex (falling back to substring containment on
 * an invalid pattern) so model-chosen wording still matches. Non-string values
 * use strict equality.
 */
function argsMatch(
  actual: Record<string, unknown>,
  expected?: Record<string, unknown>,
): boolean {
  if (!expected) return true;
  for (const [key, value] of Object.entries(expected)) {
    const av = actual[key];
    if (typeof value === 'string') {
      if (typeof av !== 'string') return false;
      try {
        const re = new RegExp(value, 'i');
        if (!re.test(av)) return false;
      } catch {
        if (!av.toLowerCase().includes(value.toLowerCase())) return false;
      }
    } else if (av !== value) {
      return false;
    }
  }
  return true;
}

/** Flatten the string-valued inputs of the given tool calls into one blob. */
function toolInputText(calls: readonly ToolCall[]): string {
  return calls
    .map((c) =>
      Object.values(c.input)
        .filter((v): v is string => typeof v === 'string')
        .join(' '),
    )
    .join(' ');
}

/** Derive the known-source id set from a trace's own citations (id, then ref). */
function knownIdsFromTrace(trace: AgentTrace): string[] {
  const ids: string[] = [];
  for (const c of trace.citations ?? []) {
    if (typeof c.id === 'string' && c.id.length > 0) ids.push(c.id);
    else if (typeof c.ref === 'string' && c.ref.length > 0) ids.push(c.ref);
  }
  return ids;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

/** One-line human summary of a trace, handy in test output and run logs. */
export function summariseRun(trace: AgentTrace): string {
  const tools =
    trace.toolCalls
      .map((c) => `${c.name}(${Object.keys(c.input).join(',')})`)
      .join(' -> ') || '<no tools>';
  const iters = trace.iterations ?? 0;
  return `${iters} iters, ${trace.toolCalls.length} tool calls [${tools}], finalText.length=${trace.finalText.length}`;
}
