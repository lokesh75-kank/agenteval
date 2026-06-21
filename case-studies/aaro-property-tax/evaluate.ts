// Case study: evaluating a real autonomous web agent with AgentEval.
//
// The traces in traces.json are FOUR real recorded runs of the same task by an
// autonomous web agent (Aaro): "retrieve the property-tax payment receipt from
// the municipal portal." They are ingested as AgentTrace (account/challan
// numbers redacted). We replay them through AgentEval's runner so it scores
// determinism across the real attempts - the headline being that the same task
// succeeded only once in four tries.
//
//   pnpm build && npx tsx case-studies/aaro-property-tax/evaluate.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { defineAdapter, runSuite, renderConsole, renderHtml, type AgentTrace, type Scenario } from 'agenteval-core';

const here = dirname(fileURLToPath(import.meta.url));
const traces = JSON.parse(readFileSync(join(here, 'traces.json'), 'utf8')) as AgentTrace[];

// Replay adapter: hand back the next recorded run on each call, so AgentEval's
// runner measures determinism across the four real attempts (no live re-run).
let i = 0;
const replay = defineAdapter({
  async run() {
    const t = traces[i % traces.length];
    i += 1;
    return t as AgentTrace;
  },
});

const first = traces[0] as AgentTrace;
const scenario: Scenario = {
  id: 'pune-property-tax-receipt',
  description: 'Retrieve the property-tax payment receipt from the municipal portal.',
  input: first.input,
  asserts: [
    // The run must actually surface the receipt, not a homepage or a stall.
    { kind: 'output_contains_one_of', options: ['receipt details', 'challan', 'receipt_details'] },
    { kind: 'text_does_not_contain', patterns: ['stopped responding', 'No Dues', 'goal not met'] },
  ],
};

const report = await runSuite(replay, [scenario], { runs: traces.length, passThreshold: 0.5 });

process.stdout.write(renderConsole(report) + '\n');
writeFileSync(
  join(here, 'report.html'),
  renderHtml(report, {
    title: 'Aaro Property-Tax Agent - Reliability Report',
    agentName: 'Aaro (autonomous web operator)',
  }),
);
process.stdout.write('\nWrote report.html\n');
