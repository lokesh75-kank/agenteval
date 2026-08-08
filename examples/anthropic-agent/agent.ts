// A real LLM-backed support agent, built on the same optional Anthropic
// client that AgentEval's LLM-judge uses. Unlike examples/basic-agent (a
// deterministic mock), this one is genuinely nondeterministic - which is
// exactly what the determinism score is for.

import type { AgentTrace, AgentInput, Citation } from 'agenteval-core';
import { createAnthropic } from 'agenteval-core';

const KNOWLEDGE_BASE = `
[kb:refund-policy] Refunds are available within 30 days of purchase.
[kb:account-access] Passwords can be reset from the login page via "Forgot password".
[kb:billing-cycle] Subscriptions renew on the 1st of each month.
`;

const SYSTEM = `You are a support agent for a SaaS billing product.
Answer ONLY from the knowledge base below. Cite the source id in square
brackets, e.g. [kb:refund-policy], after any claim it supports. If the
question is outside billing/account topics, refuse briefly and do not answer.

Knowledge base:${KNOWLEDGE_BASE}`;

const llm = createAnthropic({ model: 'claude-opus-5' });

/** Extract `[kb:...]` citation refs from the model's answer. */
function parseCitations(text: string): Citation[] {
  const refs = new Set(text.match(/\[kb:[a-z-]+\]/g) ?? []);
  return [...refs].map((ref) => {
    const source = ref.slice(1, -1); // "[kb:x]" -> "kb:x"
    return { ref, source };
  });
}

export async function supportAgent(input: AgentInput): Promise<AgentTrace> {
  const response = await llm.complete({
    system: SYSTEM,
    messages: [{ role: 'user', content: input.user_message }],
    maxTokens: 512,
  });

  return {
    input,
    finalText: response.text,
    toolCalls: [],
    citations: parseCitations(response.text),
  };
}
