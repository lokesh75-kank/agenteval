# Example: evaluating a basic agent

A minimal, dependency-free example showing the full AgentEval loop on a mock
customer-support agent (no real LLM, deterministic by design so the example is
stable). Swap `agent.ts` for your real agent.

## Run it

```bash
# from the repo root
pnpm build
pnpm example
```

You'll see a scorecard (3 scenarios, each run 3x for a determinism score) and an
audit report written to `report.html` next to this file.

## What it shows

- `agent.ts` - the agent being evaluated (replace with yours).
- `run.ts` - wraps it in an `AgentAdapter`, defines three scenarios (a grounded
  answer, a cited answer, and an out-of-scope refusal), runs the suite, prints
  the console scorecard, and writes the HTML audit attestation.

The same thing via the CLI: `agenteval init` scaffolds an `agenteval.config.mjs`
and a `scenarios/` folder, then `agenteval run --html report.html`.
