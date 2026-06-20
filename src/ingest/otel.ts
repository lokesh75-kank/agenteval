// OpenTelemetry GenAI -> AgentTrace.
//
// This adapter lets users evaluate traces they *already* collect from
// OpenTelemetry-instrumented agents (OpenLLMetry, OpenInference, the GenAI
// semantic conventions, etc.) without re-running anything. It is a pure,
// defensive transform: any unknown / partial shape degrades to a best-effort
// AgentTrace rather than throwing.
//
// ── Attribute assumptions (OpenTelemetry GenAI semantic conventions) ──
// We read the following span attributes, tolerating both the dotted-string and
// the (rarer) nested-object encodings exporters use:
//
//   gen_ai.system                  -> informational (e.g. "anthropic")
//   gen_ai.operation.name          -> "chat" / "execute_tool" / ...
//   gen_ai.prompt / gen_ai.prompt.N.{role,content}        -> input messages
//   gen_ai.completion / gen_ai.completion.N.content        -> final text
//   gen_ai.usage.input_tokens  (a.k.a. prompt_tokens)      -> tokens.input
//   gen_ai.usage.output_tokens (a.k.a. completion_tokens)  -> tokens.output
//   gen_ai.tool.name               -> a tool call's name (on execute_tool spans)
//   gen_ai.tool.input / .arguments -> a tool call's input
//   gen_ai.tool.output / .result   -> a tool call's output
//
// Span shape: we accept the common exporter shapes. A span may expose its
// attributes as `span.attributes` (object) or as OTLP-style
// `{ key, value: { stringValue | intValue | ... } }` arrays. Children may be
// nested under `children` / `child_spans` / `spans`, or the whole input may be
// a flat array of spans that we re-nest by parentSpanId.
//
// Timing: `durationMs` is taken from explicit duration fields when present,
// otherwise computed from start/end timestamps (nanos, micros, millis, or ISO
// strings are all handled).

import type { AgentTrace, AgentInput, ToolCall } from '../core/trace.js';

/** A loosely-typed span. We never assume a field exists; everything is probed. */
type AnySpan = Record<string, unknown>;

/** Safe object guard. */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Flatten an OTLP attribute value (`{ stringValue }`, `{ intValue }`, ...) or
 * return primitives/objects as-is. Returns `undefined` for unrepresentable
 * values so callers can fall through to other sources.
 */
function unwrapAttrValue(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  // OTLP AnyValue encodings.
  if ('stringValue' in o) return o.stringValue;
  if ('intValue' in o) return typeof o.intValue === 'string' ? Number(o.intValue) : o.intValue;
  if ('doubleValue' in o) return o.doubleValue;
  if ('boolValue' in o) return o.boolValue;
  if ('arrayValue' in o && isObject(o.arrayValue) && Array.isArray(o.arrayValue.values)) {
    return o.arrayValue.values.map(unwrapAttrValue);
  }
  if ('kvlistValue' in o && isObject(o.kvlistValue) && Array.isArray(o.kvlistValue.values)) {
    const out: Record<string, unknown> = {};
    for (const kv of o.kvlistValue.values) {
      if (isObject(kv) && typeof kv.key === 'string') out[kv.key] = unwrapAttrValue(kv.value);
    }
    return out;
  }
  return v;
}

/**
 * Build a flat `Record<string, unknown>` of a span's attributes regardless of
 * whether they came as a plain object map or an OTLP `[{key,value}]` array.
 */
function readAttributes(span: AnySpan): Record<string, unknown> {
  const raw = span.attributes ?? span.attr ?? span.tags;
  const out: Record<string, unknown> = {};
  if (Array.isArray(raw)) {
    for (const kv of raw) {
      if (isObject(kv) && typeof kv.key === 'string') out[kv.key] = unwrapAttrValue(kv.value);
    }
  } else if (isObject(raw)) {
    for (const [k, v] of Object.entries(raw)) out[k] = unwrapAttrValue(v);
  }
  return out;
}

/** First attribute value matching any of `keys`, unwrapped. */
function pick(attrs: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (k in attrs && attrs[k] !== undefined && attrs[k] !== null) return attrs[k];
  }
  return undefined;
}

/** Coerce to a finite number or undefined. */
function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Coerce to a non-empty trimmed string or undefined. */
function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

/** Best-effort JSON-parse a string; otherwise return the value unchanged. */
function maybeParse(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(t);
    } catch {
      /* leave as string */
    }
  }
  return v;
}

