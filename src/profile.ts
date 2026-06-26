import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve the persistent browser-profile directory used to store the logged-in
 * Canvas session. Precedence:
 *   1. CANVAS_CLI_PROFILE_DIR (explicit override)
 *   2. $XDG_DATA_HOME/canvas-cli/profile/<name>
 *   3. ~/.local/share/canvas-cli/profile/<name>
 */
export function resolveProfileDir(profileName = 'default'): string {
  const explicit = process.env.CANVAS_CLI_PROFILE_DIR;
  if (explicit && explicit.trim()) return explicit.trim();

  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && xdg.trim() ? xdg.trim() : join(homedir(), '.local', 'share');
  return join(base, 'canvas-cli', 'profile', profileName);
}

/** Resolve the Canvas base URL from flag or env, normalized. */
export function resolveBaseUrl(flagValue?: string): string | undefined {
  const raw = flagValue ?? process.env.CANVAS_BASE_URL;
  if (!raw || !raw.trim()) return undefined;
  return raw.trim().replace(/\/+$/, '');
}
