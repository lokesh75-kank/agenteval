import { describe, expect, it } from 'vitest';

import { evaluateAssertions, summariseRun, type AssertionContext } from './index.js';
import { REGULATED_PRESET } from '../grounding/index.js';
import type { AgentTrace, Citation, ToolCall } from '../core/trace.js';
import type { Assertion } from '../core/types.js';

// --- helpers ---------------------------------------------------------------

function trace(overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    input: { user_message: 'hello' },
    finalText: '',
    toolCalls: [],
    ...overrides,
  };
}

function call(name: string, input: Record<string, unknown> = {}): ToolCall {
  return { name, input };
}

/** Evaluate a single assertion and return its result. */
function one(t: AgentTrace, a: Assertion, ctx?: AssertionContext) {
  const [r] = evaluateAssertions(t, [a], ctx);
  if (!r) throw new Error('no result');
  return r;
}

// --- tool_called / tool_not_called ----------------------------------------

describe('tool_called', () => {
  it('passes when the tool was called', () => {
    const t = trace({ toolCalls: [call('search')] });
    expect(one(t, { kind: 'tool_called', name: 'search' }).pass).toBe(true);
  });

  it('fails when the tool was not called', () => {
    const t = trace({ toolCalls: [call('other')] });
    const r = one(t, { kind: 'tool_called', name: 'search' });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('search');
  });

  it('honors args_match with tolerant regex/substring', () => {
    const t = trace({ toolCalls: [call('search', { query: 'CAPA-2024-0023 root cause' })] });
    // regex match
    expect(one(t, { kind: 'tool_called', name: 'search', args_match: { query: 'root\\s+cause' } }).pass).toBe(true);
    // substring fallback (string is not a valid lone regex here but still works as substring)
    expect(one(t, { kind: 'tool_called', name: 'search', args_match: { query: 'CAPA-2024-0023' } }).pass).toBe(true);
    // non-matching
    expect(one(t, { kind: 'tool_called', name: 'search', args_match: { query: 'corrective preventive' } }).pass).toBe(false);
  });

  it('matches non-string args by strict equality', () => {
    const t = trace({ toolCalls: [call('paginate', { page: 2, deep: true })] });
    expect(one(t, { kind: 'tool_called', name: 'paginate', args_match: { page: 2 } }).pass).toBe(true);
    expect(one(t, { kind: 'tool_called', name: 'paginate', args_match: { page: 3 } }).pass).toBe(false);
    expect(one(t, { kind: 'tool_called', name: 'paginate', args_match: { deep: true } }).pass).toBe(true);
  });

  it('fails args_match when expected is string but actual is not', () => {
    const t = trace({ toolCalls: [call('paginate', { page: 2 })] });
    expect(one(t, { kind: 'tool_called', name: 'paginate', args_match: { page: '2' } }).pass).toBe(false);
  });
});

describe('tool_not_called', () => {
  it('passes when absent', () => {
    const t = trace({ toolCalls: [call('search')] });
    expect(one(t, { kind: 'tool_not_called', name: 'delete' }).pass).toBe(true);
  });

  it('fails when present and reports the count', () => {
    const t = trace({ toolCalls: [call('delete'), call('delete')] });
    const r = one(t, { kind: 'tool_not_called', name: 'delete' });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('2x');
  });

  it('respects args_match (called with other args still passes)', () => {
    const t = trace({ toolCalls: [call('delete', { id: 'safe' })] });
    expect(one(t, { kind: 'tool_not_called', name: 'delete', args_match: { id: 'danger' } }).pass).toBe(true);
  });
});

// --- tool_input_contains_one_of -------------------------------------------

describe('tool_input_contains_one_of', () => {
  it('matches across all tool inputs when no tool specified', () => {
    const t = trace({ toolCalls: [call('a', { x: 'hello world' }), call('b', { y: 'goodbye' })] });
    expect(one(t, { kind: 'tool_input_contains_one_of', options: ['GOODBYE'] }).pass).toBe(true);
  });

  it('scopes to a named tool', () => {
    const t = trace({ toolCalls: [call('a', { x: 'apple' }), call('b', { y: 'banana' })] });
    expect(one(t, { kind: 'tool_input_contains_one_of', options: ['banana'], tool: 'a' }).pass).toBe(false);
    expect(one(t, { kind: 'tool_input_contains_one_of', options: ['banana'], tool: 'b' }).pass).toBe(true);
  });

  it('ignores non-string input values', () => {
    const t = trace({ toolCalls: [call('a', { n: 42, s: 'forty-two' })] });
    expect(one(t, { kind: 'tool_input_contains_one_of', options: ['42'] }).pass).toBe(false);
    expect(one(t, { kind: 'tool_input_contains_one_of', options: ['forty-two'] }).pass).toBe(true);
  });
});

// --- text assertions ------------------------------------------------------

