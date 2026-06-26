import { describe, expect, test } from 'vitest';
import {
  buildAnnouncementsUrl,
  buildAssignmentsUrl,
  buildCoursesUrl,
  CanvasAuthError,
  fetchAllPages,
  filterUpcomingAssignments,
  mapAnnouncement,
  mapAssignment,
  mapCourse,
  mapCourses,
  parseNextLink,
  stripHtml,
} from '../src/canvas-api.js';
import type { CanvasApiResponse, CanvasRequester } from '../src/canvas-api.js';

const BASE = 'https://your-school.instructure.com';

function jsonResponse(
  body: unknown,
  opts: { status?: number; headers?: Record<string, string> } = {},
): CanvasApiResponse {
  const status = opts.status ?? 200;
  return {
    status: () => status,
    ok: () => status >= 200 && status < 300,
    headers: () => opts.headers ?? {},
    json: async () => body,
  };
}

/** Build a requester that serves a scripted sequence of responses by URL. */
function scriptedRequester(pages: Array<{ url: string; response: CanvasApiResponse }>): {
  requester: CanvasRequester;
  urls: string[];
} {
  const urls: string[] = [];
  let index = 0;
  const requester: CanvasRequester = async (url) => {
    urls.push(url);
    const page = pages[index];
    index += 1;
    if (!page) throw new Error(`unexpected request #${index}: ${url}`);
    return page.response;
  };
  return { requester, urls };
}

describe('parseNextLink', () => {
  test('extracts rel="next" target', () => {
    const header =
      '<https://x/api?page=1>; rel="current", <https://x/api?page=2>; rel="next", <https://x/api?page=9>; rel="last"';
    expect(parseNextLink(header)).toBe('https://x/api?page=2');
  });

  test('returns undefined when no next link', () => {
    expect(parseNextLink('<https://x/api?page=9>; rel="last"')).toBeUndefined();
    expect(parseNextLink(undefined)).toBeUndefined();
    expect(parseNextLink('')).toBeUndefined();
  });
});

