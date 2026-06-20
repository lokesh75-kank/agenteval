import { describe, it, expect } from 'vitest';
import { otelToTrace, langsmithToTrace } from './index.js';

describe('otelToTrace', () => {
  it('maps a nested GenAI span tree (indexed prompt/completion encoding)', () => {
    // A realistic OpenLLMetry-style root chat span with one tool child.
    const root = {
      name: 'chat anthropic',
      spanId: 'root',
      startTimeUnixNano: 1_000_000_000_000_000_000, // ns
      endTimeUnixNano: 1_000_000_002_000_000_000, // +2s
      attributes: {
        'gen_ai.system': 'anthropic',
        'gen_ai.operation.name': 'chat',
        'gen_ai.prompt.0.role': 'system',
        'gen_ai.prompt.0.content': 'You are helpful.',
        'gen_ai.prompt.1.role': 'user',
        'gen_ai.prompt.1.content': 'What is the boiling point of water?',
        'gen_ai.completion.0.role': 'assistant',
        'gen_ai.completion.0.content': 'Water boils at 100 C at sea level.',
        'gen_ai.usage.input_tokens': 42,
        'gen_ai.usage.output_tokens': 11,
      },
      children: [
        {
          name: 'execute_tool lookup',
          spanId: 'tool1',
          parentSpanId: 'root',
          attributes: {
            'gen_ai.operation.name': 'execute_tool',
            'gen_ai.tool.name': 'lookup',
            'gen_ai.tool.input': '{"q":"boiling point water"}',
            'gen_ai.tool.output': '{"answer":"100C"}',
          },
        },
      ],
    };

    const trace = otelToTrace(root);

    expect(trace.input.user_message).toBe('What is the boiling point of water?');
    expect(trace.finalText).toBe('Water boils at 100 C at sea level.');
    expect(trace.tokens).toEqual({ input: 42, output: 11 });
    expect(trace.durationMs).toBe(2000);
    expect(trace.iterations).toBe(1);
    expect(trace.toolCalls).toHaveLength(1);
    expect(trace.toolCalls[0]?.name).toBe('lookup');
    expect(trace.toolCalls[0]?.input).toEqual({ q: 'boiling point water' });
    expect(trace.toolCalls[0]?.output).toEqual({ answer: '100C' });
  });

  it('re-nests a flat span array via parentSpanId and handles OTLP attribute arrays', () => {
    const spans = [
      {
        name: 'chat',
        span_id: 'a',
        attributes: [
          { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
          { key: 'gen_ai.prompt.0.role', value: { stringValue: 'user' } },
          { key: 'gen_ai.prompt.0.content', value: { stringValue: 'Hello?' } },
          { key: 'gen_ai.completion.0.content', value: { stringValue: 'Hi there.' } },
          { key: 'gen_ai.usage.prompt_tokens', value: { intValue: '5' } },
          { key: 'gen_ai.usage.completion_tokens', value: { intValue: '3' } },
        ],
      },
      {
        name: 'execute_tool search',
        span_id: 'b',
        parent_span_id: 'a',
        attributes: [
          { key: 'gen_ai.tool.name', value: { stringValue: 'search' } },
          { key: 'gen_ai.tool.arguments', value: { stringValue: '{"query":"x"}' } },
        ],
      },
    ];

    const trace = otelToTrace(spans);

    expect(trace.input.user_message).toBe('Hello?');
    expect(trace.finalText).toBe('Hi there.');
    expect(trace.tokens).toEqual({ input: 5, output: 3 });
    expect(trace.toolCalls).toHaveLength(1);
    expect(trace.toolCalls[0]?.name).toBe('search');
    expect(trace.toolCalls[0]?.input).toEqual({ query: 'x' });
  });

  it('reads a single-blob prompt/completion (array of role/content messages)', () => {
    const span = {
      name: 'gen_ai.chat',
      attributes: {
        'gen_ai.prompt': [
          { role: 'user', content: 'first' },
          { role: 'user', content: 'latest question' },
        ],
        'gen_ai.completion': [{ role: 'assistant', content: 'the answer' }],
      },
    };
    const trace = otelToTrace(span);
    expect(trace.input.user_message).toBe('latest question');
    expect(trace.finalText).toBe('the answer');
  });

  it('parses an OTLP wrapper (resourceSpans/scopeSpans)', () => {
    const otlp = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  name: 'chat',
                  spanId: 'r',
                  attributes: {
                    'gen_ai.prompt.0.role': 'user',
                    'gen_ai.prompt.0.content': 'q',
                    'gen_ai.completion.0.content': 'a',
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const trace = otelToTrace(otlp);
    expect(trace.input.user_message).toBe('q');
    expect(trace.finalText).toBe('a');
  });

  it('surfaces an ERROR span status as trace.error', () => {
    const span = {
      name: 'chat',
      status: { code: 'ERROR', message: 'rate limited' },
      attributes: { 'gen_ai.prompt.0.content': 'hi', 'gen_ai.prompt.0.role': 'user' },
    };
    const trace = otelToTrace(span);
    expect(trace.error).toBe('rate limited');
  });

  it('degrades to an empty best-effort trace for unknown input', () => {
    expect(otelToTrace(null)).toEqual({ input: { user_message: '' }, finalText: '', toolCalls: [] });
    expect(otelToTrace(42)).toEqual({ input: { user_message: '' }, finalText: '', toolCalls: [] });
    const empty = otelToTrace({});
    expect(empty.input.user_message).toBe('');
    expect(empty.toolCalls).toEqual([]);
  });
});

describe('langsmithToTrace', () => {
  it('maps a LangGraph-style run with a tool child run', () => {
    const run = {
      run_type: 'chain',
      name: 'AgentExecutor',
      start_time: '2026-06-20T10:00:00.000Z',
      end_time: '2026-06-20T10:00:03.500Z',
      inputs: { input: 'How tall is Mount Everest?' },
      outputs: { output: 'Mount Everest is 8,849 meters tall.' },
      child_runs: [
        {
          run_type: 'llm',
          name: 'ChatAnthropic',
          inputs: { messages: [{ role: 'user', content: 'How tall is Mount Everest?' }] },
          outputs: {
            generations: [[{ text: 'I should look that up.' }]],
            llm_output: { token_usage: { prompt_tokens: 30, completion_tokens: 8 } },
          },
        },
        {
          run_type: 'tool',
          name: 'wiki_search',
          inputs: { query: 'height of Mount Everest' },
          outputs: { output: '8849 m' },
        },
        {
          run_type: 'llm',
          name: 'ChatAnthropic',
          inputs: { messages: [{ role: 'user', content: 'summarize' }] },
          outputs: {
            generations: [[{ text: 'Mount Everest is 8,849 meters tall.' }]],
            usage_metadata: { input_tokens: 50, output_tokens: 12 },
          },
        },
      ],
    };

    const trace = langsmithToTrace(run);

    expect(trace.input.user_message).toBe('How tall is Mount Everest?');
    expect(trace.finalText).toBe('Mount Everest is 8,849 meters tall.');
    expect(trace.durationMs).toBe(3500);
    expect(trace.iterations).toBe(2); // two llm child runs
    // tokens summed across both llm runs: (30+8) + (50+12)
    expect(trace.tokens).toEqual({ input: 80, output: 20 });
    expect(trace.toolCalls).toHaveLength(1);
    expect(trace.toolCalls[0]?.name).toBe('wiki_search');
    expect(trace.toolCalls[0]?.input).toEqual({ query: 'height of Mount Everest' });
    expect(trace.toolCalls[0]?.output).toBe('8849 m');
  });

  it('extracts the last human message from a messages list', () => {
    const run = {
      run_type: 'chain',
      inputs: {
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'user', content: 'first question' },
          { role: 'assistant', content: 'an answer' },
          { role: 'human', content: 'follow-up question' },
        ],
      },
      outputs: { output: 'done' },
    };
    const trace = langsmithToTrace(run);
    expect(trace.input.user_message).toBe('follow-up question');
    expect(trace.finalText).toBe('done');
  });

  it('falls back to deepest LLM generation text when root output is empty', () => {
    const run = {
      run_type: 'chain',
      inputs: { question: 'q' },
      outputs: {}, // empty root output
      child_runs: [
        {
          run_type: 'llm',
          inputs: { messages: [{ role: 'user', content: 'q' }] },
          outputs: { generations: [[{ text: 'deep answer' }]] },
        },
      ],
    };
    const trace = langsmithToTrace(run);
    expect(trace.finalText).toBe('deep answer');
  });

  it('records the run error', () => {
    const run = {
      run_type: 'chain',
      inputs: { input: 'q' },
      outputs: null,
      error: 'ToolException: boom',
    };
    const trace = langsmithToTrace(run);
    expect(trace.error).toBe('ToolException: boom');
  });

  it('handles serialized LangChain message objects (kwargs.content)', () => {
    const run = {
      run_type: 'chain',
      inputs: {
        messages: [{ type: 'human', kwargs: { content: 'serialized question' } }],
      },
      outputs: { output: 'ok' },
    };
    const trace = langsmithToTrace(run);
    expect(trace.input.user_message).toBe('serialized question');
  });

  it('degrades to an empty best-effort trace for unknown input', () => {
    expect(langsmithToTrace(null)).toEqual({ input: { user_message: '' }, finalText: '', toolCalls: [] });
    expect(langsmithToTrace('nope')).toEqual({ input: { user_message: '' }, finalText: '', toolCalls: [] });
  });
});
