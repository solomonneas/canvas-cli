import { describe, expect, test } from 'vitest';
import { formatAssignments, formatCourses, formatItems, formatNotifications } from '../src/format.js';

describe('formatters', () => {
  test('formats empty states', () => {
    expect(formatCourses([])).toEqual(['No Canvas courses found.']);
    expect(formatAssignments([])).toEqual(['No upcoming Canvas assignments found.']);
    expect(formatNotifications([])).toEqual(['No recent Canvas notifications found.']);
    expect(formatItems({ assignments: [], notifications: [] })).toEqual(['No Canvas items found.']);
  });

  test('formats item view in chronological order', () => {
    const lines = formatItems({
      assignments: [
        {
          assignment_id: 'a1',
          course_id: '1',
          course_code: 'CS101',
          kind: 'assignment',
          title: 'Later assignment',
          due_at: '2026-06-26T00:00:00Z',
          due_at_local: 'Thu Jun 25, 8:00 PM',
          points_possible: null,
          submission_status: 'not_submitted',
          url: '',
        },
      ],
      notifications: [
        {
          notification_id: 'n1',
          course_id: '1',
          course_code: 'CS101',
          course_name: 'Intro to Computer Science',
          kind: 'announcement',
          title: 'Earlier note',
          summary: '',
          url: '',
          posted_at: '2026-06-24T00:00:00Z',
          labels: [],
        },
      ],
    });

    expect(lines[0]).toContain('Earlier note');
    expect(lines[1]).toContain('Later assignment');
  });
});
