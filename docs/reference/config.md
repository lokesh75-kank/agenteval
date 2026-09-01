# Configuration and CLI reference

## Config file

The CLI looks for, in order: `agenteval.config.mjs`, `.js`, `.ts`, `agenteval.config.yaml`, `.yml` (or pass `--config <file>`).

- **JS config** (`.mjs`/`.js`/`.ts`): a module that default-exports the config object. Required when your adapter is JS code or when you configure the LLM-judge (an `llm` client is a live object). A `.ts` config needs `tsx` available.
- **YAML config**: declarative only, so the adapter must be a command spec. Ideal for Python and other subprocess agents - no JS to write.

### Fields

| Field | Type | Default | Notes |
|---|---|---|---|
| `adapter` | `{ run }` or `{ command, ... }` | required* | How to run your agent. *`eval` (trace scoring) accepts a config without an adapter. |
| `scenarios` | path or `Scenario[]` | - | File, directory, or `manifest.yaml`; the CLI positional argument overrides it. |
| `agentName` | string | - | Shown in the report header ("Agent under test"). |
| `runs` | number | `3` | Runs per scenario (determinism sampling). `--runs` overrides. |
| `passThreshold` | number 0..1 | `2/3` | Fraction of runs that must pass for a scenario to pass. |
| `llm` | `LLMClient` | - | Client used for scenarios with a `judge` rubric, e.g. `createAnthropic()`. JS config only. |
| `assertion` | `AssertionContext` | - | Context for grounding assertions, below. |

### `assertion` context

```js
import { REGULATED_PRESET } from 'agenteval-core';

export default {
  // ...
  assertion: {
    groundingConfig: REGULATED_PRESET,        // claim/citation detection preset
    knownSources: ['kb:refund-policy', 'kb:cancellation'], // for citations_resolve
  },
};
```

`groundingConfig` defaults to the generic preset; `knownSources` defaults to the ids/refs of each trace's own citations.

### Command adapter spec

Any language: the engine spawns the command once per run, writes the `AgentInput` as JSON to stdin, and parses an `AgentTrace` from stdout. stderr passes through for your logs.

```yaml
adapter:
  command: python3        # required: executable
  args: [my_agent.py]     # optional
  cwd: ./agents           # optional, default: current directory
  env:                    # optional, merged over the parent env
    MODEL: claude-sonnet-5
  timeoutMs: 120000       # optional, default 120000; the run errors on timeout
```

Failure behavior: a non-zero exit, invalid JSON on stdout, missing `finalText`, spawn failure, or timeout becomes an **errored run** (which fails that run) - the evaluation itself never crashes.

### Example JS config

```js
import { defineAdapter, createAnthropic, REGULATED_PRESET } from 'agenteval-core';

const adapter = defineAdapter({
  async run(input) {
    const r = await myAgent.invoke(input.user_message);
    return { input, finalText: r.text, toolCalls: r.tools ?? [], citations: r.citations };
  },
});

export default {
  adapter,
  agentName: 'Support agent',
  scenarios: './scenarios',
  runs: 5,
  passThreshold: 0.8,
  llm: createAnthropic(),                       // enables judge rubrics
  assertion: { groundingConfig: REGULATED_PRESET },
};
```

## CLI

```
agenteval <command> [scenarios] [flags]
```

The optional `[scenarios]` positional (file / directory / `manifest.yaml`) overrides the config's `scenarios`.

### `agenteval init`

Scaffold a config and example scenarios.

| Flag | Effect |
|---|---|
| `--demo` | Working JS demo agent (one deliberately flaky scenario), no API keys |
| `--demo-python` | The same demo as a Python agent + YAML config |

Existing files are left untouched.

### `agenteval run`

Run scenarios and print the scorecard. Exit code 1 if any scenario fails.

| Flag | Effect |
|---|---|
| `-c, --config <file>` | Config module (default: auto-discovered) |
| `-r, --runs <n>` | Runs per scenario, overrides config |
| `--json <file>` | Write the JSON report |
| `--html <file>` | Write the audit-ready HTML report |

### `agenteval baseline`

Run and save a known-good snapshot (default `agenteval.baseline.json`; `-o, --out <file>` to change). Same `--config`/`--runs` flags as `run`.

### `agenteval check`

Run and **exit 1 on regression** vs the baseline - wire this into CI.

| Flag | Effect |
|---|---|
| `-b, --baseline <file>` | Baseline file (default `agenteval.baseline.json`) |
| `--tolerance <n>` | Allowed determinism drop before failing (default `0`) |

A regression is: a scenario that passed now fails, or its determinism dropped by more than the tolerance.

### `agenteval eval`

Score **pre-recorded traces** - no agent run. Each scenario replays as many runs as it has traces with a matching `input.user_message` (a scenario with no matching trace fails visibly). The config is optional here, and its adapter is ignored.

| Flag | Effect |
|---|---|
| `-t, --traces <file>` | JSON traces file (required) |
| `-f, --format <format>` | `traces` (an `AgentTrace[]`, default) \| `otel` \| `langsmith` |
| `-c, --config <file>` | For scenarios/threshold/grounding context only |
| `--json` / `--html <file>` | Reports, as in `run` |

Traces file shapes: a JSON array (or `{ "traces": [...] }`). For `otel`, each element is one run's span array; for `langsmith`, one run tree - both are mapped through the ingest layer. From Python, `agenteval.write_traces(traces, path)` produces the native format.

## Python CLI

`pip install agenteval-python` installs the same `agenteval` CLI (a passthrough to the pinned npm engine via npx; Node >= 20 required). All commands and flags above work identically. `AGENTEVAL_ENGINE_VERSION` overrides the pinned engine version if you need to test against a different release.