describe('fetchAllPages', () => {
  test('follows Link rel="next" across pages and concatenates arrays', async () => {
    const { requester, urls } = scriptedRequester([
      {
        url: 'page1',
        response: jsonResponse([{ id: 1 }, { id: 2 }], {
          headers: { Link: '<https://api/p2>; rel="next"' },
        }),
      },
      {
        url: 'page2',
        response: jsonResponse([{ id: 3 }], { headers: {} }),
      },
    ]);

    const items = await fetchAllPages(requester, 'https://api/p1');
    expect(items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(urls).toEqual(['https://api/p1', 'https://api/p2']);
  });

  test('honors case-insensitive link header', async () => {
    const { requester } = scriptedRequester([
      {
        url: 'p1',
        response: jsonResponse([{ id: 1 }], { headers: { link: '<https://api/p2>; rel="next"' } }),
      },
      { url: 'p2', response: jsonResponse([{ id: 2 }]) },
    ]);
    const items = await fetchAllPages(requester, 'https://api/p1');
    expect(items).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test('stops after maxPages to avoid runaway pagination', async () => {
    let calls = 0;
    const requester: CanvasRequester = async () => {
      calls += 1;
      return jsonResponse([{ id: calls }], { headers: { Link: '<https://api/next>; rel="next"' } });
    };
    const items = await fetchAllPages(requester, 'https://api/start', 3);
    expect(items).toHaveLength(3);
    expect(calls).toBe(3);
  });

  test('throws CanvasAuthError on 401', async () => {
    const requester: CanvasRequester = async () => jsonResponse({}, { status: 401 });
    await expect(fetchAllPages(requester, 'https://api/start')).rejects.toBeInstanceOf(
      CanvasAuthError,
    );
  });
});

describe('mapCourse / mapCourses', () => {
  test('maps a raw course to the CLI shape', () => {
    const course = mapCourse(
      {
        id: 42,
        name: 'Intro to Computer Science',
        course_code: 'CS101',
        term: { name: 'Fall 2026' },
        enrollments: [{ type: 'StudentEnrollment', enrollment_state: 'active' }],
      },
      BASE,
    );
    expect(course).toEqual({
      course_id: '42',
      code: 'CS101',
      name: 'Intro to Computer Science',
      term: 'Fall 2026',
      role: 'student',
      url: `${BASE}/courses/42`,
    });
  });

  test('drops date-restricted and id-less courses', () => {
    const mapped = mapCourses(
      [
        { id: 1, name: 'Real', course_code: 'R1' },
        { access_restricted_by_date: true, id: 2 },
        { name: 'No id' },
      ],
      BASE,
    );
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.course_id).toBe('1');
  });
});

describe('mapAssignment', () => {
  const course = { course_id: '1', code: 'CS101', name: 'Intro to Computer Science' };

  test('maps submission workflow_state to submission_status', () => {
    const a = mapAssignment(
      {
        id: 7,
        name: 'Project Proposal',
        due_at: '2026-07-01T03:55:00Z',
        points_possible: 100,
        html_url: `${BASE}/courses/1/assignments/7`,
        submission: { workflow_state: 'submitted' },
      },
      course,
      BASE,
    );
    expect(a).toMatchObject({
      assignment_id: '7',
      course_id: '1',
      course_code: 'CS101',
      kind: 'assignment',
      title: 'Project Proposal',
      due_at: '2026-07-01T03:55:00Z',
      points_possible: 100,
      submission_status: 'submitted',
      url: `${BASE}/courses/1/assignments/7`,
    });
    expect(a.due_at_local).not.toBe('');
  });

  test('treats unsubmitted/no submission as not_submitted/unknown', () => {
    expect(
      mapAssignment({ id: 1, submission: { workflow_state: 'unsubmitted' } }, course, BASE)
        .submission_status,
    ).toBe('not_submitted');
    expect(mapAssignment({ id: 2 }, course, BASE).submission_status).toBe('unknown');
    expect(
      mapAssignment({ id: 3, submission: { missing: true } }, course, BASE).submission_status,
    ).toBe('missing');
  });

  test('synthesizes a URL when html_url is absent', () => {
    const a = mapAssignment({ id: 9 }, course, BASE);
    expect(a.url).toBe(`${BASE}/courses/1/assignments/9`);
  });
});

describe('filterUpcomingAssignments', () => {
  const now = new Date('2026-06-25T00:00:00Z');
  const make = (id: string, due: string | null) => ({
    assignment_id: id,
    course_id: '1',
    course_code: 'CS101',
    kind: 'assignment',
    title: id,
    due_at: due,
    due_at_local: '',
    points_possible: null,
    submission_status: 'not_submitted',
    url: '',
  });

  test('keeps due dates within the window, sorted ascending, keeps no-due-date', () => {
    const result = filterUpcomingAssignments(
      [
        make('past', '2026-06-01T00:00:00Z'),
        make('soon', '2026-06-27T00:00:00Z'),
        make('far', '2026-08-01T00:00:00Z'),
        make('later', '2026-07-02T00:00:00Z'),
        make('nodue', null),
      ],
      14,
      now,
    );
    expect(result.map((a) => a.assignment_id)).toEqual(['soon', 'later', 'nodue']);
  });
});

describe('mapAnnouncement', () => {
  test('strips HTML, flags unread, falls back to created_at', () => {
    const n = mapAnnouncement(
      {
        id: 5,
        title: 'Office hours moved',
        message: '<p>Tonight <strong>only</strong>.</p>',
        created_at: '2026-06-24T12:00:00Z',
        html_url: `${BASE}/courses/1/discussion_topics/5`,
        read_state: 'unread',
        context_code: 'course_1',
      },
      { course_id: '1', code: 'CS101', name: 'Intro to Computer Science' },
    );
    expect(n).toMatchObject({
      notification_id: '5',
      course_code: 'CS101',
      kind: 'announcement',
      title: 'Office hours moved',
      summary: 'Tonight only.',
      posted_at: '2026-06-24T12:00:00Z',
      labels: ['unread'],
      url: `${BASE}/courses/1/discussion_topics/5`,
    });
  });
});

describe('stripHtml', () => {
  test('collapses tags and decodes entities', () => {
    expect(stripHtml('<p>Hi&nbsp;there &amp; welcome</p><br>line2')).toBe(
      'Hi there & welcome line2',
    );
  });
});

describe('url builders', () => {
  test('coursesUrl requests active enrollments with term', () => {
    expect(buildCoursesUrl(BASE)).toBe(
      `${BASE}/api/v1/courses?enrollment_state=active&include[]=term&per_page=100`,
    );
  });
  test('assignmentsUrl includes submission', () => {
    expect(buildAssignmentsUrl(BASE, '7')).toBe(
      `${BASE}/api/v1/courses/7/assignments?include[]=submission&per_page=100`,
    );
  });
  test('announcementsUrl encodes context codes', () => {
    expect(buildAnnouncementsUrl(BASE, ['1', '2'])).toBe(
      `${BASE}/api/v1/announcements?context_codes[]=course_1&context_codes[]=course_2&per_page=100`,
    );
  });
});
