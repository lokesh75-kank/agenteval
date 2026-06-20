// Terminal scorecard renderer. Pure-string output (no ANSI by default) so it is
// safe to pipe, snapshot in tests, and paste into CI logs. Pass/fail is shown
// with [PASS]/[FAIL] tokens rather than unicode so it renders everywhere.

import type { SuiteReport } from '../core/types.js';
import {
  describeAssertion,
  failingAssertions,
  groundingPassRate,
  pct,
  pct1,
  representativeRun,
} from './describe.js';

/**
 * Render a human-readable terminal scorecard for a suite run.
 *
 * Layout:
 *   - one header line with title + timestamp
 *   - one block per scenario: status, determinism %, and failing-assertion
 *     detail lines (only when something failed)
 *   - a closing summary line (scenarios passed, overall determinism, grounding)
 */
export function renderConsole(report: SuiteReport): string {
  const lines: string[] = [];

  lines.push('AgentEval suite report');
  lines.push(`generated ${report.generatedAt}`);
  lines.push('');

  for (const s of report.scenarios) {
    const status = s.pass ? '[PASS]' : '[FAIL]';
    const det = pct(s.determinism);
    lines.push(`${status} ${s.scenarioId}  (determinism ${det}, ${s.passingRuns}/${s.totalRuns} runs)`);

    const rep = representativeRun(s);
    if (rep) {
      // Surface a run-level error first; it explains downstream failures.
      if (rep.trace.error) {
        lines.push(`       error: ${truncate(rep.trace.error, 200)}`);
      }
      for (const ar of failingAssertions(rep.assertions)) {
        const label = describeAssertion(ar.assertion);
        const detail = ar.detail ? ` - ${truncate(ar.detail, 160)}` : '';
        lines.push(`       x ${label}${detail}`);
      }
      if (rep.judge && !rep.judge.pass) {
        const j = rep.judge;
        const detail = j.detail ? ` - ${truncate(j.detail, 160)}` : '';
        lines.push(`       x judge: ${j.passingVotes}/${j.votes} votes${detail}`);
      }
    }
  }

  lines.push('');
  lines.push(summaryLine(report));

  return lines.join('\n');
}

/** The single bottom-line summary, also reused as a one-liner elsewhere. */
function summaryLine(report: SuiteReport): string {
  const passed = report.passingScenarios;
  const total = report.totalScenarios;
  const overall = overallDeterminism(report);
  const grounding = groundingPassRate(report);

  const parts = [
    `Summary: ${passed}/${total} scenarios passed`,
    `overall determinism ${pct1(overall)}`,
  ];
  if (grounding !== undefined) {
    parts.push(`grounding ${pct(grounding)}`);
  }
  const verdict = passed === total ? '[PASS]' : '[FAIL]';
  return `${verdict} ${parts.join(' | ')}`;
}

/** Mean determinism across scenarios (0..1); 1.0 when there are no scenarios. */
function overallDeterminism(report: SuiteReport): number {
  if (report.scenarios.length === 0) return 1;
  const sum = report.scenarios.reduce((acc, s) => acc + s.determinism, 0);
  return sum / report.scenarios.length;
}

/** Trim long strings for one-line console output, with an ellipsis marker. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3)}...`;
}
