/**
 * Token cost estimation for common Claude and Gemini models.
 *
 * Prices are expressed in USD per 1,000,000 tokens (the unit every provider
 * publishes on its pricing page), so the table reads the same as the docs and
 * is trivial to update when prices move. Estimation divides by 1e6 to convert
 * to per-token rates.
 *
 * This file has no SDK dependency on purpose: cost math must work even when
 * the provider SDKs are not installed (e.g. when only reading recorded traces).
 */

/** Input/output price for a single model, USD per 1M tokens. */
export interface ModelPricing {
  /** USD per 1,000,000 input (prompt) tokens. */
  input: number;
  /** USD per 1,000,000 output (completion) tokens. */
  output: number;
}

/**
 * Published list prices (USD per 1M tokens) for the models this package is
 * most likely to drive or score. Keys are the canonical provider model IDs.
 *
 * Prices change; treat this as a best-effort default. Callers can pass through
 * unknown models, which fall back to {@link DEFAULT_PRICING}.
 */
export const PRICING: Readonly<Record<string, ModelPricing>> = {
  // Anthropic Claude (current generation)
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  // Anthropic Claude (legacy, still routable)
  'claude-opus-4-5': { input: 5, output: 25 },
  'claude-sonnet-4-5': { input: 3, output: 15 },

  // Google Gemini
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
} as const;

/**
 * Fallback rate applied when a model id is not present in {@link PRICING}.
 * Chosen to be conservative (mid-tier Claude) so an unknown model never
 * silently estimates as free.
 */
export const DEFAULT_PRICING: ModelPricing = { input: 3, output: 15 };

/**
 * Resolve pricing for a model id, tolerating provider prefixes and date or
 * speed suffixes (e.g. `anthropic.claude-opus-4-8`, `claude-haiku-4-5-20251001`,
 * `claude-opus-4-8-fast`). Returns `undefined` when no entry matches so callers
 * can distinguish "known" from "fell back to default".
 */
function lookupPricing(model: string): ModelPricing | undefined {
  const direct = PRICING[model];
  if (direct) return direct;

  // Strip a provider prefix like "anthropic." or "models/" then retry.
  const stripped = model.replace(/^[a-z]+[./]/, '');
  if (stripped !== model && PRICING[stripped]) return PRICING[stripped];

  // Fall back to the longest known id that appears anywhere in the model id.
  // Using substring containment (not just startsWith) catches multi-segment ids
  // like Bedrock cross-region inference profiles ("us.anthropic.claude-..."),
  // dated snapshots, and "-fast" variants without listing each one.
  let best: ModelPricing | undefined;
  let bestLen = 0;
  for (const [id, price] of Object.entries(PRICING)) {
    if ((model === id || model.includes(id) || stripped.includes(id)) && id.length > bestLen) {
      best = price;
      bestLen = id.length;
    }
  }
  return best;
}

/**
 * Estimate the USD cost of a single completion given its token counts.
 *
 * @param model        Provider model id (known ids and common prefix/suffix
 *                     variants are recognised; unknown ids use the default rate).
 * @param inputTokens  Prompt/input token count.
 * @param outputTokens Completion/output token count.
 * @returns Estimated cost in USD. Negative token counts are clamped to 0.
 */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = lookupPricing(model) ?? DEFAULT_PRICING;
  const inTok = Math.max(0, inputTokens);
  const outTok = Math.max(0, outputTokens);
  return (inTok / 1_000_000) * rates.input + (outTok / 1_000_000) * rates.output;
}
