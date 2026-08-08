# Contributing to AgentEval

Thanks for your interest. AgentEval is early (v0.1) and contributions, issues,
and feedback are all welcome.

## Development setup

```bash
git clone https://github.com/lokesh75-kank/agenteval.git
cd agenteval
pnpm install
pnpm build
pnpm test
```

Requirements: Node >= 20, pnpm.

## Project layout

```
src/core/        AgentTrace + AgentAdapter, runner, YAML loader
src/assertions/  the assertion evaluator
src/grounding/   uncited-claim / citation / quote / coherence checks + presets
src/judge/       LLM-as-judge (self-consistency)
src/llm/         provider-agnostic clients + cost
src/ingest/      OpenTelemetry / LangSmith -> AgentTrace
src/report/      console / json / html renderers
src/cli/         the agenteval CLI
src/mcp/         the MCP server
bench/regulated/ starter scenario set
```

## Before opening a PR

Run the full check locally - CI runs the same:

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm test        # vitest
pnpm build       # tsup
```

Please:
- Add or update tests for any behavior change (the suite is the contract).
- Keep modules pure where they already are; inject dependencies rather than
  reaching for global state or a database.
- Match the surrounding code style. No `any` unless genuinely unavoidable.
- Avoid the em dash in prose and comments.

## Adding an ingest adapter

Adapters map a third-party trace format (LangGraph, OpenHands, AutoGen, ...)
into AgentEval's `AgentTrace` so existing traces can be evaluated without
changing the agent. They are the best first contribution: small, pure, and
well-templated by the two that exist (`src/ingest/otel.ts`,
`src/ingest/langsmith.ts`).

The pattern:

1. Create `src/ingest/<format>.ts` exporting one pure function,
   `<format>ToTrace(raw: unknown): AgentTrace`. The target type is
   `AgentTrace` in `src/core/trace.ts`.
2. Be defensive, never throw. Real-world traces are messy; degrade to a
   best-effort trace (empty `toolCalls`, missing citations) rather than
   erroring. See how `otel.ts` handles multiple attribute encodings.
3. Re-export it from `src/ingest/index.ts` (it flows out through
   `src/index.ts` automatically).
4. Add fixtures and tests in `src/ingest/ingest.test.ts`, including at least
   one malformed-input case proving it degrades instead of throwing.
5. Mention the new format in the README's "Ingest existing traces" section.

If you want a format supported but don't want to build it, open a
[new-adapter issue](https://github.com/lokesh75-kank/agenteval/issues/new?template=new_adapter.yml)
with a sample trace.

## Reporting issues

Open a GitHub issue with a minimal repro (a small `AgentTrace` or scenario that
shows the problem) and what you expected. Security-sensitive reports: please
open a private advisory rather than a public issue.

## License

By contributing you agree your contributions are licensed under the project's
[MIT License](./LICENSE).
