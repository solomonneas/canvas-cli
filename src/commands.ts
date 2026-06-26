import type { BrowserBridgeRunner } from './browser-bridge.js';
import { resolveBridgePath } from './browser-bridge.js';
import { formatAssignments, formatCourses, formatItems, formatNotifications } from './format.js';
import { runLogin } from './login.js';
import { resolveBaseUrl } from './profile.js';
import { BrowserBridgeSource } from './sources/browser-bridge-source.js';
import { PlaywrightSource } from './sources/playwright-source.js';
import type { CanvasSource, SourceResult } from './sources/source.js';
import type {
  CanvasAssignment,
  CanvasCommandFlags,
  CanvasCourse,
  CanvasItemView,
  CanvasNotification,
  CanvasSection,
  CanvasStatus,
  CommandIo,
} from './types.js';

export const DEFAULT_LOOKAHEAD_DAYS = 14;

export const USAGE =
  'Usage: canvas-cli <courses|assignments|notifications|items> list [options]\n' +
  '       canvas-cli login [options]\n' +
  '       canvas-cli status [options]\n' +
  '\n' +
  'Options:\n' +
  '  --json                 Emit JSON (consumed by other tools)\n' +
  '  --limit <n>            Cap the number of rows\n' +
  '  --lookahead <days>     Assignment window in days (default 14)\n' +
  '  --base-url <url>       Canvas base URL (or env CANVAS_BASE_URL)\n' +
  '  --profile <name>       Profile name (default "default")\n' +
  "  --source <kind>        'playwright' (default) or 'browser-bridge'\n" +
  '  --bridge <path>        browser-bridge binary path (browser-bridge source)';

const DEFAULT_IO: CommandIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

