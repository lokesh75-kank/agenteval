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

## Reporting issues

Open a GitHub issue with a minimal repro (a small `AgentTrace` or scenario that
shows the problem) and what you expected. Security-sensitive reports: please
open a private advisory rather than a public issue.

## License

By contributing you agree your contributions are licensed under the project's
[MIT License](./LICENSE).
