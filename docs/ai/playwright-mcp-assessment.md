# Playwright MCP: assessment (2026-10-12)

**Recommendation: do not adopt now.** Revisit only if ParaBank gains substantial new UI or the team
starts exploratory AI sessions on unmapped pages; any adoption needs separate approval (it is a new
external integration). Nothing was installed and no Claude configuration was changed.

## What it is

Playwright MCP (`@playwright/mcp`, Microsoft) is a Model Context Protocol server that lets an AI
agent drive a real browser: navigate, click, type, and read the page as an accessibility snapshot.
It is an interactive tool for the agent; it does not run or replace the test suite.

## Benefit for this project

| Use                        | Value here | Why                                                                                                                                                                                      |
| -------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI exploration             | Low        | ParaBank is small and fully mapped: 14 Page Object/component classes, a functional traceability matrix and an error-message inventory (docs/functional-coverage.md)                      |
| Locator discovery          | Low        | Its snapshots favour role/label locators; ParaBank has no labels, test ids or aria-labels, so the useful locators are roles and stable ids, which `npx playwright codegen` already gives |
| Accessibility inspection   | Low–medium | Shows the accessibility tree; but accessibility is not in this suite's scope, and the existing UI Mode/trace viewer shows the DOM and ARIA snapshot locally                              |
| AI-assisted test authoring | Low        | Tests are Gherkin + existing steps; the hard part is the business oracle (ledger, API state), which a browser session does not provide                                                   |
| Behavior investigation     | Medium     | Lets an agent reproduce a flow step by step; the same is available with `HEADLESS=false`, `npx playwright test --ui` and docs/failure-triage.md                                          |

Existing tooling covering the same ground: `npx playwright codegen http://localhost:8090/parabank/`,
`npx playwright test --ui`, `--headed`, the trace viewer, and `curl` of the page markup.

## Security implications

- **Credentials reach the model.** Snapshots are page text sent to the AI provider. ParaBank shows
  the password on login recovery (PB-13) and embeds it in the Update Profile page and URL (PB-18);
  the agent would also type synthetic credentials. That conflicts with the sensitive-data rule
  unless every session is restricted to synthetic customers and pages are chosen carefully.
- **Unbounded navigation and prompt injection.** The agent can open any URL and read untrusted page
  content. Its `--allowed-origins` option (default: all origins) narrows this, but the project's
  README states it "does not serve as a security boundary"; the real boundary would have to be
  the network (QA/UAT reachable only on loopback) and synthetic data only.
- **Persistent browser state.** By default the browser profile persists on disk between sessions
  (cookies, sessions); `--isolated` keeps it in memory instead.
- **Traces/screenshots** (screenshot tool; tracing tools opt-in via `--caps=devtools`) carry the
  same unredactable data as Playwright traces.

## Cost

- **Installation:** Node.js (present); register the server per project or user with the agent
  (for Claude Code, `claude mcp add`), plus a browser. A version must be pinned and reviewed like
  any dependency.
- **Maintenance:** another moving part to update with Playwright and the agent; its options must be
  re-checked at each upgrade.
- **Integration complexity:** low technically; the real work is the guard-rails above (origin
  allow-list, isolated profile, no traces, synthetic data only) and keeping it out of CI.

## If adopted later (conditions)

Project-scoped (never global) configuration reviewed in a PR; pinned version; `--isolated`;
`--allowed-origins` limited to the local QA/UAT URLs (defence in depth only, not a boundary);
headless; no tracing capability, trace or video output; never against the public ParaBank site;
never in Jenkins. Options verified against the `@playwright/mcp` README on 2026-10-12; re-check
them against the pinned version at that time.
