# AgentEval - guide for AI coding agents

If you are an AI coding agent integrating AgentEval into a user's project, follow this canonical pattern. It is the fastest path to a working setup.

## What this library does

Evaluates the reliability of an LLM agent: wrap the user's agent, run scenarios (assertions about its behavior) N times, and report pass/fail + a determinism score + grounding/citation health. Output includes an audit-ready HTML report.

## Choose the integration path

- **User's agent is JS/TS:** follow "Canonical integration" below.
- **User's agent is Python:** `pip install agenteval-python` (needs Node >= 20 on PATH), wrap the agent with the `@agenteval.adapter` decorator, and use a declarative `agenteval.config.yaml` - see "Python integration" below. Do NOT write JavaScript for a Python project.
- **User's agent is another language, or you only have recorded traces:** use the subprocess adapter (`adapter: { command, args }` in YAML config; AgentInput JSON on stdin -> AgentTrace JSON on stdout), or score traces directly with `agenteval eval --traces <file> ./scenarios` (`--format traces|otel|langsmith`).

## Canonical integration (do this)

1. **Install:** `npm install agenteval-core`

2. **Create `agenteval.config.mjs`** that default-exports an `adapter` wrapping the user's agent. The adapter's `run(input)` must return an `AgentTrace`:

```js
import { defineAdapter } from 'agenteval-core';

const adapter = defineAdapter({
  async run(input) {
    // Call the user's real agent with input.user_message.
    const result = await theUsersAgent(input.user_message);
    return {
      input,
      finalText: result.text,            // required: the agent's final answer
      toolCalls: result.toolCalls ?? [], // required: [{ name, input }]
      citations: result.citations,       // optional: [{ ref, source, quote }] - enables grounding checks
    };
  },
});

export default { adapter, scenarios: './scenarios', runs: 3 };
```

3. **Write scenarios** as YAML in `./scenarios/` (one Scenario per file). Minimal shape:

```yaml
id: unique-id
input:
  user_message: "the test input"
asserts:
  - kind: text_contains_one_of
    options: ["expected phrase"]
```

4. **Run:** `npx agenteval run` (scorecard), `npx agenteval run --html report.html` (audit report), `npx agenteval check` (CI gate vs a saved baseline).

## Python integration (agenteval-python)

1. **Install:** `pip install agenteval-python` (the CLI shells out to the pinned npm engine via npx; Node >= 20 required).
2. **Wrap the agent** in `my_agent.py`:

```python
import agenteval

@agenteval.adapter
def my_agent(input):
    result = call_the_users_agent(input["user_message"])
    return agenteval.Trace(
        final_text=result.text,
        tool_calls=[agenteval.ToolCall(name=t.name, input=t.args) for t in result.tools],
        citations=[agenteval.Citation(source=c.source, quote=c.quote) for c in result.citations],  # optional
    )

if __name__ == "__main__":
    my_agent.serve()
```

3. **Create `agenteval.config.yaml`** (no JS needed):

```yaml
adapter:
  command: python3
  args: [my_agent.py]
scenarios: ./scenarios
runs: 3
```

4. **Run:** `agenteval run --html report.html`. Scenarios are the same YAML as below. A working demo: `agenteval init --demo-python`.

To score traces the user already collects: `agenteval.write_traces(traces, "traces.json")` then `agenteval eval --traces traces.json ./scenarios`.

## The AgentTrace shape (the contract)

```ts
interface AgentTrace {
  input: { user_message: string; [k: string]: unknown };
  finalText: string;
  toolCalls: { name: string; input: Record<string, unknown>; output?: unknown; iteration?: number }[];
  citations?: { id?: string; source?: string; quote?: string; ref?: string }[];
  steps?: { label: string; detail?: string }[];
  iterations?: number;
  tokens?: { input: number; output: number };
  durationMs?: number;
  error?: string;
}
```

Only `input`, `finalText`, and `toolCalls` are required. Provide `citations` to enable grounding assertions (`every_claim_has_citation`, `citations_resolve`, `quote_matches_source`).

## Assertion kinds (exhaustive)

`tool_called` {name, args_match?} · `tool_not_called` {name, args_match?} · `tool_input_contains_one_of` {options, tool?} · `text_contains` {pattern, flags?} · `text_contains_one_of` {options} · `text_does_not_contain` {patterns} · `output_contains_one_of` {options} · `iteration_count_under` {n} · `iteration_count_at_least` {n} · `recall_at_k` {expected, k, all?} · `every_claim_has_citation` · `citations_resolve` · `quote_matches_source` · `refusal`

## Programmatic API (if not using the CLI)

```js
import { runSuite, loadScenarios, renderConsole, renderHtml } from 'agenteval-core';
const report = await runSuite(adapter, loadScenarios('./scenarios'), { runs: 5 });
console.log(renderConsole(report));
```

## Calling AgentEval over MCP

If you have AgentEval's MCP server connected, you can call it directly instead of writing files:
- `evaluate_agent` { trace, asserts, preset? } - score a trace you already produced.
- `check_grounding` { text | trace, preset?, knownSources? } - find uncited claims.
- `get_report` { report, format? } - render console/json/html.

## Gotchas

- ESM package. Use `import`, not `require`. Node >= 20.
- The config file must be `.mjs` (or `.js` with `"type":"module"`). A `.ts` config needs `tsx`.
- Grounding presets: default `GENERIC_PRESET`; pass `REGULATED_PRESET` for CFR/ISO/etc. via `assertion.groundingConfig` or the CLI preset.
- The LLM-judge and MCP server need optional peer deps installed (`@anthropic-ai/sdk` / `@google/genai`, `@modelcontextprotocol/sdk`).
