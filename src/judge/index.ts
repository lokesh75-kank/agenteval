// LLM-as-judge with self-consistency.
//
// A judge grades a single AgentTrace against a free-form rubric. The grading
// prompt hands the judge the rubric, the agent's final text, and a compact
// summary of the tool calls and citations it made, and asks for a strict JSON
// verdict. To reduce the variance of a single sampled judgement we can run the
// judge `votes` times (self-consistency) and pass when the fraction of passing
// votes meets `passThreshold`.
//
// This module is deliberately model-agnostic: it talks only to the `LLMClient`
// interface, so any provider (Anthropic, Google, or a fake in tests) works.

import type { LLMClient } from '../llm/index.js';
import type { AgentTrace, ToolCall, Citation } from '../core/trace.js';

/** Aggregated outcome of running the judge across one or more votes. */
export interface JudgeResult {
  /** True when passingVotes / votes >= passThreshold. */
  pass: boolean;
  /** Total number of votes that were cast (== requested votes). */
  votes: number;
  /** Number of votes whose verdict was a pass. */
  passingVotes: number;
  /** One human-readable rationale per vote, in vote order. */
  rationale: string[];
  /** Mean of any per-vote numeric scores, when the judge supplied them. */
  score?: number;
}

/** Arguments to {@link judge}. */
export interface JudgeArgs {
  /** The trace being graded. */
  trace: AgentTrace;
  /** Free-form grading criteria handed to the judge verbatim. */
  rubric: string;
  /** The model client used to grade. Inject a fake in tests. */
  llm: LLMClient;
  /** How many independent judgements to sample. Default 1. */
  votes?: number;
  /** Fraction of passing votes required to pass overall. Default 0.5. */
  passThreshold?: number;
}

/** The strict shape we ask the judge model to emit. */
interface RawVerdict {
  pass: boolean;
  reason: string;
  score?: number;
}

// The system prompt pins the judge to a strict, machine-readable contract. We
// keep it terse and unambiguous so tolerant parsing rarely has to do real work.
const JUDGE_SYSTEM = [
  'You are a strict, impartial evaluator of an AI agent\'s response.',
  'You are given grading criteria (a rubric), the agent\'s final answer, and a',
  'summary of the tools it called and the citations it produced.',
  'Decide whether the response satisfies the rubric.',
  'Respond with ONLY a single JSON object and nothing else, of the exact form:',
  '{"pass": <true|false>, "reason": "<one concise sentence>", "score": <number 0-1>}',
  'The "score" field is optional but preferred. Do not wrap the JSON in prose or code fences.',
].join('\n');

/**
 * Build the compact, judge-facing summary of a trace. We avoid dumping raw
 * tool outputs (which can be huge and noisy) and instead surface the signal a
 * grader actually needs: which tools ran with what inputs, and what was cited.
 */
function buildTraceSummary(trace: AgentTrace): string {
  const parts: string[] = [];

  parts.push('USER MESSAGE:');
  parts.push(trace.input.user_message || '(none)');

  parts.push('\nAGENT FINAL ANSWER:');
  parts.push(trace.finalText || '(empty)');

  parts.push('\nTOOL CALLS:');
  parts.push(summariseToolCalls(trace.toolCalls));

  parts.push('\nCITATIONS:');
  parts.push(summariseCitations(trace.citations));

  if (trace.error) {
    parts.push('\nAGENT ERROR:');
    parts.push(trace.error);
  }

  return parts.join('\n');
}

function summariseToolCalls(toolCalls: readonly ToolCall[]): string {
  if (toolCalls.length === 0) return '(none)';
  return toolCalls
    .map((tc, i) => {
      // JSON.stringify can throw on circular inputs; degrade gracefully.
      let input: string;
      try {
        input = JSON.stringify(tc.input);
      } catch {
        input = '[unserialisable input]';
      }
      return `${i + 1}. ${tc.name}(${input})`;
    })
    .join('\n');
}

