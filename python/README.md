# AgentEval (Python)

**Reliability and audit-ready testing for LLM agents.** Run each scenario N times and get a determinism (flakiness) score, grounding checks, and a self-contained audit-ready HTML report.

This package is the Python bridge to the AgentEval engine ([`agenteval-core` on npm](https://www.npmjs.com/package/agenteval-core)) — one engine, no duplicated logic. It requires **Node.js ≥ 20** on your PATH (the CLI tells you if it's missing).

## 60-second demo (no API keys)

```bash
pip install agenteval-python   # installs the `agenteval` CLI and `import agenteval`
mkdir demo && cd demo
agenteval init --demo-python   # scaffolds a mock Python agent — one scenario deliberately flaky
agenteval run --html report.html
open report.html               # the audit report, with the flaky scenario caught
```

## Wrap your real agent (~10 lines)

`my_agent.py`:

```python
import agenteval

@agenteval.adapter
def my_agent(input):
    result = run_my_agent(input["user_message"])  # LangGraph, CrewAI, raw loop, ...
    return agenteval.Trace(
        final_text=result.text,
        tool_calls=[agenteval.ToolCall(name=t.name, input=t.args) for t in result.tools],
        citations=[agenteval.Citation(source=c.source, quote=c.quote) for c in result.citations],
    )

if __name__ == "__main__":
    my_agent.serve()
```

`agenteval.config.yaml`:

```yaml
adapter:
  command: python3
  args: [my_agent.py]
agentName: My agent
scenarios: ./scenarios
runs: 3
```

Then `agenteval run --html report.html`. Scenarios are plain YAML (see the [main README](https://github.com/lokesh75-kank/agenteval#readme) for the assertion vocabulary: tool calls, text content, citation grounding, refusals, LLM-judge rubrics).

## Already have traces?

Score traces you already collect (OpenTelemetry GenAI spans, LangSmith runs, or AgentEval's own trace shape) without re-running your agent:

```python
import agenteval
agenteval.write_traces(traces, "traces.json")
```

```bash
agenteval eval --traces traces.json ./scenarios --html report.html
# or: --format otel | langsmith
```

## License

MIT
