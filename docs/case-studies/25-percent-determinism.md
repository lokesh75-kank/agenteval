
# Your agent passed the demo. Would it pass it again?

We gave a real autonomous web agent the same task four times. It succeeded once.

Not four different tasks. The *identical* task, with the identical goal, against the same
website. One clean success, three distinct failures. If we had spot-checked it on a lucky
run, we would have called it working and shipped it.

This post is about that trap, why "it worked when I tried it" is close to meaningless for
LLM agents, and the tooling we built to catch it: a determinism score measured across N runs
of the same input, from traces you already have.

## The agent and the task

The agent is an autonomous web operator (an internal project called Aaro): given a goal in
plain language, it finds the right portal, plans a path, drives a real browser, and extracts
a result. The task was a genuinely useful, high-stakes errand:

> "Retrieve the property-tax payment receipt from the municipal portal."

Getting this wrong has real consequences: a missing receipt, a stalled government portal, a
user who trusted the automation. Reliability is not a nice-to-have here; it is the entire
product.

## Four runs, one success

We recorded four real runs of the task and scored them. Here is what the same agent, on the
same goal, actually did:

| Run | Tool calls | Outcome |
|---|---|---|
| 1 | 14 | Failed: navigated but never left the homepage content; goal not met |
| 2 | 15 | Failed: "nothing I tried changed the screen"; the portal stopped responding |
| 3 | 4 | **Succeeded**: receipt details retrieved and verified |
| 4 | 6 | Failed: portal stopped responding again |

Two details are worth staring at.

First, the three failures were not the same failure. One was the agent losing its way (14
tool calls spent circling the homepage), two were the environment misbehaving (a government
portal that froze mid-session). Any single retry-until-it-works session would have hidden
all of this structure.

Second, the successful run was the *cheapest* one: 4 tool calls. The runs that flailed
burned 14 and 15. Effort did not correlate with success; the agent working harder was a
symptom of the agent failing. That inversion shows up in a trace log and nowhere else.

## Why a single check lies to you

When a human tests an agent, the workflow is almost always: run it, watch it, maybe run it
again if it fails, and stop at the first success. That process is *selection biased toward
passing*. An agent with a true 25% success rate will hand you a success within four manual
attempts most of the time, and you will remember the success.

The fix is boring and statistical: run the same scenario N times and report the pass rate as
a first-class number. We call it a determinism score. This agent scored:

```
[FAIL] property-tax-receipt  (determinism 25%, 1/4 runs)
[FAIL] Summary: 0/1 scenarios passed | overall determinism 25.0%
```

25% determinism is not a vibe or a judgment call; it is a number you can gate a release on,
track across versions, and hand to a reviewer.

## The part that makes this practical: no live re-runs

The obvious objection: "my agent is slow and costs money; I am not running everything four
times." Neither did we. The four runs above were *already recorded* traces from normal
operation, replayed through the evaluator's runner (the case study ships the exact replay
script). The whole "did it actually get the receipt" contract is two assertions:

```yaml
asserts:
  - kind: output_contains_one_of
    options: [receipt details, challan, receipt_details]
  - kind: text_does_not_contain
    patterns: [stopped responding, "No Dues", goal not met]
```

The same workflow is now a single CLI command for your own traces:

```bash
npx agenteval eval --traces traces.json ./scenarios --html report.html
```

If you already collect OpenTelemetry GenAI spans or LangSmith runs, those ingest directly
(`--format otel | langsmith`). The evaluator replays each scenario across however many
matching traces you collected, so determinism is measured from what actually happened in
your system, not from a synthetic benchmark.

And because agents are polyglot, the agent under test does not have to be JavaScript: a
subprocess adapter runs anything that reads JSON on stdin and writes a trace to stdout, with
a Python decorator (`pip install agenteval-python`) that makes the integration about ten
lines.

## The audit trail

The other output is a self-contained HTML report: the verdict, the per-run results, the
determinism score, and the exact configuration that produced them (runs, thresholds, tool
version). For most teams that is a nicety. For teams shipping agents into regulated or
high-stakes workflows (our background is quality/compliance systems: CAPA, FDA/ISO), it is
the difference between "we tested it, trust us" and a document a reviewer can file.

![The audit report format: verdict banner, per-scenario determinism scores, flaky runs flagged](../assets/report-screenshot.png)

*(The report above shows the demo suite; [the report generated from this case study](../../case-studies/aaro-property-tax/report.html) ships in the repo.)*

## Takeaways

1. **A single successful run is weak evidence.** For agents, pass rate across identical
   runs is the honest metric, and it needs to be a first-class number, not an anecdote.
2. **Failure diversity matters.** 1-of-4 with three different failure modes is a very
   different engineering problem from 1-of-4 with one repeated bug. You only see this by
   scoring multiple runs.
3. **You probably already have the data.** Recorded traces are enough; determinism scoring
   does not require an expensive live harness.

Everything here is open source: [AgentEval](https://github.com/lokesh75-kank/agenteval)
(MIT), `npm i agenteval-core` or `pip install agenteval-python`. The full case study,
including the redacted traces and the exact evaluation script, is in
[`case-studies/aaro-property-tax/`](https://github.com/lokesh75-kank/agenteval/tree/main/case-studies/aaro-property-tax),
so you can reproduce the 25% yourself:

```bash
npx tsx case-studies/aaro-property-tax/evaluate.ts
```

An honest caveat to close: this is one agent, one task, four runs. It is a validation case
study, not a benchmark, and n=4 gives a wide confidence interval on the true success rate.
But that is precisely the point: four runs were already enough to demolish a conclusion that
one run had established. Imagine what your traces from last week would say.