describe('text_contains', () => {
  it('defaults to case-insensitive', () => {
    const t = trace({ finalText: 'The Quick Brown Fox' });
    expect(one(t, { kind: 'text_contains', pattern: 'quick brown' }).pass).toBe(true);
  });

  it('respects explicit flags', () => {
    const t = trace({ finalText: 'The Quick Brown Fox' });
    expect(one(t, { kind: 'text_contains', pattern: 'quick', flags: '' }).pass).toBe(false);
  });

  it('fails gracefully on invalid regex', () => {
    const t = trace({ finalText: 'anything' });
    const r = one(t, { kind: 'text_contains', pattern: '(' });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('invalid regex');
  });
});

describe('text_contains_one_of', () => {
  it('passes if any option present (case-insensitive) and reports the hit', () => {
    const t = trace({ finalText: 'severity is HIGH' });
    const r = one(t, { kind: 'text_contains_one_of', options: ['low', 'high'] });
    expect(r.pass).toBe(true);
    expect(r.detail).toContain('high');
  });

  it('fails if none present', () => {
    const t = trace({ finalText: 'severity is medium' });
    expect(one(t, { kind: 'text_contains_one_of', options: ['low', 'high'] }).pass).toBe(false);
  });
});

describe('text_does_not_contain', () => {
  it('passes when no forbidden patterns present', () => {
    const t = trace({ finalText: 'all good' });
    expect(one(t, { kind: 'text_does_not_contain', patterns: ['error', 'fail'] }).pass).toBe(true);
  });

  it('fails and lists violations', () => {
    const t = trace({ finalText: 'ERROR: it did Fail' });
    const r = one(t, { kind: 'text_does_not_contain', patterns: ['error', 'fail', 'ok'] });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('error');
    expect(r.detail).toContain('fail');
    expect(r.detail).not.toContain('ok');
  });
});

describe('output_contains_one_of', () => {
  it('matches in final text', () => {
    const t = trace({ finalText: 'the answer is foo' });
    expect(one(t, { kind: 'output_contains_one_of', options: ['foo'] }).pass).toBe(true);
  });

  it('matches in a tool input even if not in final text', () => {
    const t = trace({ finalText: 'no answer', toolCalls: [call('search', { q: 'bar baz' })] });
    expect(one(t, { kind: 'output_contains_one_of', options: ['baz'] }).pass).toBe(true);
  });

  it('fails when absent from both', () => {
    const t = trace({ finalText: 'nope', toolCalls: [call('search', { q: 'other' })] });
    expect(one(t, { kind: 'output_contains_one_of', options: ['xyz'] }).pass).toBe(false);
  });
});

// --- iteration bounds -----------------------------------------------------

describe('iteration_count_under / at_least', () => {
  it('under passes below the bound', () => {
    expect(one(trace({ iterations: 2 }), { kind: 'iteration_count_under', n: 5 }).pass).toBe(true);
  });
  it('under fails at the bound', () => {
    expect(one(trace({ iterations: 5 }), { kind: 'iteration_count_under', n: 5 }).pass).toBe(false);
  });
  it('at_least passes at the bound', () => {
    expect(one(trace({ iterations: 3 }), { kind: 'iteration_count_at_least', n: 3 }).pass).toBe(true);
  });
  it('treats missing iterations as 0', () => {
    expect(one(trace(), { kind: 'iteration_count_under', n: 1 }).pass).toBe(true);
    expect(one(trace(), { kind: 'iteration_count_at_least', n: 1 }).pass).toBe(false);
  });
});

// --- recall_at_k ----------------------------------------------------------

describe('recall_at_k', () => {
  it('passes when at least k items present', () => {
    const t = trace({ finalText: 'mentions alpha and gamma' });
    const r = one(t, { kind: 'recall_at_k', expected: ['alpha', 'beta', 'gamma'], k: 2 });
    expect(r.pass).toBe(true);
    expect(r.detail).toContain('2/3');
  });

  it('fails and lists missing items', () => {
    const t = trace({ finalText: 'only alpha here' });
    const r = one(t, { kind: 'recall_at_k', expected: ['alpha', 'beta', 'gamma'], k: 2 });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('beta');
    expect(r.detail).toContain('gamma');
  });

  it('with all=true requires every item', () => {
    const t = trace({ finalText: 'alpha beta gamma' });
    expect(one(t, { kind: 'recall_at_k', expected: ['alpha', 'beta', 'gamma'], k: 1, all: true }).pass).toBe(true);
    const t2 = trace({ finalText: 'alpha beta' });
    expect(one(t2, { kind: 'recall_at_k', expected: ['alpha', 'beta', 'gamma'], k: 1, all: true }).pass).toBe(false);
  });
});

// --- grounding-flavored assertions (delegated to grounding module) --------

