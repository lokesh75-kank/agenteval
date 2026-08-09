// v0.2 behavior changes: determinism-first defaults, fail-closed judge ties,
// and configuration provenance recorded into the report.

import { describe, expect, it } from 'vitest';

import { defineAdapter } from '../src/index.js';
import { runScenario, runSuite, resolveRunConfig } from '../src/core/runner.js';
import { judge } from '../src/judge/index.js';
import { renderHtml } from '../src/report/index.js';
import type { LLMClient } from '../src/llm/index.js';

const echoAdapter = defineAdapter({
  async run(input) {
    return { input, finalText: 'ok', toolCalls: [] };
  },
});

const scenario = {
  id: 's1',
  input: { user_message: 'hi' },
  asserts: [{ kind: 'text_contains' as const, pattern: 'ok' }],
};

/** An LLM stub whose judge votes cycle through the given pass verdicts. */
function votingLlm(verdicts: boolean[]): LLMClient {
  let i = 0;
  return {
    provider: 'stub',
    model: 'stub',
    async complete() {
      const pass = verdicts[i++ % verdicts.length];
      return { text: JSON.stringify({ pass, reason: 'stub', score: pass ? 1 : 0 }) };
    },
  } as unknown as LLMClient;
}

describe('v0.2: determinism-first default runs', () => {
  it('defaults to 3 runs per scenario', async () => {
    const summary = await runScenario(echoAdapter, scenario);
    expect(summary.totalRuns).toBe(3);
  });

  it('still honors an explicit runs=1', async () => {
    const summary = await runScenario(echoAdapter, scenario, { runs: 1 });
    expect(summary.totalRuns).toBe(1);
  });

  it('resolveRunConfig falls back to 3 runs / 2-of-3 threshold', () => {
    expect(resolveRunConfig({})).toEqual({ runs: 3, passThreshold: 2 / 3 });
  });
});

describe('v0.2: judge ties fail closed by default', () => {
  it('an even split (1 of 2) fails without an explicit threshold', async () => {
    const result = await judge({
      trace: { input: { user_message: 'q' }, finalText: 'a', toolCalls: [] },
      rubric: 'is it good?',
      llm: votingLlm([true, false]),
      votes: 2,
    });
    expect(result.passingVotes).toBe(1);
    expect(result.pass).toBe(false);
  });

  it('an explicit passThreshold keeps inclusive semantics (1 of 2 at 0.5 passes)', async () => {
    const result = await judge({
      trace: { input: { user_message: 'q' }, finalText: 'a', toolCalls: [] },
      rubric: 'is it good?',
      llm: votingLlm([true, false]),
      votes: 2,
      passThreshold: 0.5,
    });
    expect(result.pass).toBe(true);
  });

  it('a strict majority (2 of 3) still passes by default', async () => {
    const result = await judge({
      trace: { input: { user_message: 'q' }, finalText: 'a', toolCalls: [] },
      rubric: 'is it good?',
      llm: votingLlm([true, true, false]),
      votes: 3,
    });
    expect(result.pass).toBe(true);
  });
});

describe('v0.2: configuration provenance in the report', () => {
  it('runSuite records the resolved config', async () => {
    const report = await runSuite(echoAdapter, [scenario], { runs: 5, passThreshold: 1 });
    expect(report.config).toEqual({ runs: 5, passThreshold: 1 });
  });

  it('renderHtml shows a Test configuration section with runs and threshold', async () => {
    const report = await runSuite(echoAdapter, [scenario], { runs: 4 });
    const html = renderHtml(report);
    expect(html).toContain('Test configuration');
    expect(html).toContain('Runs per scenario');
    expect(html).toContain('<td>4</td>');
    expect(html).toContain('Scenario pass threshold');
  });

  it('renderHtml omits the section for reports without config (e.g. ingested)', () => {
    const html = renderHtml({
      generatedAt: 'x',
      totalScenarios: 0,
      passingScenarios: 0,
      scenarios: [],
    });
    expect(html).not.toContain('Test configuration');
  });
});
