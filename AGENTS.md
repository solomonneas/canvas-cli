# Repository Guidance

## Definition of Done

```bash
npm run verify
```

This runs tests, typecheck, and build. Do not report success without running it after the final code edit.

## Project Shape

Standalone, self-contained TypeScript CLI for read-only Canvas LMS inspection.
The default backend uses Playwright (Chromium) with a persistent browser
profile: the user logs in once via SSO, and the CLI then calls Canvas's
`/api/v1/` REST endpoints using the session cookies (no API token required).
An optional `--source browser-bridge` backend delegates to a separate,
user-supplied binary.

Keep the package generic and self-contained: no organization-specific,
machine-specific, or personal paths, profile names, or identifiers in code,
comments, README, or tests. Use placeholders like
`https://your-school.instructure.com` and the profile name `default`.

## Live Boundary

Tests must not require live Canvas, a browser, or a logged-in profile. The
Canvas REST mapping and pagination logic is built behind an injectable
requester so it is fully unit-testable with mocks. The only untestable path is
the interactive SSO login, which needs a real browser and a human.

## Public Package Boundary

Public users install this package and run `npx playwright install chromium`,
set `CANVAS_BASE_URL`, then `canvas-cli login`. No private dependency is
required. The optional browser-bridge path must never reference a default or
hardcoded binary path.
