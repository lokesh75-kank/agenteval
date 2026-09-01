# Getting started

AgentEval runs your agent against scenarios N times each, evaluates assertions on every run, and reports a determinism score per scenario plus an audit-ready HTML report. This page gets you from install to a real evaluation of your own agent, in JavaScript or Python.

## Try the demo first (2 minutes, no API keys)

The demo scaffolds a self-contained mock support agent with one deliberately flaky scenario, so you can see the whole loop before wiring up your own agent.

::: code-group

```bash [Node / TypeScript]
mkdir agenteval-demo && cd agenteval-demo
npm init -y && npm i agenteval-core
npx agenteval init --demo
npx agenteval run --html report.html
open report.html
```

```bash [Python]
pip install agenteval-python   # needs Node.js >= 20 on PATH
mkdir agenteval-demo && cd agenteval-demo
agenteval init --demo-python
agenteval run --html report.html
open report.html
```

:::

Expected output: the `cancel-subscription` scenario fails at 33% determinism (1 of 3 runs). That is the point - the demo agent answers the cancellation question differently on each run, the way a real LLM agent does, and a single manual check would have missed it.

```
[FAIL] cancel-subscription  (determinism 33%, 1/3 runs)
[PASS] out-of-scope-refusal  (determinism 100%, 3/3 runs)
[PASS] refund-policy  (determinism 100%, 3/3 runs)

[FAIL] Summary: 2/3 scenarios passed | overall determinism 77.8%
```

## Wrap your own agent

The only integration point is an adapter: given an input, return an [AgentTrace](./concepts#agenttrace) describing what the agent did.

### JavaScript / TypeScript

Edit the scaffolded `agenteval.config.mjs`:

```js
import { defineAdapter } from 'agenteval-core';

const adapter = defineAdapter({
  async run(input) {
    const result = await myAgent.invoke(input.user_message); // your agent here
    return {
      input,
      finalText: result.text,
      toolCalls: result.toolCalls ?? [],
      citations: result.citations, // optional, enables grounding checks
    };
  },
});

export default {
  adapter,
  agentName: 'My agent',
  scenarios: './scenarios',
  runs: 3,
};
```

### Python

Write `my_agent.py` using the `@agenteval.adapter` decorator:

```python
import agenteval

@agenteval.adapter
def my_agent(input):
    result = run_my_agent(input["user_message"])  # LangGraph, CrewAI, raw loop, ...
    return agenteval.Trace(
        final_text=result.text,
        tool_calls=[agenteval.ToolCall(name=t.name, input=t.args) for t in result.tools],
    )

if __name__ == "__main__":
    my_agent.serve()
```

And point a declarative `agenteval.config.yaml` at it:

```yaml
adapter:
  command: python3
  args: [my_agent.py]
agentName: My agent
scenarios: ./scenarios
runs: 3
```

The engine spawns your script once per run, writes the input to stdin as JSON, and reads the trace back from stdout. Print your own logs to stderr - stdout is reserved for the trace. The same subprocess protocol works for any language.

## Write scenarios

Scenarios are YAML files in `./scenarios/`, one per file: an input plus assertions about what a good answer looks like.

```yaml
id: refund-window
description: Answers the refund question with a citation.
input:
  user_message: "Can I get a refund?"
asserts:
  - kind: tool_called
    name: search_kb
  - kind: text_contains_one_of
    options: ["30 days", "30-day"]
  - kind: every_claim_has_citation
```

See the [assertion reference](/reference/assertions) for all 14 kinds.

## Run, gate, repeat

```bash
agenteval run                      # scorecard in the terminal
agenteval run --html report.html   # plus the audit-ready HTML report
agenteval baseline                 # save a known-good snapshot
agenteval check                    # exit 1 if results regressed - wire into CI
```

## Already collecting traces?

You do not have to re-run your agent at all. Score traces you already have:

```bash
agenteval eval --traces traces.json ./scenarios --html report.html
# --format otel | langsmith for OpenTelemetry / LangSmith exports
```

Each scenario replays as many runs as it has recorded traces with a matching `input.user_message`, so determinism is measured from what actually happened in your system. From Python, `agenteval.write_traces(traces, "traces.json")` produces the file.

## Next

- [Core concepts](./concepts) - the AgentTrace contract, adapters, and how determinism is computed
- [Assertion reference](/reference/assertions) - all 14 assertion kinds with examples
- [Configuration and CLI reference](/reference/config) - every config field and CLI flag
