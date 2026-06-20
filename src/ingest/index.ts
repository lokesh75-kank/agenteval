// ingest/ — pure transforms from third-party trace formats into AgentTrace.
//
// The adoption-friction killer: users can evaluate traces they *already*
// collect (OpenTelemetry GenAI spans, LangSmith runs) without re-instrumenting
// or re-running their agent. Every transform is pure and defensive — unknown or
// partial shapes degrade to a best-effort AgentTrace rather than throwing.

export { otelToTrace } from './otel.js';
export { langsmithToTrace } from './langsmith.js';
