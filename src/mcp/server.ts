#!/usr/bin/env node
// AgentEval MCP server.
//
// Exposes AgentEval to coding agents (Claude, Codex, Cursor) as callable tools.
// Since AgentEval evaluates agents, being natively callable BY an agent is the
// point: a coding agent can run its own agent, then ask AgentEval to score the
// trace, check grounding, or render an audit report - no install dance.
//
// Tools:
//   - evaluate_agent  : given a trace + assertions, return pass/fail per assertion
//   - check_grounding : given text (or a trace), return uncited claims + citation health
//   - get_report      : given a SuiteReport, render console / json / html (audit-ready report)
//
// Uses the low-level MCP Server API so we need no extra schema dependency.
// The @modelcontextprotocol/sdk is an OPTIONAL peer dependency.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { AgentTrace } from '../core/trace.js';
import type { Assertion, SuiteReport } from '../core/types.js';
import { evaluateAssertions } from '../assertions/index.js';
import { checkGrounding, GENERIC_PRESET, REGULATED_PRESET } from '../grounding/index.js';
import { renderConsole, renderJson, renderHtml } from '../report/index.js';

const TOOLS = [
  {
    name: 'evaluate_agent',
    description:
      'Evaluate an agent run. Provide the agent trace (finalText, toolCalls, optional citations) and a list of assertions; returns per-assertion pass/fail. Use after running your agent on a test input.',
    inputSchema: {
      type: 'object',
      properties: {
        trace: {
          type: 'object',
          description: 'AgentTrace: { input:{user_message}, finalText, toolCalls[], citations? }',
        },
        asserts: {
          type: 'array',
          description: 'List of AgentEval assertions (discriminated by "kind").',
          items: { type: 'object' },
        },
        preset: {
          type: 'string',
          enum: ['generic', 'regulated'],
          description: 'Grounding preset for grounding-related assertions (default generic).',
        },
      },
      required: ['trace', 'asserts'],
    },
  },
  {
    name: 'check_grounding',
    description:
      'Check whether text (or an agent trace) contains uncited factual/regulatory claims and whether its citations resolve. Returns uncited claims and citation health.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to check (alternative to trace).' },
        trace: { type: 'object', description: 'AgentTrace (alternative to text).' },
        preset: { type: 'string', enum: ['generic', 'regulated'], description: 'Default generic.' },
        knownSources: {
          type: 'array',
          items: { type: 'string' },
          description: 'Known source ids/refs that citations may resolve against.',
        },
      },
    },
  },
  {
    name: 'get_report',
    description:
      'Render an AgentEval SuiteReport as a console scorecard, JSON, or an audit-ready HTML report.',
    inputSchema: {
      type: 'object',
      properties: {
        report: { type: 'object', description: 'A SuiteReport produced by runSuite.' },
        format: { type: 'string', enum: ['console', 'json', 'html'], description: 'Default console.' },
      },
      required: ['report'],
    },
  },
];

function presetFor(name: unknown) {
  return name === 'regulated' ? REGULATED_PRESET : GENERIC_PRESET;
}

function textResult(text: string) {
  return { content: [{ type: 'text', text }] };
}

/** Create (but do not start) the AgentEval MCP server. */
export function createServer(): Server {
  const server = new Server(
    { name: 'agenteval', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    const a = args as Record<string, unknown>;

    if (name === 'evaluate_agent') {
      const trace = a.trace as AgentTrace;
      const asserts = (a.asserts as Assertion[]) ?? [];
      const results = evaluateAssertions(trace, asserts, {
        groundingConfig: presetFor(a.preset),
      });
      const pass = results.every((r) => r.pass);
      return textResult(JSON.stringify({ pass, assertions: results }, null, 2));
    }

    if (name === 'check_grounding') {
      const trace: AgentTrace =
        (a.trace as AgentTrace) ?? {
          input: { user_message: '' },
          finalText: String(a.text ?? ''),
          toolCalls: [],
        };
      const result = checkGrounding(trace, {
        config: presetFor(a.preset),
        knownSources: a.knownSources as string[] | undefined,
      });
      return textResult(JSON.stringify(result, null, 2));
    }

    if (name === 'get_report') {
      const report = a.report as SuiteReport;
      const format = a.format ?? 'console';
      const rendered =
        format === 'json' ? renderJson(report) : format === 'html' ? renderHtml(report) : renderConsole(report);
      return textResult(rendered);
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}

/** Start the server over stdio. Entry point when run as a binary. */
export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run if invoked directly.
const isMain = process.argv[1] && import.meta.url === pathToFileUrlSafe(process.argv[1]);
if (isMain) {
  main().catch((err: unknown) => {
    process.stderr.write(`agenteval mcp: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}

function pathToFileUrlSafe(p: string): string {
  try {
    // Lazy to avoid an unconditional node:url import at module top for bundlers.
    return new URL(`file://${p}`).href;
  } catch {
    return '';
  }
}