function parsePositiveInt(value: string | undefined): number | undefined {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseFlags(args: string[]): CanvasCommandFlags {
  const envSource = process.env.CANVAS_CLI_SOURCE;
  const flags: CanvasCommandFlags = {
    json: false,
    lookahead: DEFAULT_LOOKAHEAD_DAYS,
    profileName: process.env.CANVAS_CLI_PROFILE_NAME ?? 'default',
    source: envSource === 'browser-bridge' ? 'browser-bridge' : 'playwright',
    baseUrl: resolveBaseUrl(),
    bridgePath: resolveBridgePath(),
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') flags.json = true;
    else if (arg === '--profile') {
      const next = args[++i];
      if (next) flags.profileName = next;
    } else if (arg === '--base-url') {
      const next = args[++i];
      if (next) flags.baseUrl = next.replace(/\/+$/, '');
    } else if (arg === '--source') {
      const next = args[++i];
      if (next === 'browser-bridge' || next === 'playwright') flags.source = next;
    } else if (arg === '--bridge') {
      const next = args[++i];
      if (next) {
        flags.bridgePath = next;
        flags.source = 'browser-bridge';
      }
    } else if (arg === '--lookahead') {
      const next = parsePositiveInt(args[++i]);
      if (next !== undefined) flags.lookahead = next;
    } else if (arg === '--limit') {
      flags.limit = parsePositiveInt(args[++i]);
    }
  }

  return flags;
}

function printJson(io: CommandIo, value: unknown): void {
  io.stdout(JSON.stringify(value, null, 2));
}

function printLines(io: CommandIo, lines: string[]): void {
  for (const line of lines) io.stdout(line);
}

function sourceFailure(io: CommandIo, section: string, result: SourceResult<unknown>): number {
  const code = result.error?.code ?? 'source_error';
  const message = result.error?.message ? `: ${result.error.message}` : '';
  io.stderr(`canvas-cli: ${section} failed ${code}${message}`);
  if (code === 'auth_required') {
    io.stderr('canvas-cli: not logged in. Run `canvas-cli login` and complete SSO.');
  }
  return 2;
}

function buildStatus(profile: string, result: SourceResult<unknown>): CanvasStatus {
  if (result.ok) {
    return {
      ok: true,
      profile,
      message: `Canvas is reachable for profile "${profile}".`,
    };
  }

  const code = result.error?.code ?? 'source_error';
  const message = result.error?.message ?? '';
  const hint =
    code === 'auth_required' || code === 'auth_expired'
      ? `Canvas auth is missing or expired for profile "${profile}". Run \`canvas-cli login\`, then rerun this command.`
      : `Canvas is not reachable for profile "${profile}".`;

  return {
    ok: false,
    profile,
    message: hint,
    error: { code, message },
  };
}

function printStatus(io: CommandIo, status: CanvasStatus, json: boolean): void {
  if (json) {
    printJson(io, status);
    return;
  }

  io.stdout(status.message);
  if (status.error) {
    const details = status.error.message ? `: ${status.error.message}` : '';
    io.stdout(`Error: ${status.error.code}${details}`);
  }
}

function missingBaseUrl(io: CommandIo): number {
  io.stderr(
    'canvas-cli: CANVAS_BASE_URL is required for the playwright source. ' +
      'Set it (e.g. https://your-school.instructure.com) or pass --base-url, ' +
      'or use --source browser-bridge.',
  );
  return 64;
}

/**
 * Build the data source for a command. Injection points (for tests):
 *   - opts.source: use this CanvasSource directly.
 *   - opts.runner: wrap this BrowserBridgeRunner in a BrowserBridgeSource
 *     (preserves backward-compatible browser-bridge unit tests).
 * Returns a number (exit code) instead of a source when configuration is
 * invalid (e.g. playwright with no base URL).
 */
function buildSource(
  flags: CanvasCommandFlags,
  io: CommandIo,
  opts: { source?: CanvasSource; runner?: BrowserBridgeRunner },
): CanvasSource | number {
  if (opts.source) return opts.source;

  if (opts.runner) {
    return new BrowserBridgeSource({ runner: opts.runner, profileName: flags.profileName });
  }

  if (flags.source === 'browser-bridge') {
    return new BrowserBridgeSource({
      bridgePath: flags.bridgePath,
      profileName: flags.profileName,
    });
  }

  if (!flags.baseUrl) return missingBaseUrl(io);
  return new PlaywrightSource({
    baseUrl: flags.baseUrl,
    profileName: flags.profileName,
  });
}

async function withSource<T>(
  source: CanvasSource,
  fn: (source: CanvasSource) => Promise<T>,
): Promise<T> {
  try {
    return await fn(source);
  } finally {
    if (source.close) await source.close().catch(() => undefined);
  }
}

export interface RunOptions {
  /** Use this source directly (test/advanced injection). */
  source?: CanvasSource;
  /** Wrap this runner in a browser-bridge source (back-compat injection). */
  runner?: BrowserBridgeRunner;
  io?: CommandIo;
}

export async function runCanvasCommand(args: string[], opts: RunOptions = {}): Promise<number> {
  const io = opts.io ?? DEFAULT_IO;
  const [rawSection, maybeAction, ...rest] = args;
  const section = rawSection as CanvasSection | undefined;

  if (!rawSection || rawSection === '--help' || rawSection === '-h' || rawSection === 'help') {
    io.stdout(USAGE);
    return 0;
  }

  if (section === 'login') {
    const flags = parseFlags(args.slice(1));
    if (!flags.baseUrl) return missingBaseUrl(io);
    return runLogin({ baseUrl: flags.baseUrl, profileName: flags.profileName }, io);
  }

  if (section === 'status') {
    const flags = parseFlags(args.slice(1));
    const built = buildSource(flags, io, opts);
    if (typeof built === 'number') return built;
    const result = await withSource(built, (s) => s.listCourses({ limit: 1 }));
    const status = buildStatus(flags.profileName, result);
    printStatus(io, status, flags.json);
    return status.ok ? 0 : 2;
  }

  const action = maybeAction === 'list' || maybeAction === undefined ? 'list' : maybeAction;
  const flagArgs = maybeAction === 'list' ? rest : args.slice(1);

  if (
    !section ||
    !['courses', 'assignments', 'notifications', 'items'].includes(section) ||
    action !== 'list'
  ) {
    io.stderr(USAGE);
    return 64;
  }

  const flags = parseFlags(flagArgs);
  const built = buildSource(flags, io, opts);
  if (typeof built === 'number') return built;

  return withSource(built, async (source) => {
    if (section === 'courses') {
      const result = await source.listCourses({ limit: flags.limit });
      if (!result.ok) return sourceFailure(io, section, result);
      const courses = result.value ?? ([] as CanvasCourse[]);
      if (flags.json) printJson(io, courses);
      else printLines(io, formatCourses(courses));
      return 0;
    }

    if (section === 'assignments') {
      const result = await source.listAssignments({
        lookaheadDays: flags.lookahead,
        limit: flags.limit,
      });
      if (!result.ok) return sourceFailure(io, section, result);
      const assignments = result.value ?? ([] as CanvasAssignment[]);
      if (flags.json) printJson(io, assignments);
      else printLines(io, formatAssignments(assignments));
      return 0;
    }

    if (section === 'notifications') {
      const result = await source.listNotifications({ limit: flags.limit });
      if (!result.ok) return sourceFailure(io, section, result);
      const notifications = result.value ?? ([] as CanvasNotification[]);
      if (flags.json) printJson(io, notifications);
      else printLines(io, formatNotifications(notifications));
      return 0;
    }

    // items: combined assignments + notifications view
    const assignmentsResult = await source.listAssignments({
      lookaheadDays: flags.lookahead,
      limit: flags.limit,
    });
    if (!assignmentsResult.ok) return sourceFailure(io, 'assignments', assignmentsResult);
    const notificationsResult = await source.listNotifications({ limit: flags.limit });
    if (!notificationsResult.ok) return sourceFailure(io, 'notifications', notificationsResult);

    const view: CanvasItemView = {
      assignments: assignmentsResult.value ?? [],
      notifications: notificationsResult.value ?? [],
    };
    if (flags.json) printJson(io, view);
    else printLines(io, formatItems(view));
    return 0;
  });
}
