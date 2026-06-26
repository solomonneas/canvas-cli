import type {
  BrowserBridgeResponse,
  BrowserBridgeRunner,
} from '../browser-bridge.js';
import { BrowserBridgeShellRunner } from '../browser-bridge.js';
import type {
  CanvasAssignment,
  CanvasCourse,
  CanvasNotification,
} from '../types.js';
import { fail, ok } from './source.js';
import type {
  AssignmentsQuery,
  CanvasSource,
  ListQuery,
  SourceResult,
} from './source.js';

export interface BrowserBridgeSourceOptions {
  bridgePath?: string;
  profileName?: string;
  runner?: BrowserBridgeRunner;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Optional, advanced source that delegates to a user-supplied browser-bridge
 * binary (selected via `--source browser-bridge`). browser-bridge already
 * returns objects shaped like the CLI types, so mapping is a passthrough.
 */
export class BrowserBridgeSource implements CanvasSource {
  private readonly runner: BrowserBridgeRunner;
  private readonly profileName?: string;

  constructor(opts: BrowserBridgeSourceOptions = {}) {
    this.runner =
      opts.runner ?? new BrowserBridgeShellRunner({ binaryPath: opts.bridgePath });
    this.profileName = opts.profileName;
  }

  async listCourses(query: ListQuery): Promise<SourceResult<CanvasCourse[]>> {
    const response = await this.runner.invoke<{ courses?: unknown }>({
      platform: 'canvas',
      action: 'list-courses',
      input: query.limit ? { limit: query.limit } : {},
      profileName: this.profileName,
    });
    return mapResponse(response, (result) => asArray<CanvasCourse>(result?.courses));
  }

  async listAssignments(query: AssignmentsQuery): Promise<SourceResult<CanvasAssignment[]>> {
    const input: Record<string, unknown> = { lookahead_days: query.lookaheadDays };
    if (query.limit) input.limit = query.limit;
    const response = await this.runner.invoke<{ assignments?: unknown }>({
      platform: 'canvas',
      action: 'list-upcoming-assignments',
      input,
      profileName: this.profileName,
    });
    return mapResponse(response, (result) => asArray<CanvasAssignment>(result?.assignments));
  }

  async listNotifications(query: ListQuery): Promise<SourceResult<CanvasNotification[]>> {
    const response = await this.runner.invoke<{ notifications?: unknown }>({
      platform: 'canvas',
      action: 'list-recent-notifications',
      input: query.limit ? { limit: query.limit } : {},
      profileName: this.profileName,
    });
    return mapResponse(response, (result) =>
      asArray<CanvasNotification>(result?.notifications),
    );
  }
}

function mapResponse<R, T>(
  response: BrowserBridgeResponse<R>,
  extract: (result: R | undefined) => T,
): SourceResult<T> {
  if (response.ok) return ok(extract(response.result));
  const code = response.error?.code ?? 'adapter_error';
  const message = response.error?.message ?? '';
  return fail<T>(code, message);
}
