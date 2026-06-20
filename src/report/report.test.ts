import { describe, expect, it } from 'vitest';

import type { AgentTrace, ScenarioResult, ScenarioRunSummary, SuiteReport } from '../core/types.js';
import { renderConsole } from './console.js';
import { renderJson } from './json.js';
import { renderHtml } from './html.js';

// ── Fixtures ──────────────────────────────────────────────────────────────

function trace(over: Partial<AgentTrace> = {}): AgentTrace {
  return {
    input: { user_message: 'hello' },
    finalText: 'response text',
    toolCalls: [],
    ...over,
  };
}

function passingRun(scenarioId: string): ScenarioResult {
  return {
    scenarioId,
    pass: true,
    trace: trace(),
    assertions: [
      { assertion: { kind: 'tool_called', name: 'search' }, pass: true },
      { assertion: { kind: 'every_claim_has_citation' }, pass: true },
    ],
  };
}

function failingRun(scenarioId: string): ScenarioResult {
  return {
    scenarioId,
    pass: false,
    trace: trace({ error: 'tool timeout' }),
    assertions: [
      { assertion: { kind: 'tool_called', name: 'lookup_regulation' }, pass: false, detail: 'never invoked' },
      { assertion: { kind: 'citations_resolve' }, pass: false, detail: '21 CFR 999.99 unresolved' },
    ],
    judge: { pass: false, votes: 3, passingVotes: 1, detail: 'answer omitted required caveat' },
  };
}

function summary(over: Partial<ScenarioRunSummary> & { scenarioId: string }): ScenarioRunSummary {
  const perRun = over.perRun ?? [passingRun(over.scenarioId)];
  return {
    totalRuns: perRun.length,
    passingRuns: perRun.filter((r) => r.pass).length,
    determinism: perRun.length ? perRun.filter((r) => r.pass).length / perRun.length : 1,
    pass: perRun.every((r) => r.pass),
    perRun,
    ...over,
  };
}

function makeReport(): SuiteReport {
  const good = summary({
    scenarioId: 'cites-sources',
    perRun: [passingRun('cites-sources'), passingRun('cites-sources')],
  });
  const flaky = summary({
    scenarioId: 'regulatory-lookup',
    perRun: [failingRun('regulatory-lookup'), passingRun('regulatory-lookup')],
  });
  return {
    generatedAt: '2026-06-20T10:00:00.000Z',
    totalScenarios: 2,
    passingScenarios: 1,
    scenarios: [good, flaky],
  };
}

// ── renderConsole ───────────────────────────────────────────────────────────

describe('renderConsole', () => {
  it('shows per-scenario status, determinism, and failing assertion detail', () => {
    const out = renderConsole(makeReport());
    expect(out).toContain('[PASS] cites-sources');
    expect(out).toContain('[FAIL] regulatory-lookup');
    // flaky scenario passed 1 of 2 runs => 50% determinism
    expect(out).toContain('determinism 50%');
    expect(out).toContain('determinism 100%');
    // failing-assertion details from the representative (first) run
    expect(out).toContain('tool_called: lookup_regulation');
    expect(out).toContain('never invoked');
    expect(out).toContain('citations_resolve');
    // run error and judge surfaced
    expect(out).toContain('error: tool timeout');
    expect(out).toContain('judge: 1/3 votes');
  });

  it('emits a suite summary line with grounding rate', () => {
    const out = renderConsole(makeReport());
    expect(out).toContain('1/2 scenarios passed');
    expect(out).toContain('overall determinism 75.0%');
    expect(out).toContain('grounding');
  });

  it('omits grounding from the summary when no grounding assertions exist', () => {
    const report: SuiteReport = {
      generatedAt: '2026-06-20T10:00:00.000Z',
      totalScenarios: 1,
      passingScenarios: 1,
      scenarios: [
        summary({
          scenarioId: 'plain',
          perRun: [
            {
              scenarioId: 'plain',
              pass: true,
              trace: trace(),
              assertions: [{ assertion: { kind: 'text_contains', pattern: 'ok' }, pass: true }],
            },
          ],
        }),
      ],
    };
    const out = renderConsole(report);
    expect(out).not.toContain('grounding');
    expect(out).toContain('1/1 scenarios passed');
  });
});

