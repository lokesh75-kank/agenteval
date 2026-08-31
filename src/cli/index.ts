#!/usr/bin/env node
// AgentEval CLI.
//
//   agenteval run [scenarios]     run scenarios, print a scorecard
//   agenteval baseline [scenarios] run and save a baseline snapshot
//   agenteval check [scenarios]   run and fail if results regressed vs baseline
//   agenteval init                scaffold a config + example scenario
//
// The CLI loads a config module (default ./agenteval.config.mjs) that
// default-exports at least an `adapter` (how to run your agent). Everything
// else (scenarios path, runs, llm, grounding) is optional.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { parse as parseYaml } from 'yaml';

import type { AgentAdapter, AgentTrace } from '../core/trace.js';
import type { Scenario, SuiteReport } from '../core/types.js';
import type { RunOptions } from '../core/runner.js';
import { runSuite } from '../core/runner.js';
import { loadScenarios } from '../core/loader.js';
import { renderConsole, renderJson, renderHtml } from '../report/index.js';
import { commandAdapter, isCommandSpec, type CommandAdapterSpec } from '../adapters/command.js';
import { replayAdapter, replayRunCount } from '../adapters/replay.js';
import { otelToTrace, langsmithToTrace } from '../ingest/index.js';
import { VERSION } from '../version.js';

interface AgentEvalConfig extends RunOptions {
  /** A JS adapter { run }, or a subprocess spec { command, args? } (any language). */
  adapter: AgentAdapter | CommandAdapterSpec;
  /** Path to scenarios (file/dir/manifest) or inline Scenario[]. */
  scenarios?: string | Scenario[];
  /** Agent name shown in the report header ("Agent under test"). */
  agentName?: string;
}

/** Config with the adapter resolved to something runnable. */
interface ResolvedConfig extends AgentEvalConfig {
  adapter: AgentAdapter;
}

const DEFAULT_CONFIG_CANDIDATES = [
  'agenteval.config.mjs',
  'agenteval.config.js',
  'agenteval.config.ts',
  'agenteval.config.yaml',
  'agenteval.config.yml',
];
const DEFAULT_BASELINE = 'agenteval.baseline.json';

async function loadConfig(
  explicit?: string,
  { requireAdapter = true } = {},
): Promise<ResolvedConfig> {
  const path = explicit
    ? resolve(process.cwd(), explicit)
    : DEFAULT_CONFIG_CANDIDATES.map((c) => resolve(process.cwd(), c)).find((p) => existsSync(p));
  if (!path || !existsSync(path)) {
    throw new Error(
      `No config found. Create agenteval.config.mjs or agenteval.config.yaml (run "agenteval init") or pass --config <file>.`,
    );
  }
  let config: AgentEvalConfig | undefined;
  if (/\.ya?ml$/.test(path)) {
    // YAML config: declarative only, so the adapter must be a command spec.
    config = parseYaml(readFileSync(path, 'utf8')) as AgentEvalConfig;
  } else {
    const mod = (await import(pathToFileURL(path).href)) as { default?: AgentEvalConfig };
    config = mod.default;
  }
  if (config && isCommandSpec(config.adapter)) {
    return { ...config, adapter: commandAdapter(config.adapter) };
  }
  if (!config || typeof (config.adapter as AgentAdapter | undefined)?.run !== 'function') {
    // `eval` scores recorded traces, so a config without an adapter is fine there.
    if (config && !requireAdapter) return config as ResolvedConfig;
    throw new Error(
      `Config at ${path} must default-export (or declare, for YAML) an "adapter": either { run } or { command, args? }.`,
    );
  }
  return config as ResolvedConfig;
}

function resolveScenarios(config: AgentEvalConfig | ResolvedConfig, cliArg?: string): Scenario[] {
  const src = cliArg ?? config.scenarios;
  if (!src) {
    throw new Error('No scenarios. Pass a path argument or set "scenarios" in your config.');
  }
  return typeof src === 'string' ? loadScenarios(resolve(process.cwd(), src)) : src;
}

