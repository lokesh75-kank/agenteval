import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { commandAdapter, isCommandSpec } from './command.js';
import { replayAdapter, replayRunCount } from './replay.js';
import type { AgentTrace } from '../core/trace.js';

// A cross-platform subprocess agent: node -e reads stdin JSON, echoes a trace.
const ECHO_AGENT = `
let data = '';
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  const input = JSON.parse(data);
  process.stdout.write(JSON.stringify({
    input,
    finalText: 'echo: ' + input.user_message,
    toolCalls: [{ name: 'echo', input: { message: input.user_message } }],
  }));
});
`;

describe('commandAdapter', () => {
  it('spawns the command, sends input on stdin, parses the trace from stdout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agenteval-cmd-'));
    const script = join(dir, 'agent.mjs');
    writeFileSync(script, ECHO_AGENT);

    const adapter = commandAdapter({ command: process.execPath, args: [script] });
    const trace = await adapter.run({ user_message: 'hello' });
    expect(trace.error).toBeUndefined();
    expect(trace.finalText).toBe('echo: hello');
    expect(trace.toolCalls).toEqual([{ name: 'echo', input: { message: 'hello' } }]);
    expect(trace.input.user_message).toBe('hello');
  });

  it('returns an errored trace (not a rejection) when the command fails', async () => {
    const adapter = commandAdapter({ command: process.execPath, args: ['-e', 'process.exit(3)'] });
    const trace = await adapter.run({ user_message: 'x' });
    expect(trace.error).toMatch(/exited with code 3/);
  });

  it('returns an errored trace when stdout is not valid trace JSON', async () => {
    const adapter = commandAdapter({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("not json")'],
    });
    const trace = await adapter.run({ user_message: 'x' });
    expect(trace.error).toMatch(/not valid JSON/);
  });

  it('returns an errored trace when the command cannot be spawned', async () => {
    const adapter = commandAdapter({ command: '/nonexistent/agent-binary' });
    const trace = await adapter.run({ user_message: 'x' });
    expect(trace.error).toMatch(/failed to spawn/);
  });

  it('times out a hung command', async () => {
    const adapter = commandAdapter({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      timeoutMs: 300,
    });
    const trace = await adapter.run({ user_message: 'x' });
    expect(trace.error).toMatch(/timed out/);
  });
});

describe('isCommandSpec', () => {
  it('accepts { command } and rejects { run }', () => {
    expect(isCommandSpec({ command: 'python3', args: ['agent.py'] })).toBe(true);
    expect(isCommandSpec({ run: async () => ({}) })).toBe(false);
    expect(isCommandSpec(undefined)).toBe(false);
    expect(isCommandSpec('python3')).toBe(false);
  });
});

describe('replayAdapter', () => {
  const trace = (msg: string, finalText: string): AgentTrace => ({
    input: { user_message: msg },
    finalText,
    toolCalls: [],
  });
  const traces = [
    trace('cancel?', 'answer A'),
    trace('cancel?', 'answer B'),
    trace('refund?', 'refund answer'),
  ];

  it('replays matching traces in order and cycles past the end', async () => {
    const adapter = replayAdapter(traces);
    expect((await adapter.run({ user_message: 'cancel?' })).finalText).toBe('answer A');
    expect((await adapter.run({ user_message: 'cancel?' })).finalText).toBe('answer B');
    expect((await adapter.run({ user_message: 'cancel?' })).finalText).toBe('answer A');
  });

  it('errors the run when no trace matches', async () => {
    const adapter = replayAdapter(traces);
    const result = await adapter.run({ user_message: 'unknown' });
    expect(result.error).toMatch(/no recorded trace/);
  });

  it('counts matching traces per user_message', () => {
    expect(replayRunCount(traces, 'cancel?')).toBe(2);
    expect(replayRunCount(traces, 'nope')).toBe(0);
  });
});
