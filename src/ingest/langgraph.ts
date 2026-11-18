// LangGraph messages/events -> AgentTrace.
//
// LangGraph users often have streamed node updates or checkpoint snapshots
// instead of one LangSmith Run object. This adapter reads common message
// shapes from those exports and degrades to an empty trace for unknown input.

import type { AgentInput, AgentTrace, ToolCall } from '../core/trace.js';

type AnyObj = Record<string, unknown>;

function isObject(v: unknown): v is AnyObj {
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

function pick(obj: AnyObj, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function maybeParse(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(t);
    } catch {
      return v;
    }
  }
  return v;
}

function asText(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return v
      .map((part) => {
        if (typeof part === 'string') return part;
        if (isObject(part)) return str(part.text ?? part.content ?? part.value) ?? '';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (isObject(v)) {
    if (isObject(v.kwargs)) return asText(v.kwargs.content);
    return str(v.content ?? v.text ?? v.value) ?? '';
  }
  return '';
}

function serializedRole(msg: AnyObj): string | undefined {
  const direct = str(pick(msg, 'role', 'type'));
  if (direct && direct !== 'constructor') return direct;
  if (Array.isArray(msg.id) && msg.id.length > 0) return str(msg.id[msg.id.length - 1]);
  if (isObject(msg.kwargs)) return str(pick(msg.kwargs, 'role', 'type'));
  return direct;
}

function roleOf(msg: AnyObj): 'user' | 'assistant' | 'tool' | 'system' | undefined {
  const role = serializedRole(msg)?.toLowerCase();
  if (!role) return undefined;
  if (role.includes('human') || role === 'user') return 'user';
  if (role.includes('ai') || role.includes('assistant') || role === 'chat') return 'assistant';
  if (role.includes('tool') || role === 'function') return 'tool';
  if (role.includes('system')) return 'system';
  return undefined;
}

function messageBody(msg: AnyObj): AnyObj {
  return isObject(msg.kwargs) ? msg.kwargs : msg;
}

function toolCallsOf(msg: AnyObj): unknown[] {
  const body = messageBody(msg);
  const direct = pick(body, 'tool_calls', 'toolCalls');
  if (Array.isArray(direct)) return direct;
  if (isObject(body.additional_kwargs)) {
    const nested = pick(body.additional_kwargs, 'tool_calls', 'toolCalls');
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function isRawToolCall(v: AnyObj): boolean {
  const type = str(v.type)?.toLowerCase();
  return (
    (type === 'function' || type === 'tool_call') &&
    v.content === undefined &&
    (isObject(v.function) || v.args !== undefined || v.arguments !== undefined)
  );
}

function isMessage(v: AnyObj): boolean {
  if (isRawToolCall(v)) return false;
  if (roleOf(v)) return true;
  if (toolCallsOf(v).length > 0) return true;
  if (isObject(v.kwargs) && (roleOf(v.kwargs) || toolCallsOf(v.kwargs).length > 0)) return true;
  return false;
}

// Only inspect documented envelopes. Tool arguments and message content are opaque.
function collectMessages(raw: unknown): AnyObj[] {
  const out: AnyObj[] = [];
  const byId = new Map<string, number>();
  const seen = new WeakSet<object>();

  function add(msg: AnyObj): void {
    const id = str(messageBody(msg).id);
    const previous = id ? byId.get(id) : undefined;
    if (previous !== undefined) out[previous] = msg;
    else {
      if (id) byId.set(id, out.length);
      out.push(msg);
    }
  }

  function snapshot(messages: unknown): void {
    if (!Array.isArray(messages)) return;
    const items = messages.filter((m): m is AnyObj => isObject(m) && isMessage(m));
    // Snapshot histories repeat an ordered prefix, including messages without IDs.
    // Compare full messages, not text prefixes or the number of tool calls.
    let shared = 0;
    while (shared < items.length && shared < out.length &&
      JSON.stringify(items[shared]) === JSON.stringify(out[shared])) shared++;
    for (const msg of items.slice(shared)) add(msg);
  }

  function visit(v: unknown, isSnapshot = false): void {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const item of v) visit(item, isSnapshot);
      return;
    }
    if (!isObject(v)) return;
    if (isMessage(v)) { add(v); return; }
    if (typeof v.event === 'string') {
      const data = isObject(v.data) ? v.data : {};
      if (v.event === 'on_tool_end') {
        const output = data.output;
        if (isObject(output) && roleOf(output) === 'tool') add(output);
        else add({ type: 'tool', name: v.name, tool_call_id: data.tool_call_id,
          content: output, input: data.input });
      } else if (v.event === 'on_chat_model_end' || v.event === 'on_llm_end') {
        const output = data.output;
        if (isObject(output) && isMessage(output)) add(output);
        else add({ type: 'ai', content: asText(output) });
      } else if (v.event === 'on_chain_start' && isObject(data.input)) {
        snapshot(data.input.messages);
      }
      return;
    }
    if (Array.isArray(v.messages)) {
      if (isSnapshot) snapshot(v.messages);
      else for (const msg of v.messages) visit(msg);
      return;
    }
    if (Array.isArray(v.checkpoints)) {
      const checkpoints = [...v.checkpoints];
      if (checkpoints.every(c => isObject(c) && typeof c.created_at === 'string')) {
        checkpoints.sort((a, b) => String((a as AnyObj).created_at).localeCompare(String((b as AnyObj).created_at)));
      }
      for (const checkpoint of checkpoints) visit(checkpoint, true);
      return;
    }
    if (isObject(v.values)) { visit(v.values, true); return; }
    if (Array.isArray(v.updates)) { visit(v.updates); return; }
    if (Array.isArray(v.events)) { visit(v.events); return; }
    // Streamed node updates are { nodeName: { messages: [...] } }.
    for (const value of Object.values(v)) {
      if (isObject(value) && Array.isArray(value.messages)) visit(value, isSnapshot);
    }
  }
  visit(raw);
  return out;
}

function argObject(v: unknown): Record<string, unknown> {
  const parsed = maybeParse(v);
  if (isObject(parsed)) return parsed;
  if (parsed === undefined || parsed === null || parsed === '') return {};
  return { value: parsed };
}

function callId(call: AnyObj): string | undefined {
  return str(pick(call, 'id', 'tool_call_id', 'toolCallId'));
}

function toolCallFromRaw(call: unknown): { id?: string; call: ToolCall } | undefined {
  if (!isObject(call)) return undefined;
  const fn = isObject(call.function) ? call.function : undefined;
  const name = str(pick(call, 'name', 'tool')) ?? (fn ? str(fn.name) : undefined) ?? str(call.type);
  if (!name) return undefined;
  return {
    id: callId(call),
    call: {
      name,
      input: argObject(pick(call, 'args', 'arguments', 'input') ?? (fn ? fn.arguments : undefined)),
    },
  };
}

function messageContent(msg: AnyObj): string {
  return asText(messageBody(msg).content);
}

function toolOutput(msg: AnyObj): unknown {
  return maybeParse(messageBody(msg).content);
}

function usageOf(msg: AnyObj): { input: number; output: number } | undefined {
  const body = messageBody(msg);
  const candidates = [
    body.usage_metadata,
    body.usage,
    isObject(body.response_metadata) ? body.response_metadata.token_usage : undefined,
    isObject(body.response_metadata) ? body.response_metadata.usage : undefined,
  ];

  for (const c of candidates) {
    if (!isObject(c)) continue;
    const input = num(pick(c, 'input_tokens', 'prompt_tokens', 'inputTokens', 'promptTokens'));
    const output = num(pick(c, 'output_tokens', 'completion_tokens', 'outputTokens', 'completionTokens'));
    if (input !== undefined || output !== undefined) return { input: input ?? 0, output: output ?? 0 };
  }
  return undefined;
}

function traceFromMessages(messages: AnyObj[]): AgentTrace | undefined {
  if (messages.length === 0) return undefined;

  let userMessage = '';
  let finalText = '';
  let assistantMessages = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let sawTokens = false;
  let error = '';
  const toolCalls: ToolCall[] = [];
  const toolCallIndexById = new Map<string, number>();

  for (const msg of messages) {
    const role = roleOf(msg);
    if (role === 'user') {
      const text = messageContent(msg);
      if (text) userMessage = text;
    }

    if (role === 'assistant') {
      assistantMessages += 1;
      const text = messageContent(msg);
      if (text) finalText = text;
      const usage = usageOf(msg);
      if (usage) {
        tokensIn += usage.input;
        tokensOut += usage.output;
        sawTokens = true;
      }
      for (const rawCall of toolCallsOf(msg)) {
        const parsed = toolCallFromRaw(rawCall);
        if (!parsed) continue;
        toolCalls.push(parsed.call);
        if (parsed.id) toolCallIndexById.set(parsed.id, toolCalls.length - 1);
      }
    }

    if (role === 'tool') {
      const body = messageBody(msg);
      const id = str(pick(body, 'tool_call_id', 'toolCallId', 'id'));
      const output = toolOutput(msg);
      const callIndex = id ? toolCallIndexById.get(id) : undefined;
      const call = callIndex !== undefined ? toolCalls[callIndex] : undefined;
      if (call) {
        call.output = output;
      } else {
        toolCalls.push({ name: str(pick(body, 'name')) ?? 'tool', input: argObject(body.input), output });
      }
    }

    const msgError = pick(messageBody(msg), 'error');
    if (msgError !== undefined && msgError !== null && msgError !== '' && msgError !== false) {
      error = str(msgError) ?? 'message reported an error';
    }
  }

  const input: AgentInput = { user_message: userMessage };
  const trace: AgentTrace = { input, finalText, toolCalls };
  if (assistantMessages > 0) trace.iterations = assistantMessages;
  if (sawTokens) trace.tokens = { input: tokensIn, output: tokensOut };
  if (error) trace.error = error;
  return trace;
}

export function langgraphToTrace(raw: unknown): AgentTrace {
  return traceFromMessages(collectMessages(raw)) ??
    { input: { user_message: '' }, finalText: '', toolCalls: [] };
}
