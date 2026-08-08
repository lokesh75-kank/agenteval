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

import type { AgentAdapter } from '../core/trace.js';
import type { Scenario, SuiteReport } from '../core/types.js';
import type { RunOptions } from '../core/runner.js';
import { runSuite } from '../core/runner.js';
import { loadScenarios } from '../core/loader.js';
import { renderConsole, renderJson, renderHtml } from '../report/index.js';
import { VERSION } from '../version.js';

interface AgentEvalConfig extends RunOptions {
  adapter: AgentAdapter;
  /** Path to scenarios (file/dir/manifest) or inline Scenario[]. */
  scenarios?: string | Scenario[];
}

const DEFAULT_CONFIG_CANDIDATES = [
  'agenteval.config.mjs',
  'agenteval.config.js',
  'agenteval.config.ts',
];
const DEFAULT_BASELINE = 'agenteval.baseline.json';

async function loadConfig(explicit?: string): Promise<AgentEvalConfig> {
  const path = explicit
    ? resolve(process.cwd(), explicit)
    : DEFAULT_CONFIG_CANDIDATES.map((c) => resolve(process.cwd(), c)).find((p) => existsSync(p));
  if (!path || !existsSync(path)) {
    throw new Error(
      `No config found. Create agenteval.config.mjs (run "agenteval init") or pass --config <file>.`,
    );
  }
  const mod = (await import(pathToFileURL(path).href)) as { default?: AgentEvalConfig };
  const config = mod.default;
  if (!config || typeof config.adapter?.run !== 'function') {
    throw new Error(`Config at ${path} must default-export an object with an "adapter" { run }.`);
  }
  return config;
}

function resolveScenarios(config: AgentEvalConfig, cliArg?: string): Scenario[] {
  const src = cliArg ?? config.scenarios;
  if (!src) {
    throw new Error('No scenarios. Pass a path argument or set "scenarios" in your config.');
  }
  return typeof src === 'string' ? loadScenarios(resolve(process.cwd(), src)) : src;
}

async function runReport(opts: { config?: string; runs?: string }, cliArg?: string): Promise<{ config: AgentEvalConfig; report: SuiteReport }> {
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
    const { report } = await runReport(opts, scenarios);
    process.stdout.write(renderConsole(report) + '\n');
    if (opts.json) writeFileSync(resolve(process.cwd(), opts.json), renderJson(report));
    if (opts.html) writeFileSync(resolve(process.cwd(), opts.html), renderHtml(report));
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
  .command('init')
  .description('Scaffold an agenteval config and an example scenario')
  .option('--demo', 'scaffold a working demo agent (one deliberately flaky) instead of a stub')
  .action((opts: { demo?: boolean }) => {
    const cfgPath = resolve(process.cwd(), 'agenteval.config.mjs');
    const scenDir = resolve(process.cwd(), 'scenarios');
    if (existsSync(cfgPath)) {
      process.stdout.write('agenteval.config.mjs already exists; leaving it untouched.\n');
    } else {
      writeFileSync(cfgPath, opts.demo ? DEMO_CONFIG_TEMPLATE : CONFIG_TEMPLATE);
      process.stdout.write('Created agenteval.config.mjs\n');
    }
    if (!existsSync(scenDir)) mkdirSync(scenDir, { recursive: true });
    const files: Record<string, string> = opts.demo
      ? DEMO_SCENARIOS
      : { 'example.yaml': SCENARIO_TEMPLATE };
    for (const [name, content] of Object.entries(files)) {
      const p = join(scenDir, name);
      if (!existsSync(p)) {
        writeFileSync(p, content);
        process.stdout.write(`Created scenarios/${name}\n`);
      }
    }
    process.stdout.write(
      opts.demo
        ? '\nNext: run "agenteval run --html report.html" and open report.html - one scenario is deliberately flaky.\n'
        : '\nNext: edit agenteval.config.mjs to wrap your agent, then run "agenteval run".\n',
    );
  });

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
