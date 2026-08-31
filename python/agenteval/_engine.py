"""Locating and invoking the AgentEval engine (npm: agenteval-core).

The Python package is a bridge: all evaluation logic lives in the Node engine.
This module pins the engine version (bump in lockstep with npm releases) and
runs it via npx, which caches the package after the first call.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from typing import List

ENGINE_PACKAGE = "agenteval-core"
ENGINE_VERSION = "0.3.0"
MIN_NODE_MAJOR = 20

_INSTALL_HELP = (
    "AgentEval's engine runs on Node.js >= {min} (the Python package is a thin bridge).\n"
    "Install Node from https://nodejs.org or via your package manager\n"
    "(macOS: `brew install node`, Ubuntu: `sudo apt install nodejs npm`), then re-run."
).format(min=MIN_NODE_MAJOR)


class EngineNotFoundError(RuntimeError):
    pass


def _check_node() -> None:
    node = shutil.which("node")
    npx = shutil.which("npx")
    if not node or not npx:
        raise EngineNotFoundError("Node.js was not found on PATH.\n" + _INSTALL_HELP)
    out = subprocess.run([node, "--version"], capture_output=True, text=True, check=False)
    match = re.match(r"v(\d+)", out.stdout.strip())
    if not match or int(match.group(1)) < MIN_NODE_MAJOR:
        raise EngineNotFoundError(
            f"Node.js {out.stdout.strip() or '(unknown version)'} is too old.\n" + _INSTALL_HELP
        )


def run_engine(args: List[str]) -> int:
    """Run the pinned engine CLI with the given arguments; return its exit code."""
    _check_node()
    env_version = os.environ.get("AGENTEVAL_ENGINE_VERSION", ENGINE_VERSION)
    cmd = [
        shutil.which("npx") or "npx",
        "--yes",
        "--package",
        f"{ENGINE_PACKAGE}@{env_version}",
        "agenteval",
        *args,
    ]
    try:
        return subprocess.run(cmd, check=False).returncode
    except KeyboardInterrupt:
        return 130


def main() -> None:
    sys.exit(run_engine(sys.argv[1:]))
