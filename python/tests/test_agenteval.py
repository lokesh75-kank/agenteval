"""Tests for the Python bridge: trace serialization and the stdin/stdout protocol."""

import io
import json
import subprocess
import sys
import textwrap

import agenteval


def test_trace_to_dict_camelcase_and_omits_none():
    trace = agenteval.Trace(
        final_text="hello [kb:x]",
        tool_calls=[agenteval.ToolCall(name="search", input={"q": "x"})],
        citations=[agenteval.Citation(ref="kb:x", quote="hello")],
        duration_ms=12.5,
    )
    data = trace.to_dict()
    assert data["finalText"] == "hello [kb:x]"
    assert data["toolCalls"] == [{"name": "search", "input": {"q": "x"}}]
    assert data["citations"] == [{"ref": "kb:x", "quote": "hello"}]
    assert data["durationMs"] == 12.5
    assert "error" not in data and "steps" not in data and "iterations" not in data


def test_adapter_decorator_is_callable_directly():
    @agenteval.adapter
    def my_agent(agent_input):
        return agenteval.Trace(final_text="echo: " + agent_input["user_message"])

    result = my_agent({"user_message": "hi"})
    assert result.final_text == "echo: hi"


def test_serve_protocol_end_to_end(tmp_path):
    # A real subprocess round-trip: exactly what the engine's command adapter does.
    script = tmp_path / "agent.py"
    script.write_text(
        textwrap.dedent(
            """
            import agenteval

            @agenteval.adapter
            def my_agent(input):
                return agenteval.Trace(
                    final_text="echo: " + input["user_message"],
                    tool_calls=[agenteval.ToolCall(name="echo", input={"m": input["user_message"]})],
                )

            if __name__ == "__main__":
                my_agent.serve()
            """
        )
    )
    proc = subprocess.run(
        [sys.executable, str(script)],
        input=json.dumps({"user_message": "hello"}),
        capture_output=True,
        text=True,
        check=True,
    )
    trace = json.loads(proc.stdout)
    assert trace["finalText"] == "echo: hello"
    assert trace["toolCalls"] == [{"name": "echo", "input": {"m": "hello"}}]
    assert trace["input"] == {"user_message": "hello"}


def test_serve_accepts_plain_dict_with_snake_case(monkeypatch, capsys):
    @agenteval.adapter
    def my_agent(agent_input):
        return {"final_text": "plain dict", "tool_calls": []}

    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps({"user_message": "x"})))
    my_agent.serve()
    trace = json.loads(capsys.readouterr().out)
    assert trace["finalText"] == "plain dict"
    assert trace["toolCalls"] == []
    assert trace["input"] == {"user_message": "x"}


def test_write_traces(tmp_path):
    path = tmp_path / "traces.json"
    agenteval.write_traces(
        [
            agenteval.Trace(final_text="a", input={"user_message": "q1"}),
            {"finalText": "b", "toolCalls": [], "input": {"user_message": "q2"}},
        ],
        str(path),
    )
    data = json.loads(path.read_text())
    assert [t["finalText"] for t in data] == ["a", "b"]
    assert all("toolCalls" in t for t in data)