function summariseCitations(citations: readonly Citation[] | undefined): string {
  if (!citations || citations.length === 0) return '(none)';
  return citations
    .map((c, i) => {
      const ref = c.ref ?? c.id ?? '?';
      const src = c.source ? ` <- ${c.source}` : '';
      const quote = c.quote ? ` "${truncate(c.quote, 160)}"` : '';
      return `${i + 1}. ${ref}${src}${quote}`;
    })
    .join('\n');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Compose the full user-turn grading prompt. */
function buildGradingPrompt(trace: AgentTrace, rubric: string): string {
  return [
    'GRADING CRITERIA (RUBRIC):',
    rubric.trim(),
    '',
    '--- BEGIN AGENT TRACE ---',
    buildTraceSummary(trace),
    '--- END AGENT TRACE ---',
    '',
    'Now return your JSON verdict.',
  ].join('\n');
}

/**
 * Tolerantly extract a verdict object from a model reply. Real models wrap JSON
 * in code fences, prefix it with "Here is my verdict:", or append commentary.
 * We (1) strip code fences, (2) try a direct parse, then (3) fall back to
 * scanning for the first balanced `{...}` block and parsing that.
 *
 * Returns `null` when nothing parseable with a boolean `pass` is found.
 */
export function parseVerdict(text: string): RawVerdict | null {
  const candidates: string[] = [];

  const stripped = stripCodeFences(text);
  candidates.push(stripped.trim());

  // Any balanced object substrings, longest first (the verdict is usually the
  // most substantial object in the reply).
  for (const block of extractJsonObjects(stripped)) candidates.push(block);

  for (const candidate of candidates) {
    const verdict = coerceVerdict(candidate);
    if (verdict) return verdict;
  }
  return null;
}

/** Remove ```json ... ``` (or bare ``` ... ```) fences, keeping the body. */
function stripCodeFences(text: string): string {
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/m.exec(text);
  return fence && fence[1] !== undefined ? fence[1] : text;
}

/** Yield every balanced top-level `{...}` block in `text`, longest first. */
function extractJsonObjects(text: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          blocks.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  // Longer blocks are more likely to be the real verdict object.
  return blocks.sort((a, b) => b.length - a.length);
}

/** Parse a candidate string and validate it has at least a boolean `pass`. */
function coerceVerdict(candidate: string): RawVerdict | null {
  let obj: unknown;
  try {
    obj = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null) return null;

  const rec = obj as Record<string, unknown>;
  if (typeof rec['pass'] !== 'boolean') return null;

  const reason = typeof rec['reason'] === 'string' ? rec['reason'] : '';
  const score = typeof rec['score'] === 'number' && Number.isFinite(rec['score'])
    ? rec['score']
    : undefined;

  return { pass: rec['pass'], reason, score };
}

/**
 * Run the judge over a trace with optional self-consistency voting.
 *
 * Each vote is an independent LLM completion of the same grading prompt; with a
 * non-zero temperature the model may disagree with itself, and the majority
 * (or `passThreshold` fraction) wins. Votes whose reply cannot be parsed are
 * counted as non-passing and surfaced in the rationale, so a flaky judge fails
 * closed rather than silently passing.
 */
export async function judge(args: JudgeArgs): Promise<JudgeResult> {
  const { trace, rubric, llm } = args;
  const votes = Math.max(1, Math.floor(args.votes ?? 1));
  const passThreshold = args.passThreshold ?? 0.5;

  const prompt = buildGradingPrompt(trace, rubric);

  // Cast votes in parallel; each is an independent sample of the same prompt.
  const replies = await Promise.all(
    Array.from({ length: votes }, () =>
      llm.complete({
        system: JUDGE_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
        // Light sampling so repeated votes can actually diverge; callers can
        // wrap an llm with their own settings if they want determinism.
        temperature: 0.3,
      }),
    ),
  );

  const rationale: string[] = [];
  const scores: number[] = [];
  let passingVotes = 0;

  for (const reply of replies) {
    const verdict = parseVerdict(reply.text);
    if (!verdict) {
      rationale.push('unparseable judge response (counted as fail)');
      continue;
    }
    if (verdict.pass) passingVotes++;
    if (verdict.score !== undefined) scores.push(verdict.score);
    rationale.push(verdict.reason || (verdict.pass ? 'pass' : 'fail'));
  }

  const pass = votes > 0 && passingVotes / votes >= passThreshold;
  const score = scores.length > 0
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : undefined;

  const result: JudgeResult = { pass, votes, passingVotes, rationale };
  if (score !== undefined) result.score = score;
  return result;
}
