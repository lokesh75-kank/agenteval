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

// ── Module surfaces (wired in Phase 2) ──
// export { evaluateAssertions, summariseRun } from './assertions/index.js';
// export * as metrics from './metrics/index.js';
// export * as grounding from './grounding/index.js';
// export { judge } from './judge/index.js';
// export { runScenario, runSuite } from './core/runner.js';
// export { loadScenarios, loadScenario } from './core/loader.js';
// export * as report from './report/index.js';
// export * as ingest from './ingest/index.js';