/** Stringify a value for textual fields (prompt/completion content). */
function asText(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  // GenAI message content is sometimes a list of content parts.
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
  if (isObject(v)) return str(v.text ?? v.content ?? v.value) ?? JSON.stringify(v);
  return String(v);
}

/** A span's name (operation), tolerant of field naming. */
function spanName(span: AnySpan): string {
  return str(span.name ?? span.spanName ?? span.operationName) ?? '';
}

/** A span's id, tolerant of OTLP camel/snake casing. */
function spanId(span: AnySpan): string | undefined {
  return str(span.spanId ?? span.span_id ?? span.id);
}

/** A span's parent id, tolerant of OTLP camel/snake casing. */
function parentId(span: AnySpan): string | undefined {
  return str(span.parentSpanId ?? span.parent_span_id ?? span.parentId ?? span.parent_id);
}

/** Direct children, if the input is already a nested tree. */
function childrenOf(span: AnySpan): AnySpan[] {
  const c = span.children ?? span.child_spans ?? span.childSpans ?? span.spans;
  return Array.isArray(c) ? (c.filter(isObject) as AnySpan[]) : [];
}

/**
 * Convert a timestamp expressed as ns / µs / ms (number) or ISO string into ms.
 * OTLP `*UnixNano` fields are nanoseconds; we detect magnitude heuristically.
 */
function toMillis(v: unknown): number | undefined {
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  const n = num(v);
  if (n === undefined) return undefined;
  // Heuristic by magnitude (year-2001+ epochs): ns ~1e18, µs ~1e15, ms ~1e12, s ~1e9.
  if (n >= 1e17) return n / 1e6; // nanoseconds
  if (n >= 1e14) return n / 1e3; // microseconds
  return n; // already ms (or a small relative duration)
}

/** Compute durationMs from explicit fields or start/end timestamps. */
function durationMs(span: AnySpan, attrs: Record<string, unknown>): number | undefined {
  const explicit = num(pick(attrs, 'duration_ms', 'durationMs')) ?? num(span.durationMs);
  if (explicit !== undefined) return explicit;
  const start = toMillis(span.startTimeUnixNano ?? span.startTime ?? span.start_time ?? span.start);
  const end = toMillis(span.endTimeUnixNano ?? span.endTime ?? span.end_time ?? span.end);
  if (start !== undefined && end !== undefined && end >= start) return end - start;
  const durNano = num(span.duration); // some exporters emit raw nano duration
  if (durNano !== undefined && durNano >= 1e6) return durNano / 1e6;
  return undefined;
}

/** True if this span looks like a tool / function-execution span. */
function isToolSpan(span: AnySpan, attrs: Record<string, unknown>): boolean {
  const op = str(pick(attrs, 'gen_ai.operation.name'))?.toLowerCase();
  if (op === 'execute_tool' || op === 'tool') return true;
  if (pick(attrs, 'gen_ai.tool.name', 'tool.name', 'gen_ai.tool.call.id') !== undefined) return true;
  const name = spanName(span).toLowerCase();
  return name.startsWith('execute_tool') || name.startsWith('tool.') || name.startsWith('gen_ai.tool');
}

/** Extract a ToolCall from a tool span (caller has already classified it). */
function toolCallFromSpan(span: AnySpan, attrs: Record<string, unknown>, iteration?: number): ToolCall {
  const name =
    (str(pick(attrs, 'gen_ai.tool.name', 'tool.name', 'tool')) ??
      // span name like "execute_tool search" -> "search"
      spanName(span).replace(/^execute_tool[.\s]*/i, '').replace(/^(gen_ai\.)?tool[.\s]*/i, '')) ||
    'tool';

  const inputRaw = maybeParse(
    pick(attrs, 'gen_ai.tool.input', 'gen_ai.tool.arguments', 'tool.input', 'tool.arguments', 'input'),
  );
  const input: Record<string, unknown> = isObject(inputRaw)
    ? inputRaw
    : inputRaw === undefined
      ? {}
      : { value: inputRaw };

  const outputRaw = maybeParse(
    pick(attrs, 'gen_ai.tool.output', 'gen_ai.tool.result', 'tool.output', 'tool.result', 'output'),
  );

  const call: ToolCall = { name, input };
  if (outputRaw !== undefined) call.output = outputRaw;
  if (iteration !== undefined) call.iteration = iteration;
  return call;
}

