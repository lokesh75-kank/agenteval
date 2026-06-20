# AgentEval

**Reliability and audit-evidence testing for LLM agents.** Use it when you need an AI agent to behave *consistently* and *cite its sources* - especially in regulated or high-stakes domains (health, fintech, legal, compliance).

Think of it as **unit tests + a crash-test rating for agents**: wrap any agent, define what "good" looks like, run it N times, and get back a scorecard, a determinism (flakiness) score, and an **audit-grade reliability report** your QA or compliance team can actually file.

> Status: v0.1, early but working. AgentEval grew out of the evaluation layer of **Deminn**, a multi-agent system for regulated quality and compliance (CAPA, FDA/ISO) workflows, generalized here to evaluate any LLM agent.

---

## Why another eval tool?

Most eval tools score *accuracy* on single answers. AgentEval targets the things that matter when an agent ships into a high-stakes workflow and that competitors don't package well:

- **Determinism / flakiness** - run the same input N times. If the agent answers differently 2 of 5 times, that's a 60% reliability score. A single hand-check never catches this.
- **Grounding / auditability** - is every factual or regulatory claim backed by a citation that resolves? Are quotes verbatim?
- **Audit attestation report** - a self-contained HTML report (scores, grounding rate, determinism, per-scenario evidence) designed to be reviewed and filed, not just printed to a terminal.

It plugs into traces you already collect (OpenTelemetry, LangSmith) and ships an **MCP server** so coding agents can call it directly.

---

## Install

```bash
npm install @agenteval/core
# or: pnpm add @agenteval/core
```

LLM provider SDKs (`@anthropic-ai/sdk`, `@google/genai`) and the MCP SDK are **optional** - install them only if you use the LLM-judge or the MCP server.

## Quickstart

**1. Wrap your agent in an adapter** (the only integration point):

```ts
import { defineAdapter } from '@agenteval/core';

const adapter = defineAdapter({
  async run(input) {
    const result = await myAgent.invoke(input.user_message);
    return {
      input,
      finalText: result.text,
      toolCalls: result.toolCalls ?? [],
      citations: result.citations, // optional, enables grounding checks
    };
  },
});
```

**2. Define scenarios** (in code or YAML) - what a good answer looks like:

```yaml
# scenarios/refund.yaml
id: refund-window
input:
  user_message: "Can I get a refund?"
asserts:
  - kind: tool_called
    name: search_kb
  - kind: text_contains_one_of
    options: ["30 days", "30-day"]
  - kind: every_claim_has_citation
```

**3. Run it** - N times, to measure determinism:

```ts
import { runSuite, loadScenarios, renderConsole, renderHtml } from '@agenteval/core';

const scenarios = loadScenarios('./scenarios');
const report = await runSuite(adapter, scenarios, { runs: 5 });

console.log(renderConsole(report));
require('node:fs').writeFileSync('attestation.html', renderHtml(report));
```

```
[PASS] refund-window  (determinism 100%, 5/5 runs)
[FAIL] coverage-question  (determinism 60%, 3/5 runs)   <- flaky: same input, different answer
[PASS] Summary: 1/2 scenarios passed | overall determinism 80.0% | grounding 100%
```

## CLI

```bash
npx agenteval init          # scaffold agenteval.config.mjs + an example scenario
npx agenteval run           # run scenarios, print a scorecard
npx agenteval run --html attestation.html   # also write the audit report
npx agenteval baseline      # save a known-good snapshot
npx agenteval check         # fail (exit 1) if results regressed vs the baseline  <- wire into CI
```

The CLI loads `agenteval.config.mjs`, which default-exports your `adapter` and options.

## Assertions

`tool_called` / `tool_not_called` / `tool_input_contains_one_of` · `text_contains` / `text_contains_one_of` / `text_does_not_contain` · `output_contains_one_of` · `iteration_count_under` / `iteration_count_at_least` · `recall_at_k` · `every_claim_has_citation` · `citations_resolve` · `quote_matches_source` · `refusal`

## Grounding (the audit layer)

```ts
import { checkGrounding, REGULATED_PRESET } from '@agenteval/core';

const result = checkGrounding(trace, { config: REGULATED_PRESET, knownSources });
// -> { uncitedClaims, unresolvedCitations, quoteMismatches }
```

Ships a `GENERIC_PRESET` (any assistant) and a `REGULATED_PRESET` (CFR/ISO/IEC/MDR/IVDR/USC). Patterns are configurable for your domain.

## LLM-as-judge

```ts
import { judge, createAnthropic } from '@agenteval/core';

const verdict = await judge({
  trace,
  rubric: 'Does it correctly state the refund window and cite a real policy?',
  llm: createAnthropic(),
  votes: 3, // self-consistency: run the judge 3x, require a majority
});
```

## Ingest existing traces

Already collecting traces? Evaluate them without changing your agent:

```ts
import { otelToTrace, langsmithToTrace } from '@agenteval/core';
const trace = langsmithToTrace(myLangSmithRun);
```

## MCP server

Expose AgentEval to coding agents (Claude, Codex, Cursor) as callable tools - `evaluate_agent`, `check_grounding`, `get_report`:

```bash
npx agenteval-mcp   # or run dist/mcp/server.js
```

See [AGENTS.md](./AGENTS.md) for the canonical integration pattern (written for AI coding agents).

## Benchmark

`bench/regulated/` ships a starter benchmark of regulated-QMS scenarios authored from **public-domain** US regulatory text (eCFR / FDA). See [bench/regulated/README.md](./bench/regulated/README.md).

## License

MIT (c) Lokesh Kank
