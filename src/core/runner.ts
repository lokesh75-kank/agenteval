// The scenario runner: the heart of AgentEval.
//
// Runs an agent (via its AgentAdapter) against scenarios. The defining feature
// is DETERMINISM SCORING: each scenario runs N times and we report how often it
// passed (passingRuns / totalRuns). A scenario that answers differently across
// identical runs is flaky - exactly the failure a single hand-check never
// catches and the one that is unacceptable in high-stakes domains.
//
// Each run: execute the adapter, evaluate structural/grounding assertions, and
// (if a judge rubric + an LLM client are provided) run the LLM-as-judge. A run
// passes only if every assertion passes, the judge passes, and the agent did
// not error.

import type { AgentAdapter, AgentTrace } from './trace.js';
import type {
  Scenario,
  ScenarioResult,
  ScenarioRunSummary,
  SuiteReport,
} from './types.js';
import { evaluateAssertions, type AssertionContext } from '../assertions/index.js';
import { judge as runJudge } from '../judge/index.js';
import type { LLMClient } from '../llm/index.js';

export interface RunOptions {
  /** How many times to run each scenario (determinism sampling). Default 1. */
  runs?: number;
  /**
   * Fraction of runs that must pass for the scenario to pass overall.
   * Default 2/3 (a "2 of 3" majority convention). With runs=1 this requires a
   * clean pass.
   */
  passThreshold?: number;
  /** LLM client used for any scenario that declares a `judge` rubric. */
  llm?: LLMClient;
  /** Context passed to assertion evaluation (grounding config, known sources). */
  assertion?: AssertionContext;
}

const DEFAULT_PASS_THRESHOLD = 2 / 3;

/** Run one scenario N times and summarize, including the determinism score. */
export async function runScenario(
  adapter: AgentAdapter,
  scenario: Scenario,
  options: RunOptions = {},
): Promise<ScenarioRunSummary> {
  // Coerce defensively: a NaN or non-positive `runs` (e.g. a bad CLI --runs)
  // must not produce NaN loop bounds. A threshold is clamped to [0, 1].
  const runsRaw = Math.floor(Number(options.runs));
  const runs = Number.isFinite(runsRaw) && runsRaw >= 1 ? runsRaw : 1;
  const thRaw = Number(options.passThreshold);
  const passThreshold = Number.isFinite(thRaw)
    ? Math.min(1, Math.max(0, thRaw))
    : DEFAULT_PASS_THRESHOLD;

  const perRun: ScenarioResult[] = [];
  for (let i = 0; i < runs; i++) {
    perRun.push(await runOnce(adapter, scenario, options));
  }

  const passingRuns = perRun.filter((r) => r.pass).length;
  const determinism = passingRuns / runs;
  return {
    scenarioId: scenario.id,
    totalRuns: runs,
    passingRuns,
    determinism,
    pass: determinism >= passThreshold,
    perRun,
  };
}

async function runOnce(
  adapter: AgentAdapter,
  scenario: Scenario,
  options: RunOptions,
): Promise<ScenarioResult> {
  let trace: AgentTrace;
  try {
    trace = await adapter.run(scenario.input);
  } catch (err) {
    trace = {
      input: scenario.input,
      finalText: '',
      toolCalls: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const assertions = evaluateAssertions(trace, scenario.asserts, options.assertion);
  const assertionsPass = assertions.every((a) => a.pass);

  let judgeResult: ScenarioResult['judge'];
  if (scenario.judge) {
    if (options.llm) {
      const v = await runJudge({
        trace,
        rubric: scenario.judge.rubric,
        llm: options.llm,
        votes: scenario.judge.votes,
        passThreshold: scenario.judge.passThreshold,
      });
      judgeResult = {
        pass: v.pass,
        votes: v.votes,
        passingVotes: v.passingVotes,
        detail: v.rationale[0],
      };
    } else {
      // The scenario requires a judge but no LLM client was provided. Fail
      // closed rather than silently passing an unjudged scenario.
      judgeResult = {
        pass: false,
        votes: 0,
        passingVotes: 0,
        detail: 'scenario declares a judge rubric but no llm client was provided to the runner',
      };
    }
  }

  const pass = !trace.error && assertionsPass && (judgeResult ? judgeResult.pass : true);
  return { scenarioId: scenario.id, pass, trace, assertions, judge: judgeResult };
}

/** Run a whole suite and produce an aggregate report. */
export async function runSuite(
  adapter: AgentAdapter,
  scenarios: Scenario[],
  options: RunOptions = {},
): Promise<SuiteReport> {
  const summaries: ScenarioRunSummary[] = [];
  for (const scenario of scenarios) {
    summaries.push(await runScenario(adapter, scenario, options));
  }
  return {
    // Caller stamps the real time; kept deterministic-friendly here.
    generatedAt: new Date().toISOString(),
    totalScenarios: summaries.length,
    passingScenarios: summaries.filter((s) => s.pass).length,
    scenarios: summaries,
  };
}