async function runReport(opts: { config?: string; runs?: string }, cliArg?: string): Promise<{ config: ResolvedConfig; report: SuiteReport }> {
  const config = await loadConfig(opts.config);
  const scenarios = resolveScenarios(config, cliArg);
  const runOptions: RunOptions = {
    runs: opts.runs ? Number(opts.runs) : config.runs,
    passThreshold: config.passThreshold,
    llm: config.llm,
    assertion: config.assertion,
  };
  const report = await runSuite(config.adapter, scenarios, runOptions);
  return { config, report };
}

// ── baseline snapshot ──
interface Baseline {
  generatedAt: string;
  scenarios: Record<string, { pass: boolean; determinism: number }>;
}

function toBaseline(report: SuiteReport): Baseline {
  const scenarios: Baseline['scenarios'] = {};
  for (const s of report.scenarios) {
    scenarios[s.scenarioId] = { pass: s.pass, determinism: s.determinism };
  }
  return { generatedAt: report.generatedAt, scenarios };
}

const program = new Command();
program
  .name('agenteval')
  .description('Reliability and audit-ready testing for LLM agents')
  .version(VERSION);

program
  .command('run')
  .description('Run scenarios and print a scorecard')
  .argument('[scenarios]', 'path to scenarios (file/dir/manifest)')
  .option('-c, --config <file>', 'config module')
  .option('-r, --runs <n>', 'runs per scenario (determinism sampling)')
  .option('--json <file>', 'write JSON report to file')
  .option('--html <file>', 'write audit-ready HTML report to file')
  .action(async (scenarios, opts) => {
    const { config, report } = await runReport(opts, scenarios);
    process.stdout.write(renderConsole(report) + '\n');
    if (opts.json) writeFileSync(resolve(process.cwd(), opts.json), renderJson(report));
    if (opts.html)
      writeFileSync(
        resolve(process.cwd(), opts.html),
        renderHtml(report, { agentName: config.agentName, generatedBy: `AgentEval v${VERSION}` }),
      );
    if (report.passingScenarios < report.totalScenarios) process.exitCode = 1;
  });

program
  .command('baseline')
  .description('Run and save a baseline snapshot')
  .argument('[scenarios]', 'path to scenarios')
  .option('-c, --config <file>', 'config module')
  .option('-r, --runs <n>', 'runs per scenario')
  .option('-o, --out <file>', 'baseline file', DEFAULT_BASELINE)
  .action(async (scenarios, opts) => {
    const { report } = await runReport(opts, scenarios);
    writeFileSync(resolve(process.cwd(), opts.out), JSON.stringify(toBaseline(report), null, 2));
    process.stdout.write(renderConsole(report) + `\nBaseline written to ${opts.out}\n`);
  });

program
  .command('check')
  .description('Run and fail (exit 1) if results regressed vs the baseline')
  .argument('[scenarios]', 'path to scenarios')
  .option('-c, --config <file>', 'config module')
  .option('-r, --runs <n>', 'runs per scenario')
  .option('-b, --baseline <file>', 'baseline file', DEFAULT_BASELINE)
  .option('--tolerance <n>', 'allowed determinism drop before failing', '0')
  .action(async (scenarios, opts) => {
    const baselinePath = resolve(process.cwd(), opts.baseline);
    if (!existsSync(baselinePath)) {
      throw new Error(`No baseline at ${opts.baseline}. Run "agenteval baseline" first.`);
    }
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
    const { report } = await runReport(opts, scenarios);
    process.stdout.write(renderConsole(report) + '\n');

    const tolerance = Number(opts.tolerance);
    const regressions: string[] = [];
    for (const s of report.scenarios) {
      const base = baseline.scenarios[s.scenarioId];
      if (!base) continue;
      if (base.pass && !s.pass) {
        regressions.push(`${s.scenarioId}: was passing, now failing`);
      } else if (base.determinism - s.determinism > tolerance) {
        regressions.push(
          `${s.scenarioId}: determinism dropped ${(base.determinism * 100).toFixed(0)}% -> ${(s.determinism * 100).toFixed(0)}%`,
        );
      }
    }
    if (regressions.length > 0) {
      process.stdout.write('\nREGRESSIONS:\n' + regressions.map((r) => '  - ' + r).join('\n') + '\n');
      process.exitCode = 1;
    } else {
      process.stdout.write('\nNo regressions vs baseline.\n');
    }
  });

