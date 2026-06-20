import { describe, it, expect } from 'vitest';
import type { LLMClient, LLMRequest, LLMResponse } from '../llm/index.js';
import type { AgentTrace } from '../core/trace.js';
import { judge, parseVerdict } from './index.js';

/** Minimal trace fixture. */
function makeTrace(overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    input: { user_message: 'What is the recall procedure?' },
    finalText: 'You must follow 21 CFR 820.100 [E1].',
    toolCalls: [{ name: 'search', input: { q: 'recall' } }],
    citations: [{ ref: '[E1]', source: '21 CFR 820.100', quote: 'CAPA' }],
    ...overrides,
  };
}

/**
 * A fake LLMClient that returns canned replies in sequence. Captures the last
 * request so tests can assert on the constructed prompt. When more completions
 * are requested than canned replies exist, the last reply is reused.
 */
function fakeLLM(replies: string[]): LLMClient & { lastRequest?: LLMRequest; calls: number } {
  const client = {
    calls: 0,
    lastRequest: undefined as LLMRequest | undefined,
    async complete(req: LLMRequest): Promise<LLMResponse> {
      client.lastRequest = req;
      const idx = Math.min(client.calls, replies.length - 1);
      client.calls++;
      return { text: replies[idx] ?? '', model: 'fake-judge' };
    },
  };
  return client;
}

describe('parseVerdict (tolerant extraction)', () => {
  it('parses a bare JSON object', () => {
    expect(parseVerdict('{"pass": true, "reason": "good", "score": 0.9}')).toEqual({
      pass: true,
      reason: 'good',
      score: 0.9,
    });
  });

  it('parses JSON wrapped in a ```json code fence', () => {
    const text = 'Here is my verdict:\n```json\n{"pass": false, "reason": "missing citation"}\n```';
    expect(parseVerdict(text)).toEqual({ pass: false, reason: 'missing citation' });
  });

  it('parses JSON wrapped in a bare code fence', () => {
    const text = '```\n{"pass": true, "reason": "ok"}\n```';
    expect(parseVerdict(text)).toEqual({ pass: true, reason: 'ok' });
  });

  it('parses JSON embedded in surrounding prose', () => {
    const text = 'After reviewing, my answer is {"pass": true, "reason": "meets rubric"} overall.';
    expect(parseVerdict(text)).toEqual({ pass: true, reason: 'meets rubric' });
  });

  it('picks the verdict object when nested objects are present', () => {
    const text = '{"pass": true, "reason": "ok", "score": 0.8, "meta": {"k": 1}}';
    const v = parseVerdict(text);
    expect(v?.pass).toBe(true);
    expect(v?.score).toBe(0.8);
  });

  it('returns null when there is no boolean pass', () => {
    expect(parseVerdict('{"reason": "no verdict"}')).toBeNull();
    expect(parseVerdict('not json at all')).toBeNull();
    expect(parseVerdict('')).toBeNull();
  });

  it('drops a non-numeric or non-finite score', () => {
    expect(parseVerdict('{"pass": true, "reason": "x", "score": "high"}')?.score).toBeUndefined();
  });
});

