import { mkdirSync } from 'node:fs';
import type { BrowserContext } from 'playwright';
import {
  buildAnnouncementsUrl,
  buildAssignmentsUrl,
  buildCoursesUrl,
  CanvasApiError,
  CanvasAuthError,
  combineItems,
  fetchAllPages,
  filterUpcomingAssignments,
  mapAnnouncement,
  mapAssignment,
  mapCourses,
  normalizeBaseUrl,
} from '../canvas-api.js';
import type { CanvasApiResponse, CanvasRequester } from '../canvas-api.js';
import { resolveProfileDir } from '../profile.js';
import type {
  CanvasAssignment,
  CanvasCourse,
  CanvasItemView,
  CanvasNotification,
} from '../types.js';
import { fail, ok } from './source.js';
import type {
  AssignmentsQuery,
  CanvasSource,
  ListQuery,
  SourceResult,
} from './source.js';

export interface PlaywrightSourceOptions {
  baseUrl: string;
  profileName?: string;
  profileDir?: string;
}

/**
 * Data source backed by a persistent Playwright (Chromium) profile.
 *
 * Authentication is a one-time, headed `canvas-cli login`: the user completes
 * their school's SSO in a real browser and the session cookies persist in the
 * profile directory. All subsequent commands run headless, reusing those
 * cookies to call Canvas's REST API directly (`/api/v1/...`), which accepts
 * session-cookie auth, no personal access token required.
 *
 * The HTTP-level mapping/pagination logic lives in `canvas-api.ts` behind an
 * injectable {@link CanvasRequester}, so it is unit-testable without a browser.
 */
export class PlaywrightSource implements CanvasSource {
  private readonly baseUrl: string;
  private readonly profileDir: string;
  private context: BrowserContext | null = null;
  private requesterOverride?: CanvasRequester;

  constructor(opts: PlaywrightSourceOptions) {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.profileDir = opts.profileDir ?? resolveProfileDir(opts.profileName ?? 'default');
  }

  /** Inject a requester for tests; bypasses launching a browser entirely. */
  setRequester(requester: CanvasRequester): void {
    this.requesterOverride = requester;
  }

  private async requester(): Promise<CanvasRequester> {
    if (this.requesterOverride) return this.requesterOverride;
    const context = await this.ensureContext();
    return async (url: string): Promise<CanvasApiResponse> => {
      const response = await context.request.get(url, {
        headers: { Accept: 'application/json' },
        failOnStatusCode: false,
      });
      return {
        status: () => response.status(),
        ok: () => response.ok(),
        headers: () => response.headers(),
        json: () => response.json(),
      };
    };
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    mkdirSync(this.profileDir, { recursive: true });
    // Import lazily so unit tests that inject a requester never load Playwright.
    const { chromium } = await import('playwright');
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless: true,
    });
    return this.context;
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }

  async listCourses(query: ListQuery): Promise<SourceResult<CanvasCourse[]>> {
    try {
      const requester = await this.requester();
      const courses = await this.fetchCourses(requester);
      return ok(applyLimit(courses, query.limit));
    } catch (err) {
      return this.toError(err);
    }
  }

  async listAssignments(query: AssignmentsQuery): Promise<SourceResult<CanvasAssignment[]>> {
    try {
      const requester = await this.requester();
      const courses = await this.fetchCourses(requester);
      const all: CanvasAssignment[] = [];
      for (const course of courses) {
        const raw = await fetchAllPages(
          requester,
          buildAssignmentsUrl(this.baseUrl, course.course_id),
        );
        for (const item of raw) {
          all.push(
            mapAssignment(
              item as Record<string, unknown>,
              { course_id: course.course_id, code: course.code, name: course.name },
              this.baseUrl,
            ),
          );
        }
      }
      const upcoming = filterUpcomingAssignments(all, query.lookaheadDays);
      return ok(applyLimit(upcoming, query.limit));
    } catch (err) {
      return this.toError(err);
    }
  }

  async listNotifications(query: ListQuery): Promise<SourceResult<CanvasNotification[]>> {
    try {
      const requester = await this.requester();
      const courses = await this.fetchCourses(requester);
      const notifications = await this.fetchAnnouncements(requester, courses);
      return ok(applyLimit(notifications, query.limit));
    } catch (err) {
      return this.toError(err);
    }
  }

  /** Combined view used by `items list`; fetches both feeds with one course pass. */
  async listItems(query: AssignmentsQuery): Promise<SourceResult<CanvasItemView>> {
    try {
      const requester = await this.requester();
      const courses = await this.fetchCourses(requester);
      const all: CanvasAssignment[] = [];
      for (const course of courses) {
        const raw = await fetchAllPages(
          requester,
          buildAssignmentsUrl(this.baseUrl, course.course_id),
        );
        for (const item of raw) {
          all.push(
            mapAssignment(
              item as Record<string, unknown>,
              { course_id: course.course_id, code: course.code, name: course.name },
              this.baseUrl,
            ),
          );
        }
      }
      const upcoming = applyLimit(filterUpcomingAssignments(all, query.lookaheadDays), query.limit);
      const notifications = applyLimit(
        await this.fetchAnnouncements(requester, courses),
        query.limit,
      );
      return ok(combineItems(upcoming, notifications));
    } catch (err) {
      return this.toError(err);
    }
  }

  private async fetchCourses(requester: CanvasRequester): Promise<CanvasCourse[]> {
    const raw = await fetchAllPages(requester, buildCoursesUrl(this.baseUrl));
    return mapCourses(raw, this.baseUrl);
  }

  private async fetchAnnouncements(
    requester: CanvasRequester,
    courses: CanvasCourse[],
  ): Promise<CanvasNotification[]> {
    if (courses.length === 0) return [];
    const byContext = new Map<string, CanvasCourse>();
    for (const course of courses) byContext.set(`course_${course.course_id}`, course);

    const raw = await fetchAllPages(
      requester,
      buildAnnouncementsUrl(
        this.baseUrl,
        courses.map((course) => course.course_id),
      ),
    );
    const notifications = (raw as Array<Record<string, unknown>>).map((item) => {
      const contextCode = typeof item.context_code === 'string' ? item.context_code : '';
      const course = byContext.get(contextCode);
      return mapAnnouncement(item, {
        course_id: course?.course_id ?? '',
        code: course?.code ?? '',
        name: course?.name ?? '',
      });
    });
    notifications.sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? ''));
    return notifications;
  }

  private toError<T>(err: unknown): SourceResult<T> {
    if (err instanceof CanvasAuthError) {
      return fail<T>('auth_required', err.message);
    }
    if (err instanceof CanvasApiError) {
      return fail<T>('api_error', err.message);
    }
    return fail<T>('source_error', (err as Error).message);
  }
}

function applyLimit<T>(items: T[], limit?: number): T[] {
  if (limit && limit > 0) return items.slice(0, limit);
  return items;
}
