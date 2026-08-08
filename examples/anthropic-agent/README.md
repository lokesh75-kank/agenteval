# Example: evaluating a real Claude-backed agent

The mock example (`examples/basic-agent`) shows the loop; this one evaluates a
**real LLM agent** - a Claude-backed support agent that answers from a small
knowledge base and cites its sources. Because a real model answers differently
across runs, this is where the determinism score earns its keep.

## Run it

```bash
# from the repo root
pnpm install
ANTHROPIC_API_KEY=sk-ant-... pnpm example:anthropic
```

Each scenario runs 3x. You'll see a scorecard with per-scenario determinism
and grounding results, and an audit report written to `report.html` next to
this file. Costs a few cents per run (9 short completions on `claude-opus-5`;
edit `agent.ts` to use a cheaper model).

## What it shows

- `agent.ts` - a Claude-backed agent using AgentEval's own optional
  `createAnthropic` client, with citation parsing into `AgentTrace.citations`.
- `run.ts` - three scenarios (a cited answer, a cited answer, a refusal),
  `citations_resolve` grounding checks against `knownSources`, and 3-run
  determinism sampling.

If the model phrases an answer differently but still passes the assertions,
determinism stays 100% - the score measures *behavioral* consistency (did the
same checks pass?), not verbatim text equality.