program
  .command('eval')
  .description('Evaluate pre-recorded traces (no agent run) against scenarios')
  .argument('[scenarios]', 'path to scenarios (file/dir/manifest)')
  .option('-t, --traces <file>', 'JSON file of recorded traces (required)')
  .option(
    '-f, --format <format>',
    'trace file format: traces (AgentTrace[]) | otel | langsmith',
    'traces',
  )
  .option('-c, --config <file>', 'config module (for scenarios/threshold; adapter is ignored)')
  .option('--json <file>', 'write JSON report to file')
  .option('--html <file>', 'write audit-ready HTML report to file')
  .action(async (scenariosArg, opts) => {
    if (!opts.traces) throw new Error('eval requires --traces <file>.');
    const traces = loadTraces(resolve(process.cwd(), opts.traces), opts.format);

    // Config is optional here: scenarios can come from the CLI arg alone, and
    // the adapter (if any) is ignored, so a scenarios-only config is valid.
    let config: Partial<AgentEvalConfig> = {};
    if (opts.config) {
      config = await loadConfig(opts.config, { requireAdapter: false });
    } else {
      try {
        config = await loadConfig(undefined, { requireAdapter: false });
      } catch {
        // No config in cwd - fine, the scenarios argument carries everything.
      }
    }
    const src = scenariosArg ?? config.scenarios;
    if (!src) throw new Error('No scenarios. Pass a path argument or set "scenarios" in a config.');
    const scenarios =
      typeof src === 'string' ? loadScenarios(resolve(process.cwd(), src)) : src;

    const adapter = replayAdapter(traces);
    // Each scenario replays as many runs as it has recorded traces (min 1, so
    // a scenario with no matching trace fails visibly rather than vanishing).
    const summaries = [];
    for (const scenario of scenarios) {
      const runs = Math.max(1, replayRunCount(traces, scenario.input.user_message));
      const sub = await runSuite(adapter, [scenario], {
        runs,
        passThreshold: config.passThreshold,
        llm: config.llm,
        assertion: config.assertion,
      });
      summaries.push(...sub.scenarios);
    }
    const report: SuiteReport = {
      generatedAt: new Date().toISOString(),
      totalScenarios: summaries.length,
      passingScenarios: summaries.filter((s) => s.pass).length,
      scenarios: summaries,
    };

    process.stdout.write(renderConsole(report) + '\n');
    if (opts.json) writeFileSync(resolve(process.cwd(), opts.json), renderJson(report));
    if (opts.html)
      writeFileSync(
        resolve(process.cwd(), opts.html),
        renderHtml(report, { agentName: config.agentName, generatedBy: `AgentEval v${VERSION}` }),
      );
    if (report.passingScenarios < report.totalScenarios) process.exitCode = 1;
  });

/**
 * Load a traces file. "traces": AgentTrace[] (or { traces: [...] }).
 * "otel" / "langsmith": an array where each element is one run's raw data
 * (a span array / a LangSmith run tree), mapped through the ingest layer.
 */
function loadTraces(path: string, format: string): AgentTrace[] {
  if (!existsSync(path)) throw new Error(`No traces file at ${path}.`);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const items = Array.isArray(raw)
    ? raw
    : raw !== null && typeof raw === 'object' && Array.isArray((raw as { traces?: unknown[] }).traces)
      ? (raw as { traces: unknown[] }).traces
      : null;
  if (!items) throw new Error(`Traces file must be a JSON array (or { "traces": [...] }).`);
  switch (format) {
    case 'traces':
      return items as AgentTrace[];
    case 'otel':
      return items.map((spans) => otelToTrace(spans));
    case 'langsmith':
      return items.map((run) => langsmithToTrace(run));
    default:
      throw new Error(`Unknown --format "${format}" (expected traces | otel | langsmith).`);
  }
}

