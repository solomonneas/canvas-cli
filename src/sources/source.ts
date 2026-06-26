import type {
  CanvasAssignment,
  CanvasCourse,
  CanvasNotification,
} from '../types.js';

export interface SourceError {
  code: string;
  message: string;
}

export interface SourceResult<T> {
  ok: boolean;
  value?: T;
  error?: SourceError;
}

export interface AssignmentsQuery {
  lookaheadDays: number;
  limit?: number;
}

export interface ListQuery {
  limit?: number;
}

/**
 * A backend that can read Canvas data and map it to the CLI's stable types.
 * Both the default Playwright source and the optional browser-bridge source
 * implement this, so the command/output layer never changes.
 */
export interface CanvasSource {
  listCourses(query: ListQuery): Promise<SourceResult<CanvasCourse[]>>;
  listAssignments(query: AssignmentsQuery): Promise<SourceResult<CanvasAssignment[]>>;
  listNotifications(query: ListQuery): Promise<SourceResult<CanvasNotification[]>>;
  /** Optional cleanup (e.g. close the headless browser). */
  close?(): Promise<void>;
}

export function ok<T>(value: T): SourceResult<T> {
  return { ok: true, value };
}

export function fail<T>(code: string, message: string): SourceResult<T> {
  return { ok: false, error: { code, message } };
}
