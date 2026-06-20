/**
 * Google (Gemini) implementation of the provider-agnostic {@link LLMClient}.
 *
 * The `@google/genai` package is an OPTIONAL peer dependency, imported lazily
 * inside `complete()` exactly like the Anthropic provider. Construction never
 * imports the SDK, so a consumer who never calls Gemini does not need it.
 */

import type { LLMClient, LLMRequest, LLMResponse } from './index.js';

/** Options for {@link createGoogle}. */
export interface GoogleOptions {
  /** API key. Defaults to `GEMINI_API_KEY`, then `GOOGLE_API_KEY`. */
  apiKey?: string;
  /** Model id. Defaults to a current Gemini model. */
  model?: string;
}

/** Default Gemini model used when the caller does not specify one. */
export const DEFAULT_GOOGLE_MODEL = 'gemini-2.5-flash';

/**
 * Shape of the response object the @google/genai SDK returns. Declared locally
 * so this file does not type-depend on the optional SDK. Only fields we read
 * are described.
 */
interface GoogleResponseLike {
  text?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

/**
 * Create an {@link LLMClient} backed by the Gemini API.
 *
 * The SDK is imported lazily on first `complete()`; a missing package throws a
 * clear install hint. The API key is read from `opts.apiKey`, then
 * `GEMINI_API_KEY`, then `GOOGLE_API_KEY`.
 */
export function createGoogle(opts: GoogleOptions = {}): LLMClient {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const model = opts.model ?? DEFAULT_GOOGLE_MODEL;

  return {
    async complete(req: LLMRequest): Promise<LLMResponse> {
      let mod: typeof import('@google/genai');
      try {
        mod = await import('@google/genai');
      } catch {
        throw new Error(
          "createGoogle requires the optional peer dependency '@google/genai'. " +
            "Install it with: npm install @google/genai",
        );
      }

      if (!apiKey || apiKey.trim().length === 0) {
        throw new Error(
          'Google API key is not configured. Pass { apiKey } to createGoogle or set ' +
            'the GEMINI_API_KEY (or GOOGLE_API_KEY) environment variable.',
        );
      }

      const { GoogleGenAI } = mod;
      const ai = new GoogleGenAI({ apiKey });

      // Gemini takes the conversation as `contents` (role + parts) and the
      // system prompt + sampling controls under `config`.
      const response = (await ai.models.generateContent({
        model,
        contents: req.messages.map((m) => ({
          // Gemini uses "model" for the assistant role.
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        config: {
          ...(req.system !== undefined ? { systemInstruction: req.system } : {}),
          ...(req.maxTokens !== undefined ? { maxOutputTokens: req.maxTokens } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        },
      })) as unknown as GoogleResponseLike;

      const usage = response.usageMetadata;
      return {
        text: response.text ?? '',
        model,
        ...(usage?.promptTokenCount !== undefined ? { inputTokens: usage.promptTokenCount } : {}),
        ...(usage?.candidatesTokenCount !== undefined ? { outputTokens: usage.candidatesTokenCount } : {}),
      };
    },
  };
}
