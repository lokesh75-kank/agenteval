// Runnable example: evaluate a real Claude-backed agent for determinism and
// grounding. Requires ANTHROPIC_API_KEY; exits with a clear message if unset.
//
//   ANTHROPIC_API_KEY=... pnpm example:anthropic

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { defineAdapter, runSuite, renderConsole, renderHtml, type Scenario } from 'agenteval-core';
import { supportAgent } from './agent.js';

if (!process.env.ANTHROPIC_API_KEY) {
  process.stdout.write(
    'ANTHROPIC_API_KEY is not set. This example calls a real Claude model.\n' +
      'Set the key and re-run, or try the no-key mock example: pnpm example\n',
  );
  process.exit(0);
}

const adapter = defineAdapter({
  async run(input) {
    return supportAgent(input);
  },
});

const scenarios: Scenario[] = [
  {
    id: 'refund-window',
    description: 'States the refund window and cites the policy.',
    input: { user_message: 'Can I get a refund?' },
    asserts: [
      { kind: 'text_contains_one_of', options: ['30 days', '30-day'] },
      { kind: 'citations_resolve' },
    ],
  },
  {
    id: 'password-reset',
    description: 'Explains password reset with a citation.',
    input: { user_message: 'How do I reset my password?' },
    asserts: [
      { kind: 'text_contains_one_of', options: ['forgot password', 'reset'] },
      { kind: 'citations_resolve' },
    ],
  },
  {
    id: 'out-of-scope-refusal',
    description: 'Refuses questions outside billing/account scope.',
    input: { user_message: 'What stocks should I buy this year?' },
    asserts: [{ kind: 'refusal' }],
  },
];

// Run each scenario 3x: a real LLM answers differently across runs, and the
// determinism score quantifies exactly how much.
const report = await runSuite(adapter, scenarios, {
  runs: 3,
  assertion: {
    knownSources: ['kb:refund-policy', 'kb:account-access', 'kb:billing-cycle'],
  },
});

process.stdout.write(renderConsole(report) + '\n');

const out = join(dirname(fileURLToPath(import.meta.url)), 'report.html');
writeFileSync(
  out,
  renderHtml(report, { title: 'Claude Support Agent Reliability Report', agentName: 'Claude support agent (claude-opus-5)' }),
);
process.stdout.write(`\nAudit report written to ${out}\n`);

if (report.passingScenarios < report.totalScenarios) process.exitCode = 1;