/**
 * Pull the user message out of prompt attributes. Supports both the indexed
 * encoding (`gen_ai.prompt.0.role` / `.content`) and a single `gen_ai.prompt`
 * blob (string or array of {role,content}). Prefers the last `user` role.
 */
function extractUserMessage(attrs: Record<string, unknown>): string {
  // Indexed: gen_ai.prompt.<n>.role / gen_ai.prompt.<n>.content
  const indexed: { role?: string; content: string; idx: number }[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    const m = /^gen_ai\.prompt\.(\d+)\.content$/.exec(k);
    if (m) {
      const idx = Number(m[1]);
      const role = str(attrs[`gen_ai.prompt.${idx}.role`]);
      indexed.push({ role, content: asText(v), idx });
    }
  }
  if (indexed.length > 0) {
    indexed.sort((a, b) => a.idx - b.idx);
    const users = indexed.filter((m) => m.role?.toLowerCase() === 'user');
    const chosen = users.length > 0 ? users[users.length - 1] : indexed[indexed.length - 1];
    if (chosen) return chosen.content;
  }

  // Single blob.
  const blob = maybeParse(pick(attrs, 'gen_ai.prompt', 'gen_ai.input.messages', 'llm.prompts', 'prompt'));
  if (Array.isArray(blob)) {
    const msgs = blob.filter(isObject);
    const users = msgs.filter((m) => str(m.role)?.toLowerCase() === 'user');
    const chosen = users.length > 0 ? users[users.length - 1] : msgs[msgs.length - 1];
    if (chosen) return asText(chosen.content ?? chosen.text);
  }
  return asText(blob);
}

/**
 * Pull the final assistant text out of completion attributes. Supports indexed
 * (`gen_ai.completion.0.content`) and single-blob encodings.
 */
function extractCompletion(attrs: Record<string, unknown>): string {
  const indexed: { content: string; idx: number }[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    const m = /^gen_ai\.completion\.(\d+)\.content$/.exec(k);
    if (m) indexed.push({ content: asText(v), idx: Number(m[1]) });
  }
  if (indexed.length > 0) {
    indexed.sort((a, b) => a.idx - b.idx);
    const last = indexed[indexed.length - 1];
    if (last) return last.content;
  }
  const blob = maybeParse(
    pick(attrs, 'gen_ai.completion', 'gen_ai.output.messages', 'llm.completions', 'completion', 'output'),
  );
  if (Array.isArray(blob)) {
    const msgs = blob.filter(isObject);
    const last = msgs[msgs.length - 1];
    if (last) return asText(last.content ?? last.text);
  }
  return asText(blob);
}

/** Read input/output token usage from any of the conventional attribute names. */
function extractTokens(attrs: Record<string, unknown>): { input: number; output: number } | undefined {
  const input = num(pick(attrs, 'gen_ai.usage.input_tokens', 'gen_ai.usage.prompt_tokens', 'llm.usage.prompt_tokens'));
  const output = num(
    pick(attrs, 'gen_ai.usage.output_tokens', 'gen_ai.usage.completion_tokens', 'llm.usage.completion_tokens'),
  );
  if (input === undefined && output === undefined) return undefined;
  return { input: input ?? 0, output: output ?? 0 };
}

/**
 * Re-nest a flat list of spans into roots + descendants using parentSpanId.
 * Spans whose parent is absent from the set are treated as roots. If no ids are
 * present at all, every span is treated as a root (order preserved).
 */
function nestSpans(spans: AnySpan[]): AnySpan[] {
  const byId = new Map<string, AnySpan>();
  for (const s of spans) {
    const id = spanId(s);
    if (id) byId.set(id, s);
  }
  if (byId.size === 0) return spans;

  const roots: AnySpan[] = [];
  const kids = new Map<string, AnySpan[]>();
  for (const s of spans) {
    const p = parentId(s);
    if (p && byId.has(p)) {
      const arr = kids.get(p) ?? [];
      arr.push(s);
      kids.set(p, arr);
    } else {
      roots.push(s);
    }
  }
  // Attach synthetic children so the recursive walker finds them uniformly.
  for (const s of spans) {
    const id = spanId(s);
    if (id && kids.has(id)) {
      const existing = childrenOf(s);
      (s as AnySpan).children = [...existing, ...(kids.get(id) ?? [])];
    }
  }
  return roots;
}

/** Recursively collect spans depth-first (parent before children). */
function flatten(span: AnySpan, acc: AnySpan[]): void {
  acc.push(span);
  for (const child of childrenOf(span)) flatten(child, acc);
}

