import type {
  CanvasAssignment,
  CanvasCourse,
  CanvasItemView,
  CanvasNotification,
} from './types.js';

/**
 * A minimal HTTP response shape, matching the subset of Playwright's
 * `APIResponse` that this module needs. Keeping it narrow makes the Canvas
 * REST mapping logic fully unit-testable with a plain mock requester, with no
 * live browser involved.
 */
export interface CanvasApiResponse {
  status(): number;
  ok(): boolean;
  /** Header lookup is case-insensitive in HTTP; implementations should honor that. */
  headers(): Record<string, string>;
  json(): Promise<unknown>;
}

/**
 * An injectable GET function. Production wires this to Playwright's
 * `context.request.get`; tests pass a mock that returns canned pages so the
 * mapping + pagination logic can be exercised without a browser or network.
 */
export type CanvasRequester = (url: string) => Promise<CanvasApiResponse>;

export class CanvasAuthError extends Error {
  readonly code = 'auth_required';
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'CanvasAuthError';
    this.status = status;
  }
}

export class CanvasApiError extends Error {
  readonly code = 'api_error';
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'CanvasApiError';
    this.status = status;
  }
}

/** Extract the rel="next" URL from an RFC 5988 Link header, if present. */
export function parseNextLink(linkHeader: string | undefined): string | undefined {
  if (!linkHeader) return undefined;
  for (const part of linkHeader.split(',')) {
    const segments = part.split(';').map((s) => s.trim());
    const urlSegment = segments[0];
    if (!urlSegment) continue;
    const match = urlSegment.match(/^<(.+)>$/);
    if (!match) continue;
    const isNext = segments
      .slice(1)
      .some((rel) => /^rel\s*=\s*"?next"?$/i.test(rel));
    if (isNext) return match[1];
  }
  return undefined;
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

/**
 * Fetch every page of a Canvas list endpoint, following `Link` rel="next".
 * Throws {@link CanvasAuthError} on 401 so callers can prompt for login.
 */
export async function fetchAllPages(
  requester: CanvasRequester,
  startUrl: string,
  maxPages = 50,
): Promise<unknown[]> {
  const items: unknown[] = [];
  let url: string | undefined = startUrl;
  let pages = 0;

  while (url && pages < maxPages) {
    const response: CanvasApiResponse = await requester(url);
    const status = response.status();
    if (status === 401 || status === 403) {
      throw new CanvasAuthError(
        status,
        'Canvas returned an unauthenticated response. Run `canvas-cli login`.',
      );
    }
    if (!response.ok()) {
      throw new CanvasApiError(status, `Canvas API request failed (HTTP ${status}): ${url}`);
    }

    const body = await response.json();
    if (Array.isArray(body)) {
      items.push(...body);
    } else if (body && typeof body === 'object') {
      // Some Canvas endpoints wrap the array in a single key.
      const values = Object.values(body as Record<string, unknown>);
      const firstArray = values.find((value) => Array.isArray(value));
      if (Array.isArray(firstArray)) items.push(...firstArray);
    }

    url = parseNextLink(headerValue(response.headers(), 'link'));
    pages += 1;
  }

  return items;
}

// ---------------------------------------------------------------------------
// Raw Canvas REST shapes (only the fields this CLI consumes).
// ---------------------------------------------------------------------------

interface RawEnrollment {
  type?: string;
  role?: string;
  enrollment_state?: string;
}

interface RawCourse {
  id?: number | string;
  name?: string;
  course_code?: string;
  term?: { name?: string } | null;
  enrollment_term_id?: number | string;
  enrollments?: RawEnrollment[];
  access_restricted_by_date?: boolean;
}

interface RawSubmission {
  workflow_state?: string;
  submitted_at?: string | null;
  score?: number | null;
  missing?: boolean;
}

interface RawAssignment {
  id?: number | string;
  name?: string;
  due_at?: string | null;
  points_possible?: number | null;
  html_url?: string;
  submission?: RawSubmission | null;
}

interface RawAnnouncement {
  id?: number | string;
  title?: string;
  message?: string;
  posted_at?: string | null;
  created_at?: string | null;
  html_url?: string;
  context_code?: string;
  read_state?: string;
}

// ---------------------------------------------------------------------------
// Mappers: raw Canvas REST -> existing CLI types.
// ---------------------------------------------------------------------------

function roleFromEnrollments(enrollments: RawEnrollment[] | undefined): string | undefined {
  const enrollment = enrollments?.[0];
  if (!enrollment) return undefined;
  // Canvas enrollment types look like "StudentEnrollment"; strip the suffix.
  const type = enrollment.type?.replace(/Enrollment$/, '').toLowerCase();
  return enrollment.role ?? type ?? undefined;
}

export function mapCourse(raw: RawCourse, baseUrl: string): CanvasCourse {
  const id = raw.id !== undefined ? String(raw.id) : '';
  return {
    course_id: id,
    code: raw.course_code ?? '',
    name: raw.name ?? '',
    term: raw.term?.name ?? null,
    role: roleFromEnrollments(raw.enrollments),
    url: id ? `${baseUrl}/courses/${id}` : '',
  };
}

/** Courses with no usable name/id (e.g. restricted by date) are dropped. */
export function mapCourses(raw: unknown[], baseUrl: string): CanvasCourse[] {
  return (raw as RawCourse[])
    .filter((course) => course && !course.access_restricted_by_date && course.id !== undefined)
    .map((course) => mapCourse(course, baseUrl));
}

function submissionStatus(submission: RawSubmission | null | undefined): string {
  if (!submission) return 'unknown';
  if (submission.missing) return 'missing';
  const state = submission.workflow_state;
  if (!state || state === 'unsubmitted') return 'not_submitted';
  return state;
}

export function mapAssignment(
  raw: RawAssignment,
  course: { course_id: string; code: string; name?: string },
  baseUrl: string,
): CanvasAssignment {
  const id = raw.id !== undefined ? String(raw.id) : '';
  const dueAt = raw.due_at ?? null;
  return {
    assignment_id: id,
    course_id: course.course_id,
    course_code: course.code,
    course_name: course.name,
    kind: 'assignment',
    title: raw.name ?? '',
    due_at: dueAt,
    due_at_local: dueAt ? formatLocal(dueAt) : '',
    points_possible: raw.points_possible ?? null,
    submission_status: submissionStatus(raw.submission),
    url: raw.html_url ?? (id && course.course_id ? `${baseUrl}/courses/${course.course_id}/assignments/${id}` : ''),
  };
}

/**
 * Keep only assignments due within `lookaheadDays` from `now` (assignments
 * with no due date are always kept), sorted by due date ascending.
 */
export function filterUpcomingAssignments(
  assignments: CanvasAssignment[],
  lookaheadDays: number,
  now: Date = new Date(),
): CanvasAssignment[] {
  const horizon = now.getTime() + lookaheadDays * 24 * 60 * 60 * 1000;
  const start = now.getTime();
  return assignments
    .filter((assignment) => {
      if (!assignment.due_at) return true;
      const due = Date.parse(assignment.due_at);
      if (Number.isNaN(due)) return true;
      return due >= start && due <= horizon;
    })
    .sort((a, b) => {
      const da = a.due_at ? Date.parse(a.due_at) : Number.POSITIVE_INFINITY;
      const db = b.due_at ? Date.parse(b.due_at) : Number.POSITIVE_INFINITY;
      return da - db;
    });
}

export function mapAnnouncement(
  raw: RawAnnouncement,
  course: { course_id: string; code: string; name: string },
): CanvasNotification {
  const id = raw.id !== undefined ? String(raw.id) : '';
  const labels = raw.read_state === 'unread' ? ['unread'] : [];
  return {
    notification_id: id,
    course_id: course.course_id,
    course_code: course.code,
    course_name: course.name,
    kind: 'announcement',
    title: raw.title ?? '',
    summary: stripHtml(raw.message ?? ''),
    url: raw.html_url ?? '',
    posted_at: raw.posted_at ?? raw.created_at ?? null,
    labels,
  };
}

export function combineItems(
  assignments: CanvasAssignment[],
  notifications: CanvasNotification[],
): CanvasItemView {
  return { assignments, notifications };
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

/** Render an ISO timestamp in the host's local timezone for human output. */
export function formatLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Collapse HTML to a single line of readable text. */
export function stripHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildCoursesUrl(baseUrl: string): string {
  return `${baseUrl}/api/v1/courses?enrollment_state=active&include[]=term&per_page=100`;
}

export function buildAssignmentsUrl(baseUrl: string, courseId: string): string {
  return `${baseUrl}/api/v1/courses/${courseId}/assignments?include[]=submission&per_page=100`;
}

export function buildAnnouncementsUrl(baseUrl: string, courseIds: string[]): string {
  const params = courseIds.map((id) => `context_codes[]=course_${encodeURIComponent(id)}`).join('&');
  return `${baseUrl}/api/v1/announcements?${params}&per_page=100`;
}

export function buildSelfUrl(baseUrl: string): string {
  return `${baseUrl}/api/v1/users/self`;
}

/** Normalize a base URL: trim trailing slashes. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}
