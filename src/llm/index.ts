/**
 * Provider-agnostic LLM client surface.
 *
 * A single, minimal `LLMClient.complete()` contract that both the Anthropic and
 * Google adapters implement. Higher layers (the judge, any agent adapters) depend
 * only on this interface, so swapping providers is a one-line change and the
 * concrete SDKs stay optional peer dependencies (imported lazily by each adapter).
 */

/** A single chat turn. Only user/assistant roles; system goes on the request. */
export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A completion request, shaped to the common subset of provider APIs. */
export interface LLMRequest {
  /** Optional system prompt / system instruction. */
  system?: string;
  /** Conversation turns, oldest first. Must start with a user turn. */
  messages: LLMMessage[];
  /** Maximum tokens to generate. Adapters apply a sensible default if omitted. */
  maxTokens?: number;
  /** Sampling temperature. Omit to use the provider default. */
  temperature?: number;
}

/** A normalised completion response. */
export interface LLMResponse {
  /** Concatenated text of the model's reply. */
  text: string;
  /** The model id that produced the reply (as reported by the provider). */
  model: string;
  /** Prompt token count, when the provider reports it. */
  inputTokens?: number;
  /** Completion token count, when the provider reports it. */
  outputTokens?: number;
}

/** The single capability every provider adapter implements. */
export interface LLMClient {
  complete(req: LLMRequest): Promise<LLMResponse>;
}

export { createAnthropic, DEFAULT_ANTHROPIC_MODEL } from './anthropic.js';
export type { AnthropicOptions } from './anthropic.js';

export { createGoogle, DEFAULT_GOOGLE_MODEL } from './google.js';
export type { GoogleOptions } from './google.js';

export { estimateCost, PRICING, DEFAULT_PRICING } from './cost.js';
export type { ModelPricing } from './cost.js';
