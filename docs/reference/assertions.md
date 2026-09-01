# Assertion reference

Assertions read an [AgentTrace](/guide/concepts#agenttrace) and produce pass/fail plus a human-readable detail string shown on failure. A run passes only when every assertion passes. All 14 kinds, grouped:

| Category | Kinds |
|---|---|
| [Tool use](#tool-use) | `tool_called` · `tool_not_called` · `tool_input_contains_one_of` |
| [Text](#text) | `text_contains` · `text_contains_one_of` · `text_does_not_contain` · `output_contains_one_of` |
| [Behavior](#behavior) | `refusal` · `iteration_count_under` · `iteration_count_at_least` |
| [Retrieval](#retrieval) | `recall_at_k` |
| [Grounding](#grounding) | `every_claim_has_citation` · `citations_resolve` · `quote_matches_source` |

General notes:

- All substring matching (`*_contains_one_of`, `text_does_not_contain`, `recall_at_k`) is **case-insensitive**.
- `text_contains` treats its pattern as a **regex** (case-insensitive by default); an invalid regex fails the assertion loudly rather than silently passing.
- String values in `args_match` are treated as case-insensitive regexes too (falling back to substring containment if the pattern is invalid), so model-chosen wording still matches. Non-string values use strict equality.

## Tool use

### `tool_called`

The agent must have called the named tool at least once. With `args_match`, at least one call's arguments must match every listed key.

```yaml
- kind: tool_called
  name: search_kb
  args_match:            # optional
    query: "refund"      # string values are case-insensitive regexes
```

### `tool_not_called`

The named tool must not have been called (with matching args, if `args_match` is given). Use it to assert an agent stays inside its lane:

```yaml
- kind: tool_not_called
  name: delete_record
```

### `tool_input_contains_one_of`

At least one of `options` must appear in the string-valued inputs of the agent's tool calls. Restrict to one tool with `tool`; otherwise all tool calls are searched.

```yaml
- kind: tool_input_contains_one_of
  options: ["cancel subscription", "cancellation"]
  tool: search_kb        # optional
```

## Text

### `text_contains`

The final text must match the regex `pattern`. `flags` defaults to `i` (case-insensitive).

```yaml
- kind: text_contains
  pattern: "30[- ]days?"
  flags: "i"             # optional, default "i"
```

### `text_contains_one_of`

The final text must contain at least one of `options` (substring, case-insensitive).

```yaml
- kind: text_contains_one_of
  options: ["30 days", "thirty days"]
```

### `text_does_not_contain`

None of `patterns` may appear in the final text (substring, case-insensitive). The failure detail names every violated pattern.

```yaml
- kind: text_does_not_contain
  patterns: ["guarantee", "100% accurate", "legal advice"]
```

### `output_contains_one_of`

Like `text_contains_one_of`, but the final text **or any tool input** may satisfy it. Useful when the evidence of correct behavior may live in either place, e.g. scoring recorded traces where the answer sometimes arrives via a tool call.

```yaml
- kind: output_contains_one_of
  options: [receipt details, challan]
```

## Behavior

### `refusal`

The agent must have declined or deferred rather than answering, matched by a tolerant heuristic over common refusal phrasings ("I can't ...", "that's outside ...", "unable to help ...", "I must decline"). The standard guard for out-of-scope scenarios:

```yaml
- kind: refusal
```

### `iteration_count_under` / `iteration_count_at_least`

Bound the agent's loop iterations (`trace.iterations`). An absent `iterations` field counts as 0, so `iteration_count_under` passes and `iteration_count_at_least` fails when the adapter does not report iterations.

```yaml
- kind: iteration_count_under
  n: 10                  # catches runaway loops
- kind: iteration_count_at_least
  n: 2                   # catches suspiciously shallow runs
```

## Retrieval

### `recall_at_k`

At least `k` of the `expected` items must appear in the final text (substring, case-insensitive). With `all: true`, every item is required. `k` is clamped to at least 1 whenever `expected` is non-empty, so the assertion can never pass vacuously.

```yaml
- kind: recall_at_k
  expected: ["821.30", "820.100", "803.50"]
  k: 2
  # all: true            # require every item instead
```

## Grounding

The audit layer. These delegate to the grounding module; configure claim/citation detection via the [config's `assertion.groundingConfig`](/reference/config) (presets: `GENERIC_PRESET` for any assistant, `REGULATED_PRESET` for CFR/ISO/IEC/MDR/IVDR/USC-style domains).

### `every_claim_has_citation`

Scans the final text for factual/regulatory sentences that lack an attached citation. Each uncited claim is a violation; the failure detail lists the first few.

```yaml
- kind: every_claim_has_citation
```

### `citations_resolve`

Every inline citation token parsed from the final text (e.g. `[kb:refund-policy]`, `21 CFR 820.100`) must resolve against the known source set. The known set comes from `assertion.knownSources` in config, or falls back to the ids/refs of the trace's own `citations`. A response with no citations passes ("nothing claimed, nothing unresolved") - pair it with `every_claim_has_citation` to also require that claims are cited at all.

```yaml
- kind: citations_resolve
```

### `quote_matches_source`

For every trace citation carrying both a `quote` and a `source` body, the quote must be a verbatim or near-verbatim match of the source (similarity-scored; the failure detail reports the similarity). Citations without both fields are skipped; if none are checkable, the assertion passes.

```yaml
- kind: quote_matches_source
```
