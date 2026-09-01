---
layout: home

hero:
  name: AgentEval
  text: Reliability testing for LLM agents
  tagline: Run every scenario N times, get a determinism score, grounding checks, and an audit-ready report your QA or compliance team can file.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Why determinism? (case study)
      link: /case-studies/25-percent-determinism
    - theme: alt
      text: GitHub
      link: https://github.com/lokesh75-kank/agenteval

features:
  - title: Determinism scoring
    details: The same input, N runs. A scenario that answers differently across identical runs is flaky, and a single hand-check will never catch it. AgentEval reports passingRuns/totalRuns as a first-class number.
  - title: Any agent, any language
    details: Wrap a JS agent in a ten-line adapter, run a Python (or any-language) agent as a subprocess, or skip running entirely and score traces you already collect from OpenTelemetry or LangSmith.
  - title: Grounding and citations
    details: Assert that every factual claim is cited, citations resolve against known sources, and quoted text matches the source verbatim. Built for regulated and high-stakes domains.
  - title: Audit-ready reports
    details: A self-contained HTML report with the verdict, per-run results, determinism scores, and the exact configuration that produced them. Evidence a reviewer can file, not a dashboard screenshot.
---

## Install

::: code-group

```bash [Node / TypeScript]
npm install agenteval-core
```

```bash [Python]
pip install agenteval-python   # needs Node.js >= 20 on PATH
```

:::

## 60-second demo (no API keys)

```bash
npx agenteval init --demo          # or: agenteval init --demo-python
npx agenteval run --html report.html
open report.html                   # one scenario is deliberately flaky - caught at 33%
```
