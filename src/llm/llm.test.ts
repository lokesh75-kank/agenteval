import { describe, it, expect, vi, afterEach } from 'vitest';
import { estimateCost, PRICING, DEFAULT_PRICING } from './cost.js';
import { createAnthropic, DEFAULT_ANTHROPIC_MODEL } from './anthropic.js';
import { createGoogle, DEFAULT_GOOGLE_MODEL } from './google.js';

describe('estimateCost', () => {
  it('computes cost from per-1M rates for a known model', () => {
    // claude-opus-4-8: $5 / 1M input, $25 / 1M output.
    const cost = estimateCost('claude-opus-4-8', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(5 + 25, 10);
  });

  it('scales linearly below 1M tokens', () => {
    // 200k input + 50k output on sonnet ($3 / $15 per 1M).
    const cost = estimateCost('claude-sonnet-4-6', 200_000, 50_000);
    expect(cost).toBeCloseTo((200_000 / 1e6) * 3 + (50_000 / 1e6) * 15, 10);
  });

  it('returns 0 for zero tokens', () => {
    expect(estimateCost('claude-haiku-4-5', 0, 0)).toBe(0);
  });

  it('clamps negative token counts to 0', () => {
    expect(estimateCost('claude-opus-4-8', -100, -100)).toBe(0);
    expect(estimateCost('claude-opus-4-8', -100, 1_000_000)).toBeCloseTo(25, 10);
  });

  it('prices a Gemini model from the table', () => {
    // gemini-2.5-flash: $0.30 / $2.50 per 1M.
    const cost = estimateCost('gemini-2.5-flash', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.3 + 2.5, 10);
  });

  it('uses the default rate for an unknown model', () => {
    const cost = estimateCost('totally-made-up-model', 1_000_000, 0);
    expect(cost).toBeCloseTo(DEFAULT_PRICING.input, 10);
  });

  it('strips a provider prefix (Bedrock-style) before matching', () => {
    expect(estimateCost('anthropic.claude-opus-4-8', 1_000_000, 0)).toBeCloseTo(
      PRICING['claude-opus-4-8']!.input,
      10,
    );
  });

  it('matches dated and -fast suffix variants by prefix', () => {
    const dated = estimateCost('claude-haiku-4-5-20251001', 1_000_000, 0);
    expect(dated).toBeCloseTo(PRICING['claude-haiku-4-5']!.input, 10);

    const fast = estimateCost('claude-opus-4-8-fast', 1_000_000, 0);
    expect(fast).toBeCloseTo(PRICING['claude-opus-4-8']!.input, 10);
  });

  it('prefers the longest matching prefix', () => {
    // "claude-sonnet-4-6-foo" should match sonnet-4-6, not a shorter id.
    expect(estimateCost('claude-sonnet-4-6-foo', 1_000_000, 0)).toBeCloseTo(
      PRICING['claude-sonnet-4-6']!.input,
      10,
    );
  });
});

describe('createAnthropic', () => {
  const orig = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (orig === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = orig;
    vi.restoreAllMocks();
  });

  it('constructs without throwing and without importing the SDK', () => {
    const client = createAnthropic({ apiKey: 'sk-test' });
    expect(client).toBeTruthy();
    expect(typeof client.complete).toBe('function');
  });

  it('exposes a sensible default model id', () => {
    expect(DEFAULT_ANTHROPIC_MODEL).toMatch(/^claude-/);
  });

  it('throws a clear error from complete() when no API key is configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const client = createAnthropic({});
    await expect(
      client.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('shapes the request and normalises the response (mocked SDK)', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world' },
        { type: 'tool_use', name: 'noop' },
      ],
      model: 'claude-opus-4-8',
      usage: { input_tokens: 11, output_tokens: 7 },
    });
    class FakeAnthropic {
      messages = { create };
      constructor(public cfg: { apiKey: string }) {}
    }
    vi.doMock('@anthropic-ai/sdk', () => ({ default: FakeAnthropic }));
    vi.resetModules();

    const { createAnthropic: freshCreate } = await import('./anthropic.js');
    const client = freshCreate({ apiKey: 'sk-test', model: 'claude-opus-4-8' });
    const res = await client.complete({
      system: 'be terse',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 256,
      temperature: 0,
    });

    expect(res.text).toBe('Hello world'); // only text blocks concatenated
    expect(res.model).toBe('claude-opus-4-8');
    expect(res.inputTokens).toBe(11);
    expect(res.outputTokens).toBe(7);

    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.model).toBe('claude-opus-4-8');
    expect(arg.system).toBe('be terse');
    expect(arg.max_tokens).toBe(256);
    expect(arg.temperature).toBe(0);
    expect(arg.messages).toEqual([{ role: 'user', content: 'hi' }]);

    vi.doUnmock('@anthropic-ai/sdk');
  });
});

describe('createGoogle', () => {
  const origGemini = process.env.GEMINI_API_KEY;
  const origGoogle = process.env.GOOGLE_API_KEY;
  afterEach(() => {
    if (origGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = origGemini;
    if (origGoogle === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = origGoogle;
    vi.restoreAllMocks();
  });

  it('constructs without throwing and without importing the SDK', () => {
    const client = createGoogle({ apiKey: 'g-test' });
    expect(client).toBeTruthy();
    expect(typeof client.complete).toBe('function');
  });

  it('exposes a sensible default model id', () => {
    expect(DEFAULT_GOOGLE_MODEL).toMatch(/^gemini-/);
  });

  it('throws a clear error from complete() when no API key is configured', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    const client = createGoogle({});
    await expect(
      client.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/GEMINI_API_KEY/);
  });

  it('maps assistant role to "model" and normalises usage (mocked SDK)', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: 'pong',
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
    });
    class FakeGoogleGenAI {
      models = { generateContent };
      constructor(public cfg: { apiKey: string }) {}
    }
    vi.doMock('@google/genai', () => ({ GoogleGenAI: FakeGoogleGenAI }));
    vi.resetModules();

    const { createGoogle: freshCreate } = await import('./google.js');
    const client = freshCreate({ apiKey: 'g-test', model: 'gemini-2.5-flash' });
    const res = await client.complete({
      system: 'sys',
      messages: [
        { role: 'user', content: 'ping' },
        { role: 'assistant', content: 'earlier' },
      ],
      maxTokens: 64,
    });

    expect(res.text).toBe('pong');
    expect(res.model).toBe('gemini-2.5-flash');
    expect(res.inputTokens).toBe(4);
    expect(res.outputTokens).toBe(2);

    const arg = generateContent.mock.calls[0]![0] as {
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      config: Record<string, unknown>;
    };
    expect(arg.contents[0]!.role).toBe('user');
    expect(arg.contents[1]!.role).toBe('model'); // assistant -> model
    expect(arg.config.systemInstruction).toBe('sys');
    expect(arg.config.maxOutputTokens).toBe(64);

    vi.doUnmock('@google/genai');
  });
});
