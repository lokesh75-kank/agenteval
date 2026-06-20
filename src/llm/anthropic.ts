/**
 * Anthropic (Claude) implementation of the provider-agnostic {@link LLMClient}.
 *
 * The `@anthropic-ai/sdk` package is an OPTIONAL peer dependency: it is only
 * imported lazily, inside `complete()`, via a dynamic `import()`. Constructing
 * the client never touches the SDK, so a consumer who never calls a Claude
 * model does not need the package installed. If it is missing at call time we
 * throw a clear, actionable error.
 */

import type { LLMClient, LLMRequest, LLMResponse } from './index.js';

/** Options for {@link createAnthropic}. */
export interface AnthropicOptions {
  /** API key. Defaults to `process.env.ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /** Model id. Defaults to a current Claude model. */
  model?: string;
}

/** Default Claude model used when the caller does not specify one. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8';

/**
 * Shape of the message Anthropic's SDK returns. Declared locally so this file
 * does not type-depend on the optional SDK (which may be absent at build time
 * for downstream consumers). Only the fields we read are described.
 */
interface AnthropicMessageLike {
  content: Array<{ type: string; text?: string }>;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Create an {@link LLMClient} backed by Anthropic's Messages API.
 *
 * No network call or SDK import happens here; everything is deferred to the
 * first `complete()` call. The API key is resolved at construction time so a
 * misconfiguration surfaces early, but the SDK itself stays optional.
 */
export function createAnthropic(opts: AnthropicOptions = {}): LLMClient {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const model = opts.model ?? DEFAULT_ANTHROPIC_MODEL;

  return {
    async complete(req: LLMRequest): Promise<LLMResponse> {
      // Check config first: a missing key is the more actionable error than a
      // missing SDK when both are absent.
      if (!apiKey || apiKey.trim().length === 0) {
        throw new Error(
          'Anthropic API key is not configured. Pass { apiKey } to createAnthropic ' +
            'or set the ANTHROPIC_API_KEY environment variable.',
        );
      }

      // Lazy, optional-peer-dependency import. Keeping this inside complete()
      // is what makes @anthropic-ai/sdk optional.
      let mod: typeof import('@anthropic-ai/sdk');
      try {
        mod = await import('@anthropic-ai/sdk');
      } catch {
        throw new Error(
          "createAnthropic requires the optional peer dependency '@anthropic-ai/sdk'. " +
            "Install it with: npm install @anthropic-ai/sdk",
        );
      }

      const Anthropic = mod.default;
      const client = new Anthropic({ apiKey });

      // max_tokens is required by the Messages API and must be >= 1; default
      // generously but stay under the non-streaming HTTP-timeout danger zone.
      // Treat an explicit 0 (or negative) as "use the default".
      const message = (await client.messages.create({
        model,
        max_tokens: req.maxTokens && req.maxTokens > 0 ? req.maxTokens : 4096,
        ...(req.system !== undefined ? { system: req.system } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      })) as unknown as AnthropicMessageLike;

      // content is a discriminated union of blocks; concatenate the text ones.
      const text = message.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('');

      return {
        text,
        model: message.model ?? model,
        ...(message.usage?.input_tokens !== undefined ? { inputTokens: message.usage.input_tokens } : {}),
        ...(message.usage?.output_tokens !== undefined ? { outputTokens: message.usage.output_tokens } : {}),
      };
    },
  };
}
