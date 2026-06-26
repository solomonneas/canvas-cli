import { describe, expect, test } from 'vitest';
import type { CanvasApiResponse, CanvasRequester } from '../src/canvas-api.js';
import { runCanvasCommand } from '../src/commands.js';
import { PlaywrightSource } from '../src/sources/playwright-source.js';
import { makeIo } from './helpers.js';

const BASE = 'https://your-school.instructure.com';

function jsonResponse(
  body: unknown,
  headers: Record<string, string> = {},
  status = 200,
): CanvasApiResponse {
  return {
    status: () => status,
    ok: () => status >= 200 && status < 300,
    headers: () => headers,
    json: async () => body,
  };
}

/** Route requests by which Canvas endpoint they hit. */
function routedRequester(routes: {
  courses?: unknown;
  assignmentsByCourse?: Record<string, unknown>;
  announcements?: unknown;
  status?: number;
}): CanvasRequester {
  return async (url: string): Promise<CanvasApiResponse> => {
    if (routes.status && routes.status !== 200) return jsonResponse({}, {}, routes.status);
    if (url.includes('/api/v1/courses?')) return jsonResponse(routes.courses ?? []);
    const assignMatch = url.match(/\/api\/v1\/courses\/([^/]+)\/assignments/);
    if (assignMatch) {
      const id = assignMatch[1];
      return jsonResponse(routes.assignmentsByCourse?.[id] ?? []);
    }
    if (url.includes('/api/v1/announcements')) return jsonResponse(routes.announcements ?? []);
    throw new Error(`unexpected url: ${url}`);
  };
}

function makeSource(routes: Parameters<typeof routedRequester>[0]): PlaywrightSource {
  const source = new PlaywrightSource({ baseUrl: BASE, profileName: 'test' });
  source.setRequester(routedRequester(routes));
  return source;
}

describe('PlaywrightSource (injected requester, no browser)', () => {
  test('lists courses mapped from the REST API', async () => {
    const source = makeSource({
      courses: [
        {
          id: 1,
          name: 'Intro to Computer Science',
          course_code: 'CS101',
          term: { name: 'Fall 2026' },
          enrollments: [{ type: 'StudentEnrollment' }],
        },
      ],
    });
    const result = await source.listCourses({});
    expect(result.ok).toBe(true);
    expect(result.value?.[0]).toMatchObject({
      course_id: '1',
      code: 'CS101',
      url: `${BASE}/courses/1`,
    });
  });

  test('lists upcoming assignments across courses, filtered by lookahead', async () => {
    const now = Date.now();
    const soon = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString();
    const far = new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString();
    const source = makeSource({
      courses: [{ id: 1, name: 'CS', course_code: 'CS101' }],
      assignmentsByCourse: {
        '1': [
          { id: 10, name: 'Soon', due_at: soon, submission: { workflow_state: 'unsubmitted' } },
          { id: 11, name: 'Far', due_at: far },
        ],
      },
    });
    const result = await source.listAssignments({ lookaheadDays: 14 });
    expect(result.ok).toBe(true);
    expect(result.value?.map((a) => a.title)).toEqual(['Soon']);
    expect(result.value?.[0]?.submission_status).toBe('not_submitted');
  });

  test('lists announcements joined back to their course', async () => {
    const source = makeSource({
      courses: [{ id: 1, name: 'Networks', course_code: 'NET200' }],
      announcements: [
        {
          id: 5,
          title: 'Welcome',
          message: '<p>Read the syllabus.</p>',
          posted_at: '2026-06-20T00:00:00Z',
          context_code: 'course_1',
          read_state: 'unread',
        },
      ],
    });
    const result = await source.listNotifications({});
    expect(result.ok).toBe(true);
    expect(result.value?.[0]).toMatchObject({
      course_code: 'NET200',
      title: 'Welcome',
      summary: 'Read the syllabus.',
      labels: ['unread'],
    });
  });

  test('reports auth_required on 401', async () => {
    const source = makeSource({ status: 401 });
    const result = await source.listCourses({});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('auth_required');
  });

  test('applies a limit to courses', async () => {
    const source = makeSource({
      courses: [
        { id: 1, course_code: 'A', name: 'A' },
        { id: 2, course_code: 'B', name: 'B' },
        { id: 3, course_code: 'C', name: 'C' },
      ],
    });
    const result = await source.listCourses({ limit: 2 });
    expect(result.value).toHaveLength(2);
  });
});

describe('runCanvasCommand with injected playwright source', () => {
  test('courses list --json emits mapped course array', async () => {
    const source = makeSource({
      courses: [{ id: 1, name: 'Intro', course_code: 'CS101' }],
    });
    const io = makeIo();
    const code = await runCanvasCommand(['courses', 'list', '--json'], { source, io });
    expect(code).toBe(0);
    const parsed = JSON.parse(io.stdoutLines.join('\n')) as Array<{ code: string }>;
    expect(parsed[0]?.code).toBe('CS101');
  });

  test('status reports reachable through a playwright source', async () => {
    const source = makeSource({ courses: [{ id: 1, course_code: 'CS101', name: 'Intro' }] });
    const io = makeIo();
    const code = await runCanvasCommand(['status'], { source, io });
    expect(code).toBe(0);
    expect(io.stdoutLines.join('\n')).toContain('Canvas is reachable');
  });
});
