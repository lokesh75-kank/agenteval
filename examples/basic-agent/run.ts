// Runnable example: evaluate the mock support agent end to end.
//
//   pnpm build && pnpm example
//
// Shows the full loop: wrap an agent in an adapter, define scenarios, run them
// N times for a determinism score, print a scorecard, and write an audit report.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { defineAdapter, runSuite, renderConsole, renderHtml, type Scenario } from 'agenteval-core';
import { supportAgent } from './agent.js';

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
      { kind: 'tool_called', name: 'search_kb' },
      { kind: 'text_contains_one_of', options: ['30 days', '30-day'] },
      { kind: 'every_claim_has_citation' },
    ],
  },
  {
    id: 'password-reset',
    description: 'Explains password reset and cites the source.',
    input: { user_message: 'How do I reset my login password?' },
    asserts: [
      { kind: 'text_contains_one_of', options: ['forgot password', 'reset'] },
      { kind: 'citations_resolve' },
    ],
  },
  {
    id: 'out-of-scope-refusal',
    description: 'Refuses questions outside billing/account scope.',
    input: { user_message: 'What is the weather in Tokyo?' },
    asserts: [
      { kind: 'refusal' },
      { kind: 'text_does_not_contain', patterns: ['sunny', 'degrees', 'forecast'] },
    ],
  },
];

const report = await runSuite(adapter, scenarios, {
  runs: 3, // run each 3x to measure determinism
  assertion: { knownSources: ['kb:refund-policy', 'kb:account-access'] },
});

process.stdout.write(renderConsole(report) + '\n');

const out = join(dirname(fileURLToPath(import.meta.url)), 'report.html');
writeFileSync(out, renderHtml(report, { title: 'Support Agent Reliability Attestation', agentName: 'Demo Support Agent' }));
process.stdout.write(`\nAudit report written to ${out}\n`);

if (report.passingScenarios < report.totalScenarios) process.exitCode = 1;