program
  .command('init')
  .description('Scaffold an agenteval config and an example scenario')
  .option('--demo', 'scaffold a working demo agent (one deliberately flaky) instead of a stub')
  .option('--demo-python', 'scaffold the demo as a Python agent + YAML config (no JS to write)')
  .action((opts: { demo?: boolean; demoPython?: boolean }) => {
    const scenDir = resolve(process.cwd(), 'scenarios');
    if (opts.demoPython) {
      const yamlPath = resolve(process.cwd(), 'agenteval.config.yaml');
      const agentPath = resolve(process.cwd(), 'demo_agent.py');
      if (existsSync(yamlPath)) {
        process.stdout.write('agenteval.config.yaml already exists; leaving it untouched.\n');
      } else {
        writeFileSync(yamlPath, PYTHON_DEMO_CONFIG_TEMPLATE);
        process.stdout.write('Created agenteval.config.yaml\n');
      }
      if (!existsSync(agentPath)) {
        writeFileSync(agentPath, PYTHON_DEMO_AGENT_TEMPLATE);
        process.stdout.write('Created demo_agent.py\n');
      }
    } else {
      const cfgPath = resolve(process.cwd(), 'agenteval.config.mjs');
      if (existsSync(cfgPath)) {
        process.stdout.write('agenteval.config.mjs already exists; leaving it untouched.\n');
      } else {
        writeFileSync(cfgPath, opts.demo ? DEMO_CONFIG_TEMPLATE : CONFIG_TEMPLATE);
        process.stdout.write('Created agenteval.config.mjs\n');
      }
    }
    if (!existsSync(scenDir)) mkdirSync(scenDir, { recursive: true });
    const files: Record<string, string> =
      opts.demo || opts.demoPython ? DEMO_SCENARIOS : { 'example.yaml': SCENARIO_TEMPLATE };
    for (const [name, content] of Object.entries(files)) {
      const p = join(scenDir, name);
      if (!existsSync(p)) {
        writeFileSync(p, content);
        process.stdout.write(`Created scenarios/${name}\n`);
      }
    }
    process.stdout.write(
      opts.demo || opts.demoPython
        ? '\nNext: run "agenteval run --html report.html" and open report.html - one scenario is deliberately flaky.\n'
        : '\nNext: edit agenteval.config.mjs to wrap your agent, then run "agenteval run".\n',
    );
  });

const PYTHON_DEMO_CONFIG_TEMPLATE = `# AgentEval configuration (declarative YAML).
# The adapter is a subprocess: AgentEval writes the input to its stdin as JSON
# and reads an AgentTrace back from stdout. Any language works.
adapter:
  command: python3
  args: [demo_agent.py]
agentName: Demo support agent (Python)
scenarios: ./scenarios
runs: 3 # run each scenario 3x to measure determinism
`;

const PYTHON_DEMO_AGENT_TEMPLATE = `"""AgentEval demo agent - a self-contained mock support agent in Python.

Reads an AgentEval input (JSON) from stdin, writes an AgentTrace (JSON) to
stdout. Replace the logic with a call to your real agent. With the
"agenteval" PyPI package installed you can use the @agenteval.adapter
decorator instead of handling stdin/stdout yourself.
"""

import json
import pathlib
import sys

# Each run is a fresh process, so the demo round-robins via a state file to
# mimic an LLM agent answering differently across identical runs.
_STATE = pathlib.Path(".demo_agent_calls")


def _next_call() -> int:
    n = int(_STATE.read_text()) if _STATE.exists() else 0
    _STATE.write_text(str(n + 1))
    return n


def run(inp):
    msg = inp["user_message"].lower()

    if "refund" in msg:
        return {
            "finalText": "Refunds are available within 30 days of purchase under our billing policy. [kb:refund-policy]",
            "toolCalls": [{"name": "search_kb", "input": {"query": "refund policy"}}],
            "citations": [
                {"ref": "kb:refund-policy", "source": "kb:refund-policy", "quote": "within 30 days of purchase"}
            ],
        }

    if "cancel" in msg:
        # Deliberately flaky: answers differently across runs, the way a real
        # LLM agent does. AgentEval's determinism score catches exactly this.
        answers = [
            "You can cancel your subscription anytime from Settings > Billing. [kb:cancellation]",
            "To cancel, contact our support team and they will process it within 5 business days.",
            "Cancellation takes effect at the end of your current billing cycle. [kb:cancellation]",
        ]
        return {
            "finalText": answers[_next_call() % len(answers)],
            "toolCalls": [{"name": "search_kb", "input": {"query": "cancel subscription"}}],
        }

    return {
        "finalText": "I can only help with billing and account questions, so I can't answer that one.",
        "toolCalls": [],
    }


if __name__ == "__main__":
    agent_input = json.load(sys.stdin)
    trace = run(agent_input)
    trace["input"] = agent_input
    json.dump(trace, sys.stdout)
`;

