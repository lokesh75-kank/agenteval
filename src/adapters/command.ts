// The command adapter: run any agent, in any language, as a subprocess.
//
// Protocol (one process per run, no long-lived server to manage):
//   stdin  <- AgentInput as a single JSON object
//   stdout -> AgentTrace as a single JSON object
//   stderr -> passed through for the user's own logging
//   exit 0 -> stdout is parsed; non-zero -> the run errors with stderr attached
//
// This is the language-agnostic seam: a Python (or Go, or shell) agent only
// has to read JSON and print JSON. The Python package (`pip install agenteval`)
// ships an @adapter decorator that speaks this protocol.

import { spawn } from 'node:child_process';

import { defineAdapter, type AgentAdapter, type AgentInput, type AgentTrace } from '../core/trace.js';

export interface CommandAdapterSpec {
  /** Executable to run, e.g. "python". */
  command: string;
  /** Arguments, e.g. ["my_agent.py"]. */
  args?: string[];
  /** Working directory for the subprocess (default: process.cwd()). */
  cwd?: string;
  /** Extra environment variables merged over process.env. */
  env?: Record<string, string>;
  /** Kill the subprocess after this many ms (default 120000). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** A config `adapter:` value that requests a subprocess rather than JS code. */
export function isCommandSpec(value: unknown): value is CommandAdapterSpec {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CommandAdapterSpec).command === 'string' &&
    typeof (value as { run?: unknown }).run !== 'function'
  );
}

/**
 * Wrap a subprocess command as an AgentAdapter. Each run spawns the command,
 * writes the AgentInput to stdin as JSON, and parses an AgentTrace from stdout.
 */
export function commandAdapter(spec: CommandAdapterSpec): AgentAdapter {
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return defineAdapter({
    run(input: AgentInput): Promise<AgentTrace> {
      return new Promise((resolvePromise) => {
        const child = spawn(spec.command, spec.args ?? [], {
          cwd: spec.cwd,
          env: spec.env ? { ...process.env, ...spec.env } : process.env,
          stdio: ['pipe', 'pipe', 'inherit'],
        });

        let stdout = '';
        let settled = false;
        const settle = (trace: AgentTrace) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolvePromise(trace);
        };
        // The runner treats `error` on a trace as a failed run; never reject.
        const fail = (message: string) =>
          settle({ input, finalText: '', toolCalls: [], error: message });

        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          fail(`command adapter: timed out after ${timeoutMs}ms: ${spec.command}`);
        }, timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
        child.on('error', (err) => fail(`command adapter: failed to spawn "${spec.command}": ${err.message}`));
        child.on('close', (code) => {
          if (settled) return;
          if (code !== 0) {
            fail(`command adapter: "${spec.command}" exited with code ${code}`);
            return;
          }
          try {
            const parsed = JSON.parse(stdout) as Partial<AgentTrace>;
            if (typeof parsed.finalText !== 'string') {
              fail('command adapter: stdout JSON is missing required string field "finalText"');
              return;
            }
            settle({
              ...parsed,
              input: parsed.input ?? input,
              finalText: parsed.finalText,
              toolCalls: Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [],
            });
          } catch {
            fail(
              `command adapter: stdout was not valid JSON (write logs to stderr, the AgentTrace JSON to stdout)`,
            );
          }
        });

        // A child that failed to spawn (or exited early) can error its stdin
        // stream; without a handler that would crash the whole process.
        child.stdin.on('error', () => {});
        child.stdin.write(JSON.stringify(input));
        child.stdin.end();
      });
    },
  });
}
