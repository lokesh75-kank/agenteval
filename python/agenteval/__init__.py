"""AgentEval Python bridge.

Reliability and audit-ready testing for LLM agents. This package is a thin
bridge to the AgentEval engine (npm: ``agenteval-core``): one engine, no
duplicated evaluation logic. It gives Python users three things:

1. The ``agenteval`` CLI (``agenteval init --demo-python``, ``agenteval run``,
   ``agenteval eval --traces ...``) — a passthrough to the pinned engine,
   which requires Node.js >= 20.
2. The :func:`adapter` decorator, which turns a plain Python function into a
   subprocess agent the engine can run via its command adapter
   (``adapter: { command: python3, args: [my_agent.py] }`` in
   ``agenteval.config.yaml``).
3. Typed trace builders (:class:`Trace`, :class:`ToolCall`, :class:`Citation`)
   and :func:`write_traces` for the evaluate-recorded-traces path.

Minimal agent::

    import agenteval

    @agenteval.adapter
    def my_agent(input):
        result = call_my_real_agent(input["user_message"])
        return agenteval.Trace(
            final_text=result.text,
            tool_calls=[agenteval.ToolCall(name=t.name, input=t.args) for t in result.tools],
        )

    if __name__ == "__main__":
        my_agent.serve()
"""

from __future__ import annotations

import dataclasses
import json
import sys
from typing import Any, Callable, Dict, List, Optional, Union

__all__ = [
    "Trace",
    "ToolCall",
    "Citation",
    "Step",
    "adapter",
    "write_traces",
]

__version__ = "0.1.0"


@dataclasses.dataclass
class ToolCall:
    """A single tool / function call the agent made during a run."""

    name: str
    input: Dict[str, Any] = dataclasses.field(default_factory=dict)
    output: Any = None
    iteration: Optional[int] = None


@dataclasses.dataclass
class Citation:
    """A citation the agent emitted. All fields optional."""

    id: Optional[str] = None
    source: Optional[str] = None
    quote: Optional[str] = None
    ref: Optional[str] = None


@dataclasses.dataclass
class Step:
    """A user-safe reasoning/working step (not a raw tool call)."""

    label: str
    detail: Optional[str] = None
    state: Optional[str] = None  # "active" | "done" | "pending" | "failed"


@dataclasses.dataclass
class Trace:
    """The result of running an agent once (mirrors the engine's AgentTrace).

    Only ``final_text`` is required; richer fields (citations, steps, tokens,
    timing) unlock more checks and a fuller audit report when present.
    """

    final_text: str
    tool_calls: List[Union[ToolCall, Dict[str, Any]]] = dataclasses.field(default_factory=list)
    citations: Optional[List[Union[Citation, Dict[str, Any]]]] = None
    steps: Optional[List[Union[Step, Dict[str, Any]]]] = None
    iterations: Optional[int] = None
    tokens: Optional[Dict[str, int]] = None  # {"input": ..., "output": ...}
    duration_ms: Optional[float] = None
    error: Optional[str] = None
    input: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to the engine's camelCase AgentTrace JSON shape."""

        def plain(value: Any) -> Any:
            if dataclasses.is_dataclass(value) and not isinstance(value, type):
                return {k: plain(v) for k, v in dataclasses.asdict(value).items() if v is not None}
            if isinstance(value, list):
                return [plain(v) for v in value]
            if isinstance(value, dict):
                return {k: plain(v) for k, v in value.items()}
            return value

        out: Dict[str, Any] = {
            "finalText": self.final_text,
            "toolCalls": plain(self.tool_calls),
        }
        if self.input is not None:
            out["input"] = self.input
        if self.citations is not None:
            out["citations"] = plain(self.citations)
        if self.steps is not None:
            out["steps"] = plain(self.steps)
        if self.iterations is not None:
            out["iterations"] = self.iterations
        if self.tokens is not None:
            out["tokens"] = self.tokens
        if self.duration_ms is not None:
            out["durationMs"] = self.duration_ms
        if self.error is not None:
            out["error"] = self.error
        return out


TraceLike = Union[Trace, Dict[str, Any]]


def _trace_to_dict(trace: TraceLike, agent_input: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    data = trace.to_dict() if isinstance(trace, Trace) else dict(trace)
    if "finalText" not in data and "final_text" in data:
        data["finalText"] = data.pop("final_text")
    if "toolCalls" not in data:
        data["toolCalls"] = data.pop("tool_calls", [])
    if agent_input is not None and "input" not in data:
        data["input"] = agent_input
    return data


class _AdapterFunction:
    """Wraps a user function into the engine's command-adapter protocol."""

    def __init__(self, fn: Callable[[Dict[str, Any]], TraceLike]):
        self._fn = fn
        self.__name__ = getattr(fn, "__name__", "agent")
        self.__doc__ = fn.__doc__

    def __call__(self, agent_input: Dict[str, Any]) -> TraceLike:
        return self._fn(agent_input)

    def serve(self) -> None:
        """Read one AgentInput (JSON) from stdin, write one AgentTrace to stdout.

        Print your own logs to stderr — stdout is reserved for the trace.
        """
        agent_input = json.load(sys.stdin)
        trace = self._fn(agent_input)
        json.dump(_trace_to_dict(trace, agent_input), sys.stdout)
        sys.stdout.flush()


def adapter(fn: Callable[[Dict[str, Any]], TraceLike]) -> _AdapterFunction:
    """Decorator: make a function ``(input: dict) -> Trace | dict`` runnable by
    the AgentEval engine as a subprocess agent.

    End the module with ``if __name__ == "__main__": my_agent.serve()`` and
    point ``agenteval.config.yaml`` at it::

        adapter:
          command: python3
          args: [my_agent.py]
    """
    return _AdapterFunction(fn)


def write_traces(traces: List[TraceLike], path: str) -> None:
    """Write recorded traces as JSON for ``agenteval eval --traces <path>``."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump([_trace_to_dict(t) for t in traces], f, indent=2)
