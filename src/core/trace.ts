// The universal objects every part of AgentEval evaluates over.
//
// AgentTrace is the single data structure produced by running an agent once.
// AgentAdapter is the only integration point a user must implement: it wraps
// any agent (LangGraph, a raw Anthropic/OpenAI loop, an HTTP endpoint, ...) and
// returns an AgentTrace. Everything downstream - assertions, grounding checks,
// the judge, reports - reads this shape and nothing agent-specific.
//
// This is a clean-room generalization of Deminn's internal CapturedRun
// (see core/types.ts `CapturedRun`/`CapturedToolCall`), widened so it does not
// assume a tool-calling loop, a regulated domain, or any storage backend.

/** A single tool / function call the agent made during a run. */
export interface ToolCall {
  /** Tool name as the agent invoked it. */
  name: string;
  /** Arguments the agent passed. Free-form; assertions inspect string fields. */
  input: Record<string, unknown>;
  /** Tool result, if the adapter captured it. */
  output?: unknown;
  /** 1-based loop iteration this call happened on, when known. */
  iteration?: number;
}

/**
 * A citation the agent emitted. All fields optional so adapters can supply
 * whatever they have - a source id, a human-readable source name, the quoted
 * text, and/or the raw inline reference token (e.g. "[E1]", "21 CFR 820.100").
 */
export interface Citation {
  id?: string;
  source?: string;
  quote?: string;
  ref?: string;
}

/** A user-safe reasoning/working step (not a raw tool call). */
export interface AgentStep {
  label: string;
  detail?: string;
  state?: 'active' | 'done' | 'pending' | 'failed';
}

/** Input handed to an agent for one run. `user_message` is required; everything else is open. */
export interface AgentInput {
  user_message: string;
  [key: string]: unknown;
}

/**
 * The result of running an agent once. Produced by an AgentAdapter, consumed by
 * every evaluator in AgentEval. Only `finalText` and `toolCalls` are required;
 * richer fields (citations, steps, tokens, timing) unlock more checks and a
 * fuller audit report when present.
 */
export interface AgentTrace {
  /** The input this run was given. */
  input: AgentInput;
  /** The agent's final text response. */
  finalText: string;
  /** Every tool call made during the run, in order. */
  toolCalls: ToolCall[];
  /** Citations the agent emitted, if any. Required for grounding checks. */
  citations?: Citation[];
  /** User-safe working/reasoning steps, if the adapter exposes them. */
  steps?: AgentStep[];
  /** Number of loop iterations, if the agent runs a loop. */
  iterations?: number;
  /** Token usage for this run, if known. */
  tokens?: { input: number; output: number };
  /** Wall-clock duration in milliseconds, if measured. */
  durationMs?: number;
  /** Set if the run errored. */
  error?: string;
}

/**
 * The one interface a user implements to make their agent evaluable. Wrap any
 * agent so AgentEval can run it and read an AgentTrace back.
 *
 * @example
 * const adapter = defineAdapter({
 *   async run(input) {
 *     const r = await myAgent.invoke(input.user_message);
 *     return { input, finalText: r.text, toolCalls: r.tools ?? [] };
 *   },
 * });
 */
export interface AgentAdapter {
  run(input: AgentInput): Promise<AgentTrace>;
}

/**
 * Identity helper that gives you type-checking and inference when defining an
 * adapter inline. Returns the adapter unchanged.
 */
export function defineAdapter(adapter: AgentAdapter): AgentAdapter {
  return adapter;
}
