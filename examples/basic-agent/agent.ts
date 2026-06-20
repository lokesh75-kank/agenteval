// A tiny, dependency-free example "agent" - NOT Deminn, NOT a real LLM. It
// exists only to demonstrate how AgentEval wraps and evaluates an arbitrary
// agent. Swap this out for your real agent (LangGraph, an Anthropic/OpenAI
// loop, an HTTP endpoint, ...).

import type { AgentTrace, AgentInput } from '@lokeshkank/agenteval';

/**
 * A pretend customer-support agent for a SaaS billing product. It "looks up"
 * a tiny knowledge base and answers with a citation, and refuses anything
 * outside its scope. Deterministic by construction so the example is stable.
 */
export function supportAgent(input: AgentInput): AgentTrace {
  const msg = input.user_message.toLowerCase();

  if (msg.includes('refund')) {
    return {
      input,
      finalText:
        'Refunds are available within 30 days of purchase under our billing policy. [kb:refund-policy]',
      toolCalls: [{ name: 'search_kb', input: { query: 'refund policy' } }],
      citations: [{ ref: 'kb:refund-policy', source: 'kb:refund-policy', quote: 'within 30 days of purchase' }],
    };
  }

  if (msg.includes('password') || msg.includes('login')) {
    return {
      input,
      finalText: 'You can reset your password from the login page using "Forgot password". [kb:account-access]',
      toolCalls: [{ name: 'search_kb', input: { query: 'password reset' } }],
      citations: [{ ref: 'kb:account-access', source: 'kb:account-access', quote: 'Forgot password' }],
    };
  }

  // Out of scope: refuse rather than hallucinate.
  return {
    input,
    finalText: "I can only help with billing and account questions, so I can't answer that one.",
    toolCalls: [],
  };
}