describe('judge (aggregation + threshold)', () => {
  it('single vote pass', async () => {
    const llm = fakeLLM(['{"pass": true, "reason": "great", "score": 1}']);
    const res = await judge({ trace: makeTrace(), rubric: 'Must cite a regulation.', llm });
    expect(res.pass).toBe(true);
    expect(res.votes).toBe(1);
    expect(res.passingVotes).toBe(1);
    expect(res.rationale).toEqual(['great']);
    expect(res.score).toBe(1);
  });

  it('single vote fail', async () => {
    const llm = fakeLLM(['{"pass": false, "reason": "no citation"}']);
    const res = await judge({ trace: makeTrace(), rubric: 'r', llm });
    expect(res.pass).toBe(false);
    expect(res.passingVotes).toBe(0);
  });

  it('majority across votes (2 of 3 pass) with default threshold passes', async () => {
    const llm = fakeLLM([
      '{"pass": true, "reason": "a", "score": 0.9}',
      '{"pass": false, "reason": "b", "score": 0.2}',
      '{"pass": true, "reason": "c", "score": 0.8}',
    ]);
    const res = await judge({ trace: makeTrace(), rubric: 'r', llm, votes: 3 });
    expect(res.votes).toBe(3);
    expect(res.passingVotes).toBe(2);
    expect(res.pass).toBe(true); // 2/3 >= 0.5
    expect(res.rationale).toEqual(['a', 'b', 'c']);
    // Mean of supplied scores.
    expect(res.score).toBeCloseTo((0.9 + 0.2 + 0.8) / 3, 6);
  });

  it('1 of 3 pass fails under default threshold', async () => {
    const llm = fakeLLM([
      '{"pass": true, "reason": "a"}',
      '{"pass": false, "reason": "b"}',
      '{"pass": false, "reason": "c"}',
    ]);
    const res = await judge({ trace: makeTrace(), rubric: 'r', llm, votes: 3 });
    expect(res.passingVotes).toBe(1);
    expect(res.pass).toBe(false); // 1/3 < 0.5
  });

  it('respects a strict passThreshold (unanimity required)', async () => {
    const llm = fakeLLM([
      '{"pass": true, "reason": "a"}',
      '{"pass": true, "reason": "b"}',
      '{"pass": false, "reason": "c"}',
    ]);
    const res = await judge({ trace: makeTrace(), rubric: 'r', llm, votes: 3, passThreshold: 1 });
    expect(res.passingVotes).toBe(2);
    expect(res.pass).toBe(false); // 2/3 < 1.0
  });

  it('counts unparseable replies as non-passing (fails closed)', async () => {
    // 1 pass + 2 unparseable = 1/3 < 0.5 default -> fail. The rationale records
    // the unparseable votes explicitly so a flaky judge is visible.
    const llm = fakeLLM([
      '{"pass": true, "reason": "a"}',
      'the model rambled and never produced JSON',
      'sorry, I cannot comply',
    ]);
    const res = await judge({ trace: makeTrace(), rubric: 'r', llm, votes: 3 });
    expect(res.passingVotes).toBe(1);
    expect(res.pass).toBe(false); // 1/3 < 0.5
    expect(res.rationale.filter((r) => r.includes('unparseable'))).toHaveLength(2);
  });

  it('tolerates code-fenced replies across votes', async () => {
    const llm = fakeLLM([
      '```json\n{"pass": true, "reason": "ok"}\n```',
      'Verdict: {"pass": true, "reason": "also ok"}',
    ]);
    const res = await judge({ trace: makeTrace(), rubric: 'r', llm, votes: 2 });
    expect(res.passingVotes).toBe(2);
    expect(res.pass).toBe(true);
  });

  it('omits score when no vote supplies one', async () => {
    const llm = fakeLLM(['{"pass": true, "reason": "ok"}']);
    const res = await judge({ trace: makeTrace(), rubric: 'r', llm });
    expect(res.score).toBeUndefined();
  });

  it('normalises votes < 1 to a single vote', async () => {
    const llm = fakeLLM(['{"pass": true, "reason": "ok"}']);
    const res = await judge({ trace: makeTrace(), rubric: 'r', llm, votes: 0 });
    expect(res.votes).toBe(1);
    expect(llm.calls).toBe(1);
  });

  it('includes rubric, final text, tool calls and citations in the prompt', async () => {
    const llm = fakeLLM(['{"pass": true, "reason": "ok"}']);
    await judge({
      trace: makeTrace(),
      rubric: 'CITE-A-REG',
      llm,
    });
    const userMsg = llm.lastRequest?.messages[0]?.content ?? '';
    expect(userMsg).toContain('CITE-A-REG');
    expect(userMsg).toContain('21 CFR 820.100'); // from finalText + citation
    expect(userMsg).toContain('search'); // tool call name
    expect(userMsg).toContain('[E1]'); // citation ref
    expect(llm.lastRequest?.system).toContain('impartial evaluator');
  });
});
