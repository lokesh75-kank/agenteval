"""The `agenteval` console script: passthrough to the pinned Node engine."""

from __future__ import annotations

import sys

from ._engine import EngineNotFoundError, run_engine


def main() -> None:
    try:
        sys.exit(run_engine(sys.argv[1:]))
    except EngineNotFoundError as err:
        print(f"agenteval: {err}", file=sys.stderr)
        sys.exit(1)