const CONFIG_TEMPLATE = `// AgentEval configuration.
// Wrap your agent in an adapter: given an input, return an AgentTrace.
import { defineAdapter } from 'agenteval-core';

const adapter = defineAdapter({
  async run(input) {
    // TODO: call your real agent here.
    // const result = await myAgent.invoke(input.user_message);
    return {
      input,
      finalText: 'replace me with your agent output',
      toolCalls: [],
      // citations: [{ source: 'doc-1', quote: '...' }],
    };
  },
});

export default {
  adapter,
  agentName: 'My agent', // shown in the report header
  scenarios: './scenarios',
  runs: 3, // run each scenario 3x to measure determinism
};
`;

const DEMO_CONFIG_TEMPLATE = `// AgentEval demo configuration - a self-contained mock support agent.
// No API keys needed. Replace the adapter with your real agent when ready.
import { defineAdapter } from 'agenteval-core';

let cancelCalls = 0;

const adapter = defineAdapter({
  async run(input) {
    const msg = input.user_message.toLowerCase();

    if (msg.includes('refund')) {
      return {
        input,
        finalText:
          'Refunds are available within 30 days of purchase under our billing policy. [kb:refund-policy]',
        toolCalls: [{ name: 'search_kb', input: { query: 'refund policy' } }],
        citations: [
          { ref: 'kb:refund-policy', source: 'kb:refund-policy', quote: 'within 30 days of purchase' },
        ],
      };
    }

    if (msg.includes('cancel')) {
      // Deliberately flaky: answers differently across runs, the way a real
      // LLM agent does. AgentEval's determinism score catches exactly this.
      cancelCalls += 1;
      const answers = [
        'You can cancel your subscription anytime from Settings > Billing. [kb:cancellation]',
        'To cancel, contact our support team and they will process it within 5 business days.',
        'Cancellation takes effect at the end of your current billing cycle. [kb:cancellation]',
      ];
      return {
        input,
        finalText: answers[cancelCalls % answers.length],
        toolCalls: [{ name: 'search_kb', input: { query: 'cancel subscription' } }],
      };
    }

    // Out of scope: refuse rather than hallucinate.
    return {
      input,
      finalText: "I can only help with billing and account questions, so I can't answer that one.",
      toolCalls: [],
    };
  },
});

export default {
  adapter,
  agentName: 'Demo support agent', // shown in the report header
  scenarios: './scenarios',
  runs: 3, // run each scenario 3x to measure determinism
};
`;

const DEMO_SCENARIOS: Record<string, string> = {
  'refund-policy.yaml': `id: refund-policy
description: Answers the refund question with a citation.
tags: [billing]
input:
  user_message: "Can I get a refund?"
asserts:
  - kind: tool_called
    name: search_kb
  - kind: text_contains
    pattern: "30 days"
`,
  'cancel-subscription.yaml': `id: cancel-subscription
description: Cancellation answer should be consistent across runs (it isn't).
tags: [billing, flaky]
input:
  user_message: "How do I cancel my subscription?"
asserts:
  - kind: tool_called
    name: search_kb
  - kind: text_contains
    pattern: "Settings > Billing"
`,
  'out-of-scope-refusal.yaml': `id: out-of-scope-refusal
description: Refuses questions outside billing/account scope.
tags: [safety]
input:
  user_message: "What stocks should I buy?"
asserts:
  - kind: refusal
`,
};

const SCENARIO_TEMPLATE = `id: example-greeting
description: The agent greets the user without inventing facts.
tags: [smoke]
input:
  user_message: "Hi, what can you help me with?"
asserts:
  - kind: text_does_not_contain
    patterns: ["guarantee", "100% accurate"]
`;

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`agenteval: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
