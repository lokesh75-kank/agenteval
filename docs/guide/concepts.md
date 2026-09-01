# Core concepts

Five ideas explain the whole system: the **AgentTrace** (what one run produced), the **AgentAdapter** (how AgentEval runs your agent), the **Scenario** (what a good answer looks like), the **runner** (N runs and the determinism score), and the **report**. Everything else is detail.

```
Scenario ──► Adapter runs your agent ──► AgentTrace ──► Assertions (+ judge)
                    × N runs                                  │
                                                              ▼
                             determinism = passingRuns / totalRuns
                                                              │
                                                              ▼
                                        console / JSON / audit-ready HTML report
```

## AgentTrace

The universal record of one agent run. Every evaluator (assertions, grounding, judge, reports) reads this shape and nothing agent-specific:

```ts
interface AgentTrace {
  input: { user_message: string; [k: string]: unknown };
  finalText: string;                 // required: the agent's final answer
  toolCalls: ToolCall[];             // required: [{ name, input, output?, iteration? }]
  citations?: Citation[];            // { id?, source?, quote?, ref? } - enables grounding checks
  steps?: AgentStep[];               // user-safe working steps, if exposed
  iterations?: number;               // loop iterations, if the agent runs a loop
  tokens?: { input: number; output: number };
  durationMs?: number;
  error?: string;                    // set if the run errored - the run then fails
}
```

Only `input`, `finalText`, and `toolCalls` are required. Richer fields unlock more checks and a fuller report: `citations` enables the grounding assertions, `iterations` enables the loop-bound assertions, `tokens`/`durationMs` appear in the report.

## AgentAdapter

The one interface you implement: `run(input) => Promise<AgentTrace>`. It wraps *how* to invoke your agent so the runner does not care what your agent is.

Three built-in ways to have one:

| Adapter | Use when | Declared as |
|---|---|---|
| JS code | Your agent is JS/TS in-process | `defineAdapter({ run })` in `agenteval.config.mjs` |
| Command (subprocess) | Your agent is Python, Go, anything | `adapter: { command, args }` in YAML or JS config |
| Replay | You already have recorded traces | `agenteval eval --traces`, or `replayAdapter(traces)` in code |

The command adapter spawns one process per run: `AgentInput` JSON on stdin, `AgentTrace` JSON on stdout, stderr passed through for your logs. A crash, timeout, or malformed output becomes an errored run (which fails), never a crash of the evaluation itself.

## Scenario

An input plus assertions, with no domain coupling. Loaded from YAML or built in code:

```yaml
id: refund-window          # required, unique
description: optional prose
tags: [billing, smoke]     # optional grouping
input:
  user_message: "Can I get a refund?"   # required
asserts:                   # see the assertion reference
  - kind: text_contains
    pattern: "30 days"
judge:                     # optional LLM-as-judge rubric
  rubric: "Does it correctly state the refund window?"
  votes: 3                 # self-consistency: majority must agree
```

A run passes only if **every assertion passes, the judge passes (when configured), and the run did not error**.

## The runner and determinism

The defining mechanic. Each scenario runs **N times** (default 3), and the score is:

```
determinism = passingRuns / totalRuns
```

A scenario **passes** when `determinism >= passThreshold` (default 2/3). So with the defaults, a scenario must pass at least 2 of its 3 runs.

Why this matters: an agent with a true 25% success rate will still hand you a success within a few manual attempts, and you will remember the success. Sampling N runs and reporting the rate is the fix. The [case study](/case-studies/25-percent-determinism) shows a real web agent that passed a hand-check and scored 25%.

Notes on the defaults:

- `runs: 3` - a determinism tool that samples once contradicts its own premise. Pass `runs: 1` explicitly for a quick single-shot check.
- `passThreshold: 2/3` - "2 of 3" majority. With `runs: 1` a clean pass is required. The threshold is clamped to [0, 1].
- The LLM-judge, when a scenario declares a rubric, runs per-run with self-consistency voting and **fails closed**: without an explicit judge `passThreshold`, an even split of votes fails.

## Reports

Three renderers over the same `SuiteReport`:

- **Console** - the scorecard you see in the terminal.
- **JSON** (`--json report.json`) - machine-readable, for CI and tooling.
- **HTML** (`--html report.html`) - a self-contained audit-ready report: verdict banner, per-scenario determinism, per-run assertion results, and the resolved configuration (runs, threshold, generator version) recorded in the report itself, so a reviewer can audit what was tested without access to the invocation.

The `baseline` / `check` commands snapshot a known-good report and fail CI (exit 1) when a scenario that passed starts failing or its determinism drops beyond `--tolerance`.
