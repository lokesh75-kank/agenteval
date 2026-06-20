// Regression tests for bugs found in the Phase-4 adversarial review.
// Each test pins a specific fix so the bug cannot silently return.

import { describe, expect, it } from 'vitest';

import { judge, parseVerdict } from '../src/judge/index.js';
import { runScenario } from '../src/core/runner.js';
import { evaluateAssertions } from '../src/assertions/index.js';
import { detectUncitedClaims, findOrphanReferences, REGULATED_PRESET, quoteMatchesSource } from '../src/grounding/index.js';
import { estimateCost } from '../src/llm/index.js';
import { otelToTrace } from '../src/ingest/index.js';
import { defineAdapter, type AgentTrace, type LLMClient } from '../src/index.js';

const trace = (over: Partial<AgentTrace> = {}): AgentTrace => ({
  input: { user_message: 'hi' },
  finalText: '',
  toolCalls: [],
  ...over,
});

// A fake LLM that always returns a fixed reply.
const fakeLLM = (reply: string): LLMClient => ({ async complete() { return { text: reply, model: 'fake' }; } });

describe('judge: tolerant verdict parsing', () => {
  it('parses a verdict that follows a leading reasoning code fence', () => {
    const reply = '```\nLet me think about this...\n```\n```json\n{"pass": true, "reason": "ok"}\n```';
    expect(parseVerdict(reply)?.pass).toBe(true);
  });

  it('parses a verdict whose string value contains a brace', () => {
    const reply = '{"pass": false, "reason": "found a stray } here"}';
    const v = parseVerdict(reply);
    expect(v?.pass).toBe(false);
    expect(v?.reason).toContain('stray');
  });
});

describe('judge: fail closed', () => {
  it('counts a throwing LLM as a failing vote instead of crashing', async () => {
    const throwing: LLMClient = { async complete() { throw new Error('rate limited'); } };
    const result = await judge({ trace: trace(), rubric: 'any', llm: throwing, votes: 3 });
    expect(result.pass).toBe(false);
    expect(result.passingVotes).toBe(0);
    expect(result.rationale.join(' ')).toContain('failed');
  });

  it('passes when a majority of votes pass', async () => {
    const result = await judge({ trace: trace(), rubric: 'any', llm: fakeLLM('{"pass": true, "reason": "good"}'), votes: 3 });
    expect(result.pass).toBe(true);
    expect(result.passingVotes).toBe(3);
  });
});

describe('runner: judge without an llm fails closed', () => {
  it('does not silently pass a scenario that declares a judge rubric when no llm is given', async () => {
    const adapter = defineAdapter({ async run(input) { return trace({ input, finalText: 'whatever' }); } });
    const summary = await runScenario(
      adapter,
      { id: 's', input: { user_message: 'q' }, asserts: [], judge: { rubric: 'must be great' } },
      { runs: 1 }, // no llm provided
    );
    expect(summary.pass).toBe(false);
    expect(summary.perRun[0]?.judge?.pass).toBe(false);
  });
});

describe('assertions: recall_at_k does not vacuously pass on k=0', () => {
  it('fails when nothing matches even though k=0', () => {
    const [r] = evaluateAssertions(trace({ finalText: 'nothing relevant here' }), [
      { kind: 'recall_at_k', expected: ['alpha', 'beta'], k: 0 },
    ]);
    expect(r?.pass).toBe(false);
  });
});

describe('grounding: coherence tag matching is not over-broad', () => {
  it('does not flag ordinary all-caps-plus-digit prose tokens as orphan references', () => {
    const sections = [
      { id: 's1', title: 'A', content: 'See FIGURE2 and TABLE3 and ISO9001 and PART820.' },
      { id: 's2', title: 'B', content: 'Again FIGURE2 and TABLE3 and ISO9001 and PART820.' },
    ];
    expect(findOrphanReferences(sections)).toHaveLength(0);
  });

  it('still flags a real hyphenated tag referenced across sections', () => {
    const sections = [
      { id: 's1', title: 'A', content: 'Implement CA-1 now.' },
      { id: 's2', title: 'B', content: 'CA-1 is also relevant.' },
    ];
    expect(findOrphanReferences(sections).map((o) => o.tag)).toContain('CA-1');
  });
});

describe('grounding: regulated imperative coverage restored', () => {
  it('flags "requires" and "may not" claims, not just shall/must', () => {
    expect(detectUncitedClaims('Per 21 CFR 820, the manufacturer requires documented review.', REGULATED_PRESET)).toHaveLength(1);
    expect(detectUncitedClaims('Under 21 CFR 803, devices may not be shipped without review.', REGULATED_PRESET)).toHaveLength(1);
  });
});

describe('grounding: quote match/similarity agree at the boundary', () => {
  it('never reports match=false with similarity>=0.9 (or vice versa)', () => {
    const r = quoteMatchesSource('abcdefghij', 'abcdefghiX'); // 9/10 chars overlap
    expect(r.match).toBe(r.similarity >= 0.9);
  });
});

describe('ingest: otelToTrace does not mutate its input', () => {
  it('leaves the caller spans untouched (pure transform)', () => {
    const spans = [
      { spanId: 'root', name: 'gen_ai.chat', attributes: { 'gen_ai.prompt': 'hello', 'gen_ai.completion': 'hi there' } },
      { spanId: 'tool1', parentSpanId: 'root', name: 'execute_tool search', attributes: { 'gen_ai.tool.name': 'search' } },
    ];
    const before = JSON.stringify(spans);
    otelToTrace(spans);
    expect(JSON.stringify(spans)).toBe(before);
  });
});

describe('cost: multi-segment model ids resolve', () => {
  it('resolves a Bedrock-style cross-region id to a known (non-default) price', () => {
    // Pick any model present in PRICING via a prefixed id; cost should be > 0
    // and equal to the cost of the bare id.
    const bare = estimateCost('claude-sonnet-4-6', 1_000_000, 1_000_000);
    const bedrock = estimateCost('us.anthropic.claude-sonnet-4-6-v1:0', 1_000_000, 1_000_000);
    expect(bare).toBeGreaterThan(0);
    expect(bedrock).toBe(bare);
  });
});