describe('every_claim_has_citation', () => {
  it('passes when there are no uncited claims', () => {
    // Plain conversational text with no factual/regulatory claim sentences.
    const t = trace({ finalText: 'Hi there, how can I help you today?' });
    expect(one(t, { kind: 'every_claim_has_citation' }).pass).toBe(true);
  });

  it('flags an uncited regulatory claim', () => {
    // A genuine claim needs BOTH a claim subject (here a regulation name) AND
    // an imperative marker. Use the regulated preset for regulation-name detection.
    const t = trace({
      finalText: 'Per 21 CFR 820.100, the manufacturer shall establish and maintain CAPA procedures.',
    });
    const r = one(t, { kind: 'every_claim_has_citation' }, { groundingConfig: REGULATED_PRESET });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('uncited');
  });
});

describe('citations_resolve', () => {
  it('passes when there are no citations to resolve', () => {
    const t = trace({ finalText: 'no references here at all' });
    expect(one(t, { kind: 'citations_resolve' }).pass).toBe(true);
  });

  it('passes when inline refs resolve against the trace citations', () => {
    const t = trace({
      finalText: 'Per 21 CFR 820.100 the procedure is required [E1].',
      citations: [
        { id: '21 CFR 820.100' } as Citation,
        { id: 'E1' } as Citation,
      ],
    });
    expect(one(t, { kind: 'citations_resolve' }).pass).toBe(true);
  });

  it('fails when an inline ref does not resolve', () => {
    const t = trace({
      finalText: 'See [E1] and [E2].',
      citations: [{ id: 'E1' } as Citation],
    });
    const r = one(t, { kind: 'citations_resolve' });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('E2');
  });

  it('uses ctx.knownSources when provided', () => {
    const t = trace({ finalText: 'See [E1].' });
    expect(one(t, { kind: 'citations_resolve' }, { knownSources: ['E1'] }).pass).toBe(true);
    expect(one(t, { kind: 'citations_resolve' }, { knownSources: ['E9'] }).pass).toBe(false);
  });
});

describe('quote_matches_source', () => {
  it('passes when there are no quoted citations', () => {
    const t = trace({ finalText: 'x', citations: [{ id: 'E1' } as Citation] });
    expect(one(t, { kind: 'quote_matches_source' }).pass).toBe(true);
  });

  it('passes when a quote matches its source verbatim', () => {
    const t = trace({
      finalText: 'x',
      citations: [
        {
          id: 'E1',
          quote: 'establish and maintain procedures',
          source: 'The manufacturer shall establish and maintain procedures for corrective action.',
        } as Citation,
      ],
    });
    expect(one(t, { kind: 'quote_matches_source' }).pass).toBe(true);
  });

  it('fails when a quote is fabricated', () => {
    const t = trace({
      finalText: 'x',
      citations: [
        {
          id: 'E1',
          quote: 'the moon is made of green cheese entirely',
          source: 'The manufacturer shall establish and maintain procedures for corrective action.',
        } as Citation,
      ],
    });
    const r = one(t, { kind: 'quote_matches_source' });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('did not match');
  });
});

// --- refusal --------------------------------------------------------------

describe('refusal', () => {
  it.each([
    "I can't help with that request.",
    "I cannot provide that information.",
    "I'm unable to assist with this.",
    'That is outside what I can do here.',
    'I must decline to answer.',
  ])('detects refusal phrasing: %s', (txt) => {
    expect(one(trace({ finalText: txt }), { kind: 'refusal' }).pass).toBe(true);
  });

  it('fails when the agent simply answered', () => {
    const t = trace({ finalText: 'Sure, the capital of France is Paris.' });
    expect(one(t, { kind: 'refusal' }).pass).toBe(false);
  });
});

// --- evaluateAssertions ordering + summariseRun ---------------------------

describe('evaluateAssertions', () => {
  it('returns one result per assertion in order', () => {
    const t = trace({ finalText: 'hello world', toolCalls: [call('search')] });
    const results = evaluateAssertions(t, [
      { kind: 'tool_called', name: 'search' },
      { kind: 'text_contains', pattern: 'nope' },
      { kind: 'text_contains_one_of', options: ['world'] },
    ]);
    expect(results.map((r) => r.pass)).toEqual([true, false, true]);
    expect(results).toHaveLength(3);
  });

  it('handles an empty assertion list', () => {
    expect(evaluateAssertions(trace(), [])).toEqual([]);
  });
});

describe('summariseRun', () => {
  it('summarizes tools, iterations, and text length', () => {
    const t = trace({
      finalText: '12345',
      iterations: 2,
      toolCalls: [call('search', { q: 'x' }), call('fetch', { url: 'y' })],
    });
    const s = summariseRun(t);
    expect(s).toContain('2 iters');
    expect(s).toContain('2 tool calls');
    expect(s).toContain('search(q)');
    expect(s).toContain('fetch(url)');
    expect(s).toContain('finalText.length=5');
  });

  it('handles a no-tool trace', () => {
    expect(summariseRun(trace({ finalText: 'hi' }))).toContain('<no tools>');
  });
});
