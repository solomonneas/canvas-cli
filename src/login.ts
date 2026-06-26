import { mkdirSync } from 'node:fs';
import { buildSelfUrl, normalizeBaseUrl } from './canvas-api.js';
import { resolveProfileDir } from './profile.js';
import type { CommandIo } from './types.js';

export interface LoginOptions {
  baseUrl: string;
  profileName?: string;
  profileDir?: string;
  /** Max time to wait for a successful login before giving up (ms). */
  timeoutMs?: number;
  /** How often to poll `/api/v1/users/self` for authentication (ms). */
  pollIntervalMs?: number;
}

const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

/**
 * Open a headed Chromium window at the Canvas base URL, let the user complete
 * SSO, and poll `/api/v1/users/self` until it returns 200. The session cookies
 * persist in the profile directory, so later headless commands reuse them.
 *
 * Returns 0 on success, non-zero on timeout/error.
 */
export async function runLogin(opts: LoginOptions, io: CommandIo): Promise<number> {
  const baseUrl = normalizeBaseUrl(opts.baseUrl);
  const profileDir = opts.profileDir ?? resolveProfileDir(opts.profileName ?? 'default');
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  mkdirSync(profileDir, { recursive: true });
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    io.stdout(`Opening ${baseUrl} - complete your school's SSO login in the browser window.`);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }).catch(() => {
      /* user navigation/redirects can race the initial goto; ignore */
    });

    const deadline = Date.now() + timeoutMs;
    const selfUrl = buildSelfUrl(baseUrl);
    while (Date.now() < deadline) {
      const authed = await isAuthenticated(context, selfUrl);
      if (authed) {
        io.stdout('Logged in. Session saved; you can now run the list commands.');
        return 0;
      }
      await delay(pollIntervalMs);
    }

    io.stderr(
      'canvas-cli: login timed out. Run `canvas-cli login` again and finish SSO before the window closes.',
    );
    return 2;
  } finally {
    await context.close();
  }
}

async function isAuthenticated(
  context: import('playwright').BrowserContext,
  selfUrl: string,
): Promise<boolean> {
  try {
    const response = await context.request.get(selfUrl, {
      headers: { Accept: 'application/json' },
      failOnStatusCode: false,
    });
    return response.status() === 200;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
