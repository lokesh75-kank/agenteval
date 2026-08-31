// The replay adapter: evaluate traces you already collected instead of
// re-running the agent. Formalizes the pattern from
// case-studies/aaro-property-tax/evaluate.ts as a first-class adapter, and
// powers `agenteval eval --traces`.
//
// Matching: a scenario's runs replay the recorded traces whose
// input.user_message equals the scenario's user_message, in file order.

import { defineAdapter, type AgentAdapter, type AgentInput, type AgentTrace } from '../core/trace.js';

/** Traces grouped by user_message, each with a cursor for sequential replay. */
export function replayAdapter(traces: AgentTrace[]): AgentAdapter {
  const byMessage = new Map<string, { traces: AgentTrace[]; next: number }>();
  for (const trace of traces) {
    const key = trace.input?.user_message ?? '';
    const group = byMessage.get(key) ?? { traces: [], next: 0 };
    group.traces.push(trace);
    byMessage.set(key, group);
  }
  return defineAdapter({
    async run(input: AgentInput): Promise<AgentTrace> {
      const group = byMessage.get(input.user_message);
      if (!group || group.traces.length === 0) {
        return {
          input,
          finalText: '',
          toolCalls: [],
          error: `replay: no recorded trace matches user_message ${JSON.stringify(input.user_message)}`,
        };
      }
      // Cycle if asked for more runs than there are recorded traces.
      const trace = group.traces[group.next % group.traces.length]!;
      group.next += 1;
      return trace;
    },
  });
}

/** How many recorded traces match a scenario's user_message (its natural run count). */
export function replayRunCount(traces: AgentTrace[], userMessage: string): number {
  return traces.filter((t) => t.input?.user_message === userMessage).length;
}
