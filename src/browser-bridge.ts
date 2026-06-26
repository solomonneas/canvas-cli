import { spawn } from 'node:child_process';

export const DEFAULT_PROFILE_NAME = 'default';
export const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Resolve the path to a user-supplied browser-bridge binary. There is no
 * default: browser-bridge is a separate, optional backend, so the path must be
 * given explicitly via `--bridge <path>` or the `BROWSER_BRIDGE_PATH`
 * (or `CANVAS_CLI_BROWSER_BRIDGE_PATH`) environment variable.
 */
export function resolveBridgePath(explicit?: string): string | undefined {
  return (
    explicit ??
    process.env.CANVAS_CLI_BROWSER_BRIDGE_PATH ??
    process.env.BROWSER_BRIDGE_PATH ??
    undefined
  );
}

export interface BrowserBridgeError {
  code: string;
  message: string;
}

export interface BrowserBridgeResponse<T = unknown> {
  ok: boolean;
  result?: T;
  error?: BrowserBridgeError;
  warnings?: unknown[];
  raw?: unknown;
}

export interface BrowserBridgeInvokeArgs {
  platform: string;
  action: string;
  input?: Record<string, unknown>;
  profileName?: string;
  timeoutMs?: number;
}

export interface BrowserBridgeRunner {
  invoke<T = unknown>(args: BrowserBridgeInvokeArgs): Promise<BrowserBridgeResponse<T>>;
}

export interface BrowserBridgeShellRunnerOptions {
  binaryPath?: string;
  logger?: (message: string) => void;
  spawnFn?: typeof spawn;
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function runChild(
  spawnFn: typeof spawn,
  cmd: string,
  args: string[],
  stdin: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawnFn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }

    let killTimer: NodeJS.Timeout | null = null;
    let resolved = false;
    const finish = (code: number | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ stdout, stderr, code, timedOut });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        finish(null);
      }, 5_000);
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (resolved) return;
      resolved = true;
      reject(err);
    });
    child.on('close', (code) => {
      finish(code);
    });

    if (child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

export function parseBrowserBridgeEnvelope<T = unknown>(stdout: string): BrowserBridgeResponse<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'invalid_envelope',
        message: `browser-bridge returned non-JSON: ${(err as Error).message}`,
      },
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      error: { code: 'invalid_envelope', message: 'browser-bridge envelope is not an object' },
    };
  }

  const env = parsed as {
    ok?: unknown;
    result?: unknown;
    error?: unknown;
    warnings?: unknown;
  };

  if (env.ok === true) {
    return {
      ok: true,
      result: env.result as T,
      warnings: Array.isArray(env.warnings) ? env.warnings : undefined,
      raw: parsed,
    };
  }

  const rawErr = env.error as { code?: unknown; message?: unknown } | null | undefined;
  return {
    ok: false,
    error: {
      code: rawErr?.code !== undefined ? String(rawErr.code) : 'adapter_error',
      message: rawErr?.message !== undefined ? String(rawErr.message) : '',
    },
    warnings: Array.isArray(env.warnings) ? env.warnings : undefined,
    raw: parsed,
  };
}

export class BrowserBridgeShellRunner implements BrowserBridgeRunner {
  private readonly binaryPath: string | undefined;
  private readonly logger?: (message: string) => void;
  private readonly spawnFn: typeof spawn;

  constructor(opts: BrowserBridgeShellRunnerOptions = {}) {
    this.binaryPath = resolveBridgePath(opts.binaryPath);
    this.logger = opts.logger;
    this.spawnFn = opts.spawnFn ?? spawn;
  }

  async invoke<T = unknown>(args: BrowserBridgeInvokeArgs): Promise<BrowserBridgeResponse<T>> {
    if (!this.binaryPath) {
      return {
        ok: false,
        error: {
          code: 'bridge_path_missing',
          message:
            'browser-bridge path is not set. Pass --bridge <path> or set BROWSER_BRIDGE_PATH.',
        },
      };
    }
    const profile = args.profileName ?? process.env.CANVAS_CLI_PROFILE_NAME ?? DEFAULT_PROFILE_NAME;
    const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const stdin = JSON.stringify(args.input ?? {});
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      BROWSER_BRIDGE_PROFILE_NAME: profile,
    };
    const cliArgs = [this.binaryPath, args.platform, args.action];

    try {
      const { stdout, stderr, code, timedOut } = await runChild(
        this.spawnFn,
        'node',
        cliArgs,
        stdin,
        env,
        timeoutMs,
      );

      if (timedOut) {
        return {
          ok: false,
          error: {
            code: 'timeout',
            message: `browser-bridge timed out after ${timeoutMs}ms`,
          },
        };
      }

      if (stderr.trim()) this.logger?.(`browser-bridge stderr: ${truncate(stderr.trim(), 500)}`);

      const envResponse = parseBrowserBridgeEnvelope<T>(stdout);
      if (code !== 0 && envResponse.ok) {
        return {
          ok: false,
          error: {
            code: 'nonzero_exit',
            message: `browser-bridge exited ${code}`,
          },
          raw: envResponse.raw,
        };
      }
      return envResponse;
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'spawn_error',
          message: (err as Error).message,
        },
      };
    }
  }
}
