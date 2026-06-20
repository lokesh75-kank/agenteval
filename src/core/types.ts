// Scenario + assertion + result types.
//
// The Assertion vocabulary is generalized from the evaluation layer of Deminn
// (a regulated quality/compliance agent system) and is domain-agnostic. The
// Scenario shape drops all domain coupling: a scenario here is just an input +
// assertions (+ an optional LLM-judge rubric), runnable against any AgentAdapter.

import type { AgentInput, AgentTrace } from './trace.js';

/**
 * Assertion vocabulary. New kinds extend this union; the evaluator
 * (assertions/) switches on `kind` exhaustively. Assertions read an AgentTrace.
 */
export type Assertion =
  // Tool-call structure
  | { kind: 'tool_called'; name: string; args_match?: Record<string, unknown> }
  | { kind: 'tool_not_called'; name: string; args_match?: Record<string, unknown> }
  | { kind: 'tool_input_contains_one_of'; options: string[]; tool?: string }
  // Final-text content
  | { kind: 'text_contains'; pattern: string; flags?: string }
  | { kind: 'text_contains_one_of'; options: string[] }
  | { kind: 'text_does_not_contain'; patterns: string[] }
  // Either final text OR any tool input
  | { kind: 'output_contains_one_of'; options: string[] }
  // Loop bounds
  | { kind: 'iteration_count_under'; n: number }
  | { kind: 'iteration_count_at_least'; n: number }
  // Recall: at least k (or all) of `expected` appear in the final text
  | { kind: 'recall_at_k'; expected: string[]; k: number; all?: boolean }
  // Grounding (delegate to grounding/): every factual/regulatory claim is cited
  | { kind: 'every_claim_has_citation' }
  // Grounding: emitted citations resolve against the provided source set
  | { kind: 'citations_resolve' }
  // Grounding: quoted text matches its cited source (verbatim/near-verbatim)
  | { kind: 'quote_matches_source' }
  // Heuristic: the agent refused / deferred rather than answering
  | { kind: 'refusal' };

/** An optional LLM-as-judge rubric attached to a scenario. */
export interface JudgeSpec {
  /** Natural-language rubric the judge grades the response against. */
  rubric: string;
  /** Fraction of self-consistency votes that must pass (default 0.5). */
  passThreshold?: number;
  /** Number of judge votes for self-consistency (default 1). */
  votes?: number;
}

/**
 * One eval scenario. Loaded from YAML or constructed in code. No domain
 * context - just input + assertions (+ an optional judge).
 */
export interface Scenario {
  id: string;
  description?: string;
  /** Optional grouping tags (e.g. "smoke"). */
  tags?: string[];
  /** The input handed to the agent. */
  input: AgentInput;
  /** Structural / content / grounding assertions. */
  asserts: Assertion[];
  /** Optional LLM-judge rubric. */
  judge?: JudgeSpec;
}

export interface AssertionResult {
  assertion: Assertion;
  pass: boolean;
  detail?: string;
}

/** Result of evaluating one scenario against one trace. */
export interface ScenarioResult {
  scenarioId: string;
  /** Overall pass = every assertion passed, judge passed (if any), no run error. */
  pass: boolean;
  trace: AgentTrace;
  assertions: AssertionResult[];
  judge?: { pass: boolean; votes: number; passingVotes: number; detail?: string };
}

/**
 * Summary across N runs of the same scenario - the determinism / flakiness
 * measure. `pass` uses an N-of-M threshold; `determinism` is passingRuns/totalRuns.
 */
export interface ScenarioRunSummary {
  scenarioId: string;
  totalRuns: number;
  passingRuns: number;
  /** passingRuns / totalRuns - the flakiness signal (1.0 = fully deterministic). */
  determinism: number;
  /** True if determinism >= passThreshold. */
  pass: boolean;
  perRun: ScenarioResult[];
}

/** Aggregate report across all scenarios in a suite run. */
export interface SuiteReport {
  generatedAt: string;
  totalScenarios: number;
  passingScenarios: number;
  scenarios: ScenarioRunSummary[];
}

/** Re-export the trace types so consumers import everything from one place. */
export type { AgentInput, AgentTrace } from './trace.js';
