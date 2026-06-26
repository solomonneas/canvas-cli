import { describe, expect, test } from 'vitest';
import { runCanvasCommand } from '../src/commands.js';
import { makeIo, makeRunner } from './helpers.js';

describe('runCanvasCommand (browser-bridge runner injection)', () => {
  test('lists Canvas courses with profile and limit', async () => {
    const { runner, calls } = makeRunner({
      'list-courses': {
        ok: true,
        result: {
          courses: [
            {
              course_id: '1',
              code: 'CS101',
              name: 'Intro to Computer Science',
              term: 'Fall 2026',
              role: 'student',
              url: 'https://canvas.test/courses/1',
            },
          ],
        },
      },
    });
    const io = makeIo();

    const code = await runCanvasCommand(
      ['courses', 'list', '--profile', 'school', '--limit', '3'],
      { runner, io },
    );

    expect(code).toBe(0);
    expect(calls).toEqual([
      {
        platform: 'canvas',
        action: 'list-courses',
        input: { limit: 3 },
        profileName: 'school',
      },
    ]);
    expect(io.stdoutLines.join('\n')).toContain(
      'CS101 (Fall 2026) [student] - Intro to Computer Science',
    );
  });

  test('lists assignments as JSON with lookahead and limit', async () => {
    const { runner, calls } = makeRunner({
      'list-upcoming-assignments': {
        ok: true,
        result: {
          assignments: [
            {
              assignment_id: 'a1',
              course_id: '1',
              course_code: 'CS101',
              kind: 'assignment',
              title: 'Project Proposal',
              due_at: '2026-06-30T03:55:00Z',
              due_at_local: 'Mon Jun 29, 11:55 PM',
              points_possible: 100,
              submission_status: 'not_submitted',
              url: 'https://canvas.test/a1',
            },
          ],
        },
      },
    });
    const io = makeIo();

    const code = await runCanvasCommand(
      ['assignments', 'list', '--source', 'browser-bridge', '--json', '--lookahead', '21', '--limit', '5'],
      { runner, io },
    );

    expect(code).toBe(0);
    expect(calls[0]).toMatchObject({
      platform: 'canvas',
      action: 'list-upcoming-assignments',
      input: { lookahead_days: 21, limit: 5 },
      profileName: 'default',
    });
    const parsed = JSON.parse(io.stdoutLines.join('\n')) as Array<{ title: string }>;
    expect(parsed[0]?.title).toBe('Project Proposal');
  });

  test('lists notifications in text form', async () => {
    const { runner } = makeRunner({
      'list-recent-notifications': {
        ok: true,
        result: {
          notifications: [
            {
              notification_id: 'n1',
              course_id: '1',
              course_code: 'CS101',
              course_name: 'Intro to Computer Science',
              kind: 'announcement',
              title: 'Office hours moved',
              summary: 'Tonight only.',
              url: 'https://canvas.test/n1',
              posted_at: '2026-06-24T12:00:00Z',
              labels: ['unread'],
            },
          ],
        },
      },
    });
    const io = makeIo();

    const code = await runCanvasCommand(['notifications', 'list'], { runner, io });

    expect(code).toBe(0);
    expect(io.stdoutLines.join('\n')).toContain(
      '2026-06-24T12:00:00Z - CS101 - announcement - Office hours moved [unread]',
    );
    expect(io.stdoutLines.join('\n')).toContain('Tonight only.');
  });

  test('items list combines assignments and notifications', async () => {
    const { runner, calls } = makeRunner({
      'list-upcoming-assignments': {
        ok: true,
        result: {
          assignments: [
            {
              assignment_id: 'a1',
              course_id: '1',
              course_code: 'CS101',
              kind: 'assignment',
              title: 'Module Quiz',
              due_at: '2026-06-25T03:55:00Z',
              due_at_local: 'Wed Jun 24, 11:55 PM',
              points_possible: 20,
              submission_status: 'submitted',
              url: '',
            },
          ],
        },
      },
      'list-recent-notifications': {
        ok: true,
        result: {
          notifications: [
            {
              notification_id: 'n1',
              course_id: '1',
              course_code: 'CS101',
              course_name: 'Intro to Computer Science',
              kind: 'announcement',
              title: 'Office hours moved',
              summary: 'Tonight only.',
              url: '',
              posted_at: '2026-06-24T12:00:00Z',
              labels: [],
            },
          ],
        },
      },
    });
    const io = makeIo();

    const code = await runCanvasCommand(['items', 'list', '--limit', '2'], { runner, io });

    expect(code).toBe(0);
    expect(calls.map((call) => call.action)).toEqual([
      'list-upcoming-assignments',
      'list-recent-notifications',
    ]);
    expect(calls[0]?.input).toEqual({ lookahead_days: 14, limit: 2 });
    expect(calls[1]?.input).toEqual({ limit: 2 });
    expect(io.stdoutLines.join('\n')).toContain('Module Quiz');
    expect(io.stdoutLines.join('\n')).toContain('Office hours moved');
  });

  test('status checks Canvas reachability without printing course data', async () => {
    const { runner, calls } = makeRunner({
      'list-courses': {
        ok: true,
        result: {
          courses: [
            {
              course_id: '1',
              code: 'CS101',
              name: 'Intro to Computer Science',
              term: 'Fall 2026',
              url: 'https://canvas.test/courses/1',
            },
          ],
        },
      },
    });
    const io = makeIo();

    const code = await runCanvasCommand(['status', '--profile', 'school'], { runner, io });

    expect(code).toBe(0);
    expect(calls).toEqual([
      {
        platform: 'canvas',
        action: 'list-courses',
        input: { limit: 1 },
        profileName: 'school',
      },
    ]);
    expect(io.stdoutLines.join('\n')).toBe('Canvas is reachable for profile "school".');
  });

  test('status surfaces missing auth with a login hint', async () => {
    const { runner } = makeRunner({
      'list-courses': {
        ok: false,
        error: { code: 'auth_required', message: 'Canvas API 401: Unauthorized' },
      },
    });
    const io = makeIo();

    const code = await runCanvasCommand(['status', '--json'], { runner, io });

    expect(code).toBe(2);
    const parsed = JSON.parse(io.stdoutLines.join('\n')) as {
      ok: boolean;
      message: string;
      error?: { code: string };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe('auth_required');
    expect(parsed.message).toContain('canvas-cli login');
  });

  test('reports failure when adapter fails', async () => {
    const { runner } = makeRunner({
      'list-recent-notifications': {
        ok: false,
        error: { code: 'profile_locked', message: 'profile is locked' },
      },
    });
    const io = makeIo();

    const code = await runCanvasCommand(['notifications', 'list'], { runner, io });

    expect(code).toBe(2);
    expect(io.stderrLines.join('\n')).toContain(
      'canvas-cli: notifications failed profile_locked: profile is locked',
    );
  });

  test('returns usage status for unknown command shape', async () => {
    const { runner } = makeRunner({});
    const io = makeIo();

    const code = await runCanvasCommand(['grades', 'list'], { runner, io });

    expect(code).toBe(64);
    expect(io.stderrLines.join('\n')).toContain('Usage: canvas-cli');
  });
});

describe('runCanvasCommand (playwright source config)', () => {
  test('errors when base URL missing for playwright source', async () => {
    const io = makeIo();
    const code = await runCanvasCommand(['courses', 'list'], { io });
    expect(code).toBe(64);
    expect(io.stderrLines.join('\n')).toContain('CANVAS_BASE_URL is required');
  });

  test('login errors without a base URL', async () => {
    const io = makeIo();
    const code = await runCanvasCommand(['login'], { io });
    expect(code).toBe(64);
    expect(io.stderrLines.join('\n')).toContain('CANVAS_BASE_URL is required');
  });
});
