// End-to-end test: the full evaluate loop over a mock agent, including the
// determinism score, a seeded flaky scenario, grounding, and report rendering.

import { describe, expect, it } from 'vitest';

import { defineAdapter, type Scenario } from '../src/index.js';
import { runSuite } from '../src/core/runner.js';
import { renderConsole, renderJson, renderHtml } from '../src/report/index.js';
import { loadScenarios } from '../src/core/loader.js';
import { resolve } from 'node:path';

// A deterministic mock agent that cites a source for the "refund" path.
const stableAdapter = defineAdapter({
  async run(input) {
    if (input.user_message.toLowerCase().includes('refund')) {
      return {
        input,
        finalText: 'Refunds are available within 30 days. [kb:refund]',
        toolCalls: [{ name: 'search_kb', input: { q: 'refund' } }],
        citations: [{ ref: 'kb:refund', source: 'kb:refund', quote: 'within 30 days' }],
      };
    }
    return { input, finalText: "I can't help with that.", toolCalls: [] };
  },
});

const scenarios: Scenario[] = [
  {
    id: 'refund',
    input: { user_message: 'Can I get a refund?' },
    asserts: [
      { kind: 'tool_called', name: 'search_kb' },
      { kind: 'text_contains_one_of', options: ['30 days'] },
      { kind: 'every_claim_has_citation' },
    ],
  },
  {
    id: 'refusal',
    input: { user_message: 'Tell me a joke' },
    asserts: [{ kind: 'refusal' }],
  },
];

describe('e2e: runSuite', () => {
  it('passes a deterministic agent across N runs with full determinism', async () => {
    const report = await runSuite(stableAdapter, scenarios, {
      runs: 3,
      assertion: { knownSources: ['kb:refund'] },
    });
    expect(report.totalScenarios).toBe(2);
    expect(report.passingScenarios).toBe(2);
    for (const s of report.scenarios) {
      expect(s.determinism).toBe(1);
      expect(s.pass).toBe(true);
    }
  });

  it('detects flakiness: a nondeterministic agent scores below 100% determinism', async () => {
    let n = 0;
    const flaky = defineAdapter({
      async run(input) {
        n += 1;
        // Pass on odd calls, fail on even - 2/3 over 3 runs.
        const ok = n % 2 === 1;
        return { input, finalText: ok ? 'yes 30 days' : 'no idea', toolCalls: [] };
      },
    });
    const flakyScenario: Scenario = {
      id: 'flaky-answer',
      input: { user_message: 'Can I get a refund?' },
      asserts: [{ kind: 'text_contains_one_of', options: ['30 days'] }],
    };
    const summary = await runSuite(flaky, [flakyScenario], { runs: 3, passThreshold: 0.5 });
    const s = summary.scenarios[0]!;
    expect(s.totalRuns).toBe(3);
    expect(s.determinism).toBeGreaterThan(0);
    expect(s.determinism).toBeLessThan(1); // flaky, not fully deterministic
  });

  it('renders console, json, and a self-contained HTML report', async () => {
    const report = await runSuite(stableAdapter, scenarios, { runs: 1 });
    const console = renderConsole(report);
    expect(console).toContain('Summary');
    const json = JSON.parse(renderJson(report));
    expect(json.totalScenarios).toBe(2);
    const html = renderHtml(report, { agentName: 'Test Agent' });
    expect(html).toContain('<html');
    expect(html.toLowerCase()).toContain('determinism');
  });
});

describe('e2e: load + run the regulated benchmark', () => {
  it('loads the bundled benchmark scenarios from YAML', () => {
    const benchDir = resolve(__dirname, '../bench/regulated');
    const loaded = loadScenarios(benchDir);
    expect(loaded.length).toBeGreaterThan(5);
    for (const s of loaded) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.input.user_message).toBe('string');
      expect(Array.isArray(s.asserts)).toBe(true);
    }
  });
});
