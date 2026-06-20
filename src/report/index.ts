// Report module public surface.
//
// Three renderers over a SuiteReport:
//   - renderConsole: terminal scorecard for CI logs
//   - renderJson:    stable, key-sorted JSON for diffing and archival
//   - renderHtml:    a self-contained audit-ready report document (the product
//                    differentiator) suitable for handing to an auditor
//
// All three are pure functions of the report; renderHtml also accepts optional
// document metadata.

export { renderConsole } from './console.js';
export { renderJson } from './json.js';
export { renderHtml, type HtmlReportMeta } from './html.js';
