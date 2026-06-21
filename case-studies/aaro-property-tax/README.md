# Case study: a real autonomous web agent at 25% determinism

This is a real-world validation of AgentEval against an actual, nondeterministic
LLM agent - not a mock.

## The agent

[Aaro](https://github.com/lokesh75-kank) is an autonomous web operator: given a
goal, it searches for the right portal, plans a path, drives a real browser, and
extracts a result. The task here is a genuinely useful, high-stakes errand:

> "Retrieve the property-tax payment receipt from the municipal portal."

Getting this wrong matters (wrong/missing receipt, a stalled government portal),
so reliability is the whole point - exactly AgentEval's wheelhouse.

## What we evaluated

We took **four real recorded runs of the same task** and ingested them as
`AgentTrace` (account and challan numbers redacted to `XXXX`). The runs are
replayed through AgentEval's runner so it scores **determinism across the real
attempts** - no live re-run needed.

Two assertions encode "did it actually retrieve the receipt":
- `output_contains_one_of: [receipt details, challan, receipt_details]`
- `text_does_not_contain: [stopped responding, No Dues, goal not met]`

Run it yourself:

```bash
pnpm build
npx tsx case-studies/aaro-property-tax/evaluate.ts
```

## The finding

```
[FAIL] pune-property-tax-receipt  (determinism 25%, 1/4 runs)
[FAIL] Summary: 0/1 scenarios passed | overall determinism 25.0%
```

**The same task succeeded only 1 of 4 times (25% determinism).** The three
failures were not identical: one hit a "No Dues" page, two had the portal stop
responding mid-run. A single manual spot-check could easily have caught the one
good run and declared the agent "working" - which is precisely the trap
determinism scoring exists to prevent.

`report.html` is the audit-ready report generated from this run.

## Takeaways

- AgentEval generalizes to **any** agent via the `AgentAdapter` / `AgentTrace`
  contract - here, a browser-driving operator in a completely different domain
  from the regulated examples.
- **Determinism scoring surfaces flakiness a single check misses.** "It worked
  when I tried it" is not the same as "it works reliably."
- You can evaluate **recorded** runs you already have - no need to re-run a slow
  or costly live agent.

## Notes

- This is a validation case study, not a production endorsement.
- All account/challan identifiers are redacted; the portal domain is public.