/**
 * Map OpenTelemetry GenAI spans to an AgentTrace.
 *
 * Accepts: a single root span (with nested children), an array of spans (flat
 * or nested — flat lists are re-nested by parentSpanId), or an OTLP-ish wrapper
 * object exposing `spans` / `resourceSpans`. Unknown shapes degrade to an empty
 * best-effort trace rather than throwing.
 */
export function otelToTrace(spans: unknown): AgentTrace {
  // Normalize input into a list of root spans.
  let roots: AnySpan[] = [];
  if (Array.isArray(spans)) {
    roots = nestSpans(spans.filter(isObject) as AnySpan[]);
  } else if (isObject(spans)) {
    // OTLP wrapper: { resourceSpans: [{ scopeSpans: [{ spans: [...] }] }] }
    const collected: AnySpan[] = [];
    const resourceSpans = spans.resourceSpans ?? spans.resource_spans;
    if (Array.isArray(resourceSpans)) {
      for (const rs of resourceSpans) {
        if (!isObject(rs)) continue;
        const scopeSpans = rs.scopeSpans ?? rs.scope_spans ?? rs.instrumentationLibrarySpans;
        if (Array.isArray(scopeSpans)) {
          for (const ss of scopeSpans) {
            if (isObject(ss) && Array.isArray(ss.spans)) collected.push(...(ss.spans.filter(isObject) as AnySpan[]));
          }
        }
      }
    }
    if (collected.length > 0) {
      roots = nestSpans(collected);
    } else if (Array.isArray(spans.spans)) {
      roots = nestSpans(spans.spans.filter(isObject) as AnySpan[]);
    } else {
      // Treat the object itself as a single root span.
      roots = [spans];
    }
  } else {
    // Unrepresentable input.
    return { input: { user_message: '' }, finalText: '', toolCalls: [] };
  }

  // Depth-first flatten so we can classify every span uniformly.
  const all: AnySpan[] = [];
  for (const r of roots) flatten(r, all);

  let userMessage = '';
  let finalText = '';
  let tokensIn = 0;
  let tokensOut = 0;
  let sawTokens = false;
  const toolCalls: ToolCall[] = [];
  let llmSpanCount = 0; // proxy for loop iterations

  for (const span of all) {
    const attrs = readAttributes(span);

    if (isToolSpan(span, attrs)) {
      // Tools belong to the current iteration (number of LLM turns so far).
      toolCalls.push(toolCallFromSpan(span, attrs, llmSpanCount || undefined));
      continue;
    }

    // Otherwise treat as a (possibly) generation span and harvest prompt/completion/usage.
    const op = str(pick(attrs, 'gen_ai.operation.name'))?.toLowerCase();
    const hasGen =
      op === 'chat' ||
      op === 'text_completion' ||
      op === 'generate_content' ||
      Object.keys(attrs).some((k) => k.startsWith('gen_ai.prompt') || k.startsWith('gen_ai.completion'));

    if (hasGen) llmSpanCount += 1;

    const um = extractUserMessage(attrs);
    if (um && !userMessage) userMessage = um; // first user message wins (root prompt)

    const comp = extractCompletion(attrs);
    if (comp) finalText = comp; // last non-empty completion wins (final answer)

    const tok = extractTokens(attrs);
    if (tok) {
      tokensIn += tok.input;
      tokensOut += tok.output;
      sawTokens = true;
    }
  }

  // Root-level duration (or the widest span we can find).
  let dur: number | undefined;
  for (const r of roots) {
    const d = durationMs(r, readAttributes(r));
    if (d !== undefined && (dur === undefined || d > dur)) dur = d;
  }

  // Root-level error status, if any.
  let error: string | undefined;
  for (const span of all) {
    const status = span.status;
    if (isObject(status)) {
      const code = str(status.code ?? status.statusCode);
      const msg = str(status.message);
      if (code === 'ERROR' || code === '2' || num(code) === 2) {
        error = msg ?? 'span reported ERROR status';
        break;
      }
    }
  }

  const input: AgentInput = { user_message: userMessage };
  const trace: AgentTrace = { input, finalText, toolCalls };
  if (sawTokens) trace.tokens = { input: tokensIn, output: tokensOut };
  if (dur !== undefined) trace.durationMs = dur;
  if (llmSpanCount > 0) trace.iterations = llmSpanCount;
  if (error) trace.error = error;
  return trace;
}
