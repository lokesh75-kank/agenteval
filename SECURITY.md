# Security Policy

## Supported versions

| Package | Versions receiving fixes |
|---|---|
| `agenteval-core` (npm) | latest 0.x release |
| `agenteval-python` (PyPI) | latest 0.x release |

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report privately via GitHub's private vulnerability reporting:
[github.com/lokesh75-kank/agenteval/security/advisories/new](https://github.com/lokesh75-kank/agenteval/security/advisories/new).

You can expect an acknowledgement within a few days. Once a fix is available
it is released to both registries and credited to you in the advisory unless
you prefer otherwise.

## Scope notes

AgentEval executes user-configured code by design: `agenteval.config.mjs` is
imported, and a `{ command }` adapter spawns the configured subprocess. Running
an untrusted config is equivalent to running untrusted code and is not a
vulnerability by itself. Reports about the engine doing something *beyond*
what the config asks for (sandbox escape of the report HTML, command injection
from scenario YAML, path traversal from trace files) are very much in scope.
