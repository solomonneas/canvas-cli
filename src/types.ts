export interface CanvasCourse {
  course_id: string;
  code: string;
  name: string;
  term: string | null;
  role?: string;
  url: string;
}

export interface CanvasAssignment {
  assignment_id: string;
  course_id: string;
  course_code: string;
  course_name?: string;
  kind: string;
  title: string;
  due_at: string | null;
  due_at_local: string;
  points_possible: number | null;
  submission_status: string;
  url: string;
  labels?: string[];
}

export interface CanvasNotification {
  notification_id: string;
  course_id: string;
  course_code: string;
  course_name: string;
  kind: string;
  title: string;
  summary: string;
  url: string;
  posted_at: string | null;
  labels: string[];
}

export interface CanvasItemView {
  assignments: CanvasAssignment[];
  notifications: CanvasNotification[];
}

export interface CanvasStatus {
  ok: boolean;
  profile: string;
  message: string;
  error?: {
    code: string;
    message: string;
  };
}

export type CanvasSourceKind = 'playwright' | 'browser-bridge';

export interface CanvasCommandFlags {
  json: boolean;
  lookahead: number;
  limit?: number;
  /** Persistent-profile name (playwright) or browser-bridge profile name. */
  profileName: string;
  /** Selected backend; defaults to playwright. */
  source: CanvasSourceKind;
  /** Canvas instance base URL (playwright source). */
  baseUrl?: string;
  /** Path to a user-supplied browser-bridge binary (browser-bridge source). */
  bridgePath?: string;
}

export type CanvasSection =
  | 'courses'
  | 'assignments'
  | 'notifications'
  | 'items'
  | 'status'
  | 'login';

export interface CommandIo {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}
