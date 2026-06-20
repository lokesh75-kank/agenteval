// AgentEval public API.
//
// Reliability and audit-evidence testing for LLM agents: wrap any agent in an
// AgentAdapter, define scenarios with assertions (and optional LLM-judge
// rubrics), run them N times to measure determinism, and emit an audit-grade
// report.
//
// Module re-exports below are wired during integration (Phase 2) as each module
// lands. Core contracts are stable and exported now.

// ── Core contracts (stable) ──
export {
  defineAdapter,
  type AgentAdapter,
  type AgentInput,
  type AgentTrace,
  type ToolCall,
  type Citation,
  type AgentStep,
} from './core/trace.js';

export type {
  Assertion,
  JudgeSpec,
  Scenario,
  AssertionResult,
  ScenarioResult,
  ScenarioRunSummary,
  SuiteReport,
} from './core/types.js';

// ── Runner (the core entry point) ──
export { runScenario, runSuite, type RunOptions } from './core/runner.js';
export { loadScenario, loadScenarios, parseScenario } from './core/loader.js';

// ── Assertions ──
export { evaluateAssertions, summariseRun, type AssertionContext } from './assertions/index.js';

// ── Grounding (the audit/citation layer) ──
export {
  checkGrounding,
  detectUncitedClaims,
  parseCitations,
  resolveCitations,
  quoteMatchesSource,
  findOrphanReferences,
  GENERIC_PRESET,
  REGULATED_PRESET,
  type GroundingConfig,
  type GroundingResult,
  type UncitedClaim,
} from './grounding/index.js';

// ── Metrics ──
export * as metrics from './metrics/index.js';
export { computeRecordMetric, type ComputedRecordMetric } from './metrics/record.js';

// ── LLM clients + judge ──
export {
  createAnthropic,
  createGoogle,
  estimateCost,
  type LLMClient,
  type LLMRequest,
  type LLMResponse,
  type LLMMessage,
} from './llm/index.js';
export { judge, type JudgeResult, type JudgeArgs } from './judge/index.js';

// ── Reports (console / json / audit-grade HTML attestation) ──
export { renderConsole, renderJson, renderHtml, type HtmlReportMeta } from './report/index.js';

// ── Ingest (evaluate traces you already collect) ──
export { otelToTrace, langsmithToTrace } from './ingest/index.js';
