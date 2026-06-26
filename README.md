# canvas-cli

Read-only Canvas LMS CLI that needs **no API token**. You log in through your
browser once, and the CLI reuses that session to read your courses, upcoming
assignments, and announcements from the command line.

This exists because some schools (a number of universities included) **disable
Canvas personal access tokens**. Without a token, the usual API-based tools
stop working. `canvas-cli` sidesteps that: it drives a real, logged-in browser
session and calls Canvas's own `/api/v1/` REST endpoints with your session
cookies, which Canvas accepts even when token generation is turned off.

It is intentionally small and read-only. It lists data; it never submits
coursework, sends messages, or writes anything back to Canvas.

## How it works

1. `canvas-cli login` opens a real Chromium window at your Canvas URL.
2. You complete your school's normal SSO login in that window.
3. The session is saved to a persistent browser profile on your machine.
4. Every later command runs **headless**, reusing that saved session to call
   the Canvas REST API. No token, no password storage, no scraping.

## Install

```bash
npm install
npx playwright install chromium   # one-time: download the headless browser
npm run build
npm link                          # optional: put `canvas-cli` on your PATH
```

Or install from npm once published:

```bash
npm install -g canvas-cli
npx playwright install chromium
```

## Set up

Point the CLI at your school's Canvas instance and log in once:

```bash
export CANVAS_BASE_URL="https://your-school.instructure.com"
canvas-cli login
```

A browser window opens. Finish SSO. When the CLI detects you are
authenticated, it saves the session and closes. You only repeat this when the
session eventually expires.

## Commands

```bash
canvas-cli courses list        [--json] [--limit N]
canvas-cli assignments list    [--json] [--lookahead DAYS] [--limit N]
canvas-cli notifications list  [--json] [--limit N]
canvas-cli items list          [--json] [--lookahead DAYS] [--limit N]
canvas-cli status              [--json]
canvas-cli login
```

`canvasctl` is installed as an alias for `canvas-cli`.

Examples:

```bash
canvas-cli courses list
canvas-cli assignments list --lookahead 21
canvas-cli items list --json
```

If a command reports `auth_required`, run `canvas-cli login` again to refresh
the session.

## Options

| Flag | Description |
| --- | --- |
| `--json` | Emit JSON instead of text (see below) |
| `--limit N` | Cap the number of rows returned |
| `--lookahead DAYS` | Assignment due-date window in days (default 14) |
| `--base-url URL` | Canvas base URL (overrides `CANVAS_BASE_URL`) |
| `--profile NAME` | Use a named login profile (default `default`) |
| `--source KIND` | Backend: `playwright` (default) or `browser-bridge` |
| `--bridge PATH` | Path to a browser-bridge binary (advanced) |

Environment variables: `CANVAS_BASE_URL`, `CANVAS_CLI_PROFILE_DIR` (where the
browser profile is stored; defaults to `$XDG_DATA_HOME/canvas-cli/profile` or
`~/.local/share/canvas-cli/profile`), `CANVAS_CLI_PROFILE_NAME`.

## JSON output

`--json` prints the mapped data as JSON arrays (or, for `items`, an object with
`assignments` and `notifications`). This is the stable interface other tools
consume. For example, a digest tool can shell out to:

```bash
canvas-cli assignments list --json
```

and parse the result directly.

## Advanced: browser-bridge source

The default and recommended backend is Playwright. As an alternative, you can
delegate to a separate, user-supplied `browser-bridge` binary that exposes
`canvas list-courses`, `canvas list-upcoming-assignments`, and
`canvas list-recent-notifications` actions:

```bash
canvas-cli courses list --source browser-bridge --bridge /path/to/browser-bridge.js
# or
BROWSER_BRIDGE_PATH=/path/to/browser-bridge.js canvas-cli courses list --source browser-bridge
```

There is no default path: you must supply one via `--bridge` or
`BROWSER_BRIDGE_PATH`. This path is optional and only relevant if you already
run your own browser-bridge.

## Safety

`canvas-cli` is read-only. It only calls Canvas list endpoints and never writes
to Canvas. It does drive a live authenticated browser profile stored on your
machine, so an expired SSO session is a normal operational outcome: just run
`canvas-cli login` again.

## Development

```bash
npm run verify   # tests + typecheck + build
```

Tests run entirely offline. The Canvas REST mapping and pagination logic is
exercised against a mocked requester, so no live Canvas session or browser is
needed to test. The one piece that cannot be unit-tested is the interactive
SSO login itself, which requires a real browser and a human.

## License

MIT. See [LICENSE](LICENSE).