// ── renderJson ──────────────────────────────────────────────────────────────

describe('renderJson', () => {
  it('produces parseable JSON that round-trips the report', () => {
    const report = makeReport();
    const json = renderJson(report);
    expect(json).toContain('"scenarioId"');
    const parsed = JSON.parse(json) as SuiteReport;
    expect(parsed.totalScenarios).toBe(2);
    expect(parsed.passingScenarios).toBe(1);
    expect(parsed.scenarios).toHaveLength(2);
  });

  it('emits keys in a stable sorted order regardless of construction order', () => {
    const a: SuiteReport = {
      generatedAt: 'x',
      totalScenarios: 0,
      passingScenarios: 0,
      scenarios: [],
    };
    const b: SuiteReport = {
      scenarios: [],
      passingScenarios: 0,
      totalScenarios: 0,
      generatedAt: 'x',
    };
    expect(renderJson(a)).toBe(renderJson(b));
    // sorted: generatedAt before passingScenarios before scenarios
    const idxGen = renderJson(a).indexOf('"generatedAt"');
    const idxPass = renderJson(a).indexOf('"passingScenarios"');
    expect(idxGen).toBeLessThan(idxPass);
  });
});

// ── renderHtml ──────────────────────────────────────────────────────────────

describe('renderHtml', () => {
  it('returns a self-contained html document with inline styles and no external refs', () => {
    const html = renderHtml(makeReport());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('<style>');
    // self-contained: no external stylesheet or script tags
    expect(html).not.toContain('<link');
    expect(html).not.toContain('<script');
    // no em dashes per the regulated-document style rule
    expect(html).not.toContain('—');
  });

  it('renders the executive summary scores and verdict', () => {
    const html = renderHtml(makeReport(), { agentName: 'CAPA Drafter', title: 'Quarterly Attestation' });
    expect(html).toContain('Quarterly Attestation');
    expect(html).toContain('CAPA Drafter');
    expect(html).toContain('2026-06-20T10:00:00.000Z');
    expect(html).toContain('1 / 2'); // scenarios passed card
    expect(html).toContain('75.0%'); // overall determinism
    expect(html).toContain('ATTENTION REQUIRED'); // not all passed
  });

  it('renders per-scenario evidence including assertions and judge verdict', () => {
    const html = renderHtml(makeReport());
    expect(html).toContain('cites-sources');
    expect(html).toContain('regulatory-lookup');
    expect(html).toContain('lookup_regulation');
    expect(html).toContain('21 CFR 999.99 unresolved');
    expect(html).toContain('grounding'); // grounding tag on citation assertions
    expect(html).toContain('votes'); // judge cell
    expect(html).toContain('run error: tool timeout');
  });

  it('shows a clean PASS verdict when every scenario passes', () => {
    const report: SuiteReport = {
      generatedAt: '2026-06-20T10:00:00.000Z',
      totalScenarios: 1,
      passingScenarios: 1,
      scenarios: [summary({ scenarioId: 'cites-sources' })],
    };
    const html = renderHtml(report);
    expect(html).toContain('verdict-ok');
    expect(html).toContain('>PASS<');
    expect(html).not.toContain('ATTENTION REQUIRED');
  });

  it('escapes html-significant characters in scenario ids and details', () => {
    const evil: ScenarioResult = {
      scenarioId: '<script>x</script>',
      pass: false,
      trace: trace(),
      assertions: [
        { assertion: { kind: 'text_contains', pattern: 'a' }, pass: false, detail: 'got <b>bad</b> & worse' },
      ],
    };
    const report: SuiteReport = {
      generatedAt: 'now',
      totalScenarios: 1,
      passingScenarios: 0,
      scenarios: [summary({ scenarioId: '<script>x</script>', perRun: [evil] })],
    };
    const html = renderHtml(report);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('got &lt;b&gt;bad&lt;/b&gt; &amp; worse');
    // the only <script tokens present must be escaped, never a real tag
    expect(html).not.toContain('<script>x</script>');
  });
});
