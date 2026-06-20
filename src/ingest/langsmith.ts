// LangSmith Run -> AgentTrace.
//
// LangChain/LangGraph users already capture rich Run trees in LangSmith. This
// transform lets them feed an exported Run straight into AgentEval. Like the
// OTel mapper it is pure and defensive: partial / unknown shapes degrade to a
// best-effort AgentTrace rather than throwing.
//
// ── LangSmith Run shape assumptions ──
// A Run has (camelCase or snake_case, we accept both):
//   run_type        "chain" | "llm" | "tool" | "prompt" | ...
//   name            human label
//   inputs          object — we look for messages / input / question / a
//                   user-typed string; for tool runs this is the tool args
//   outputs         object — we look for generations / output / a final string;
//                   for tool runs this is the tool result
//   child_runs      nested Run[] (a tool run is run_type === "tool")
//   start_time / end_time   ISO strings (or ms) -> durationMs
//   error           non-null marks the run as errored
//   extra.metadata / outputs.llm_output.token_usage / usage_metadata -> tokens
//
// Token usage in LangSmith lives in several places depending on integration
// version; we probe all the common ones and sum across LLM child runs.

import type { AgentTrace, AgentInput, ToolCall } from '../core/trace.js';

type AnyRun = Record<string, unknown>;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** First present, non-null property among `keys`. */
function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (k in obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function runType(run: AnyRun): string {
  return (str(pick(run, 'run_type', 'runType')) ?? '').toLowerCase();
}

function childRunsOf(run: AnyRun): AnyRun[] {
  const c = pick(run, 'child_runs', 'childRuns', 'children');
  return Array.isArray(c) ? (c.filter(isObject) as AnyRun[]) : [];
}

/** Render arbitrary message/content into text. Handles LangChain message dicts. */
function asText(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return v
      .map((part) => {
        if (typeof part === 'string') return part;
        if (isObject(part)) {
          // LangChain content blocks: { type:"text", text:"..." }
          return (
            str(part.text) ??
            str(part.content) ??
            // serialized message: { kwargs: { content } } or { data: { content } }
            (isObject(part.kwargs) ? str(part.kwargs.content) : undefined) ??
            (isObject(part.data) ? str(part.data.content) : undefined) ??
            ''
          );
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (isObject(v)) {
    // LangChain serialized message object.
    if (isObject(v.kwargs)) return asText(v.kwargs.content);
    if (isObject(v.data)) return asText(v.data.content);
    return str(v.content ?? v.text ?? v.value) ?? '';
  }
  return '';
}

/**
 * Extract the user message from a run's `inputs`. Tries, in order: a `messages`
 * list (last human/user message), then common single-field names, then any
 * string value in the object.
 */
function extractUserMessage(inputs: unknown): string {
  if (typeof inputs === 'string') return inputs;
  if (!isObject(inputs)) return '';

  const messages = pick(inputs, 'messages', 'chat_history', 'history');
  if (Array.isArray(messages)) {
    const msgs = messages.filter((m) => typeof m === 'string' || isObject(m));
    // Find the last human/user message.
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (isObject(m)) {
        const role = str(m.role ?? m.type) ?? (isObject(m.kwargs) ? '' : '');
        const r = role.toLowerCase();
        if (r === 'user' || r === 'human' || r === 'humanmessage') return asText(m);
      }
    }
    // Fall back to the last message of any role.
    const last = msgs[msgs.length - 1];
    if (last !== undefined) return asText(last);
  }

  const direct = pick(inputs, 'input', 'question', 'query', 'user_message', 'prompt', 'text');
  if (direct !== undefined) return asText(direct);

  // Last resort: first string-valued field.
  for (const v of Object.values(inputs)) {
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return '';
}

/**
 * Extract the final assistant text from a run's `outputs`. Handles LangChain
 * `generations[][].text` / `.message`, common single-field names, and strings.
 */
function extractFinalText(outputs: unknown): string {
  if (typeof outputs === 'string') return outputs;
  if (!isObject(outputs)) return '';

  // LangChain LLMResult: { generations: [[ { text, message } ]] }
  const gens = pick(outputs, 'generations');
  if (Array.isArray(gens)) {
    // Flatten one level if it's a list of lists.
    const flat: unknown[] = gens.flatMap((g) => (Array.isArray(g) ? g : [g]));
    const last = flat[flat.length - 1];
    if (isObject(last)) {
      const t = str(last.text) ?? asText(last.message);
      if (t) return t;
    }
  }

  const direct = pick(outputs, 'output', 'answer', 'result', 'text', 'content', 'final', 'response');
  if (direct !== undefined) {
    const t = asText(direct);
    if (t) return t;
  }

  // Some agents return { messages: [...] } as output.
  const messages = pick(outputs, 'messages');
  if (Array.isArray(messages) && messages.length > 0) {
    return asText(messages[messages.length - 1]);
  }

  // Last resort: first string-valued field.
  for (const v of Object.values(outputs)) {
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return '';
}

/**
 * Probe the many places LangChain integrations stash token usage and return
 * {input, output} if anything is found.
 */
function extractTokens(run: AnyRun): { input: number; output: number } | undefined {
  const candidates: Array<Record<string, unknown> | undefined> = [];

  const outputs = run.outputs;
  if (isObject(outputs)) {
    if (isObject(outputs.llm_output) && isObject(outputs.llm_output.token_usage)) {
      candidates.push(outputs.llm_output.token_usage as Record<string, unknown>);
    }
    if (isObject(outputs.usage_metadata)) candidates.push(outputs.usage_metadata as Record<string, unknown>);
    if (isObject(outputs.usage)) candidates.push(outputs.usage as Record<string, unknown>);
  }
  const extra = run.extra;
  if (isObject(extra)) {
    if (isObject(extra.usage_metadata)) candidates.push(extra.usage_metadata as Record<string, unknown>);
    if (isObject(extra.metadata) && isObject((extra.metadata as Record<string, unknown>).usage)) {
      candidates.push((extra.metadata as Record<string, unknown>).usage as Record<string, unknown>);
    }
  }
  if (isObject(run.usage_metadata)) candidates.push(run.usage_metadata as Record<string, unknown>);

  for (const c of candidates) {
    if (!c) continue;
    const input = num(pick(c, 'input_tokens', 'prompt_tokens', 'inputTokens', 'promptTokens'));
    const output = num(pick(c, 'output_tokens', 'completion_tokens', 'outputTokens', 'completionTokens'));
    if (input !== undefined || output !== undefined) {
      return { input: input ?? 0, output: output ?? 0 };
    }
  }
  return undefined;
}

/** durationMs from start/end times (ISO strings or ms numbers). */
function durationMs(run: AnyRun): number | undefined {
  const toMs = (v: unknown): number | undefined => {
    if (typeof v === 'string') {
      const t = Date.parse(v);
      return Number.isNaN(t) ? undefined : t;
    }
    return num(v);
  };
  const start = toMs(pick(run, 'start_time', 'startTime'));
  const end = toMs(pick(run, 'end_time', 'endTime'));
  if (start !== undefined && end !== undefined && end >= start) return end - start;
  return undefined;
}

/** Build a ToolCall from a tool-type child run. */
function toolCallFromRun(run: AnyRun): ToolCall {
  const name = str(pick(run, 'name')) ?? 'tool';
  const inputsRaw = run.inputs;
  let input: Record<string, unknown>;
  if (isObject(inputsRaw)) {
    input = inputsRaw;
  } else if (inputsRaw === undefined || inputsRaw === null) {
    input = {};
  } else {
    input = { value: inputsRaw };
  }
  const call: ToolCall = { name, input };

  const outputs = run.outputs;
  if (outputs !== undefined && outputs !== null) {
    // Unwrap the common { output: ... } envelope for readability.
    call.output = isObject(outputs) && 'output' in outputs ? outputs.output : outputs;
  }
  return call;
}

/**
 * Walk the run tree depth-first, collecting tool calls (run_type === "tool"),
 * summing token usage across LLM runs, and counting LLM runs as a proxy for
 * loop iterations. Mutates the accumulators in place.
 */
function walk(
  run: AnyRun,
  acc: {
    toolCalls: ToolCall[];
    tokensIn: number;
    tokensOut: number;
    sawTokens: boolean;
    llmRuns: number;
    finalText: string;
  },
): void {
  const type = runType(run);

  if (type === 'tool') {
    acc.toolCalls.push(toolCallFromRun(run));
  } else {
    if (type === 'llm' || type === 'chat_model') acc.llmRuns += 1;
    const tok = extractTokens(run);
    if (tok) {
      acc.tokensIn += tok.input;
      acc.tokensOut += tok.output;
      acc.sawTokens = true;
    }
    // The last non-empty LLM/chain output we encounter (depth-first) is the
    // best candidate for the final answer when the root output is empty.
    if (type === 'llm' || type === 'chat_model' || type === 'chain') {
      const t = extractFinalText(run.outputs);
      if (t) acc.finalText = t;
    }
  }

  for (const child of childRunsOf(run)) walk(child, acc);
}

/**
 * Map a LangSmith Run object to an AgentTrace.
 *
 * Accepts a single root Run (with `child_runs`). Unknown / non-object input
 * degrades to an empty best-effort trace.
 */
export function langsmithToTrace(run: unknown): AgentTrace {
  if (!isObject(run)) {
    return { input: { user_message: '' }, finalText: '', toolCalls: [] };
  }

  const userMessage = extractUserMessage(run.inputs);

  const acc = {
    toolCalls: [] as ToolCall[],
    tokensIn: 0,
    tokensOut: 0,
    sawTokens: false,
    llmRuns: 0,
    finalText: '',
  };
  walk(run, acc);

  // Prefer the root run's own outputs for the final answer; fall back to the
  // deepest LLM/chain text collected during the walk.
  const rootFinal = extractFinalText(run.outputs);
  const finalText = rootFinal || acc.finalText;

  const input: AgentInput = { user_message: userMessage };
  const trace: AgentTrace = { input, finalText, toolCalls: acc.toolCalls };

  if (acc.sawTokens) trace.tokens = { input: acc.tokensIn, output: acc.tokensOut };

  const dur = durationMs(run);
  if (dur !== undefined) trace.durationMs = dur;

  if (acc.llmRuns > 0) trace.iterations = acc.llmRuns;

  const err = run.error;
  if (err !== undefined && err !== null && err !== '' && err !== false) {
    trace.error = str(err) ?? 'run reported an error';
  }

  return trace;
}
