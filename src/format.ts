import type { CanvasAssignment, CanvasCourse, CanvasItemView, CanvasNotification } from './types.js';

function truncateText(value: string, max = 92): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

export function formatCourses(courses: CanvasCourse[]): string[] {
  if (courses.length === 0) return ['No Canvas courses found.'];
  return courses.flatMap((course) => {
    const term = course.term ? ` (${course.term})` : '';
    const role = course.role ? ` [${course.role}]` : '';
    const lines = [`${course.code || course.course_id}${term}${role} - ${course.name}`];
    if (course.url) lines.push(`  ${course.url}`);
    return lines;
  });
}

export function formatAssignments(assignments: CanvasAssignment[]): string[] {
  if (assignments.length === 0) return ['No upcoming Canvas assignments found.'];
  return assignments.flatMap((assignment) => {
    const due = assignment.due_at_local || assignment.due_at || 'no due date';
    const points =
      assignment.points_possible === null ? '' : ` - ${assignment.points_possible} pts`;
    const lines = [
      `${due} - ${assignment.course_code} - ${assignment.title}${points} - ${assignment.submission_status}`,
    ];
    if (assignment.url) lines.push(`  ${assignment.url}`);
    return lines;
  });
}

export function formatNotifications(notifications: CanvasNotification[]): string[] {
  if (notifications.length === 0) return ['No recent Canvas notifications found.'];
  return notifications.flatMap((notification) => {
    const posted = notification.posted_at ?? 'unknown date';
    const labels =
      notification.labels.length > 0 ? ` [${notification.labels.join(', ')}]` : '';
    const lines = [
      `${posted} - ${notification.course_code} - ${notification.kind} - ${notification.title}${labels}`,
    ];
    if (notification.summary) lines.push(`  ${truncateText(notification.summary)}`);
    if (notification.url) lines.push(`  ${notification.url}`);
    return lines;
  });
}

export function formatItems(view: CanvasItemView): string[] {
  const items = [
    ...view.assignments.map((assignment) => ({
      sort: assignment.due_at ?? '',
      line:
        `${assignment.due_at_local || assignment.due_at || 'no due date'} - ` +
        `${assignment.course_code} - assignment - ${assignment.title} - ` +
        `${assignment.submission_status}`,
      url: assignment.url,
    })),
    ...view.notifications.map((notification) => ({
      sort: notification.posted_at ?? '',
      line:
        `${notification.posted_at ?? 'unknown date'} - ${notification.course_code} - ` +
        `${notification.kind} - ${notification.title}`,
      url: notification.url,
    })),
  ].sort((a, b) => a.sort.localeCompare(b.sort));

  if (items.length === 0) return ['No Canvas items found.'];
  return items.flatMap((item) => (item.url ? [item.line, `  ${item.url}`] : [item.line]));
}
