import type {
  Activity,
  Attachment,
  ColorToken,
  List,
  ProjectAccessLevel,
  TaskPriority,
  TaskStatus,
  TaskSummary,
  UserRef
} from "../../contracts/work.js";
import { colorTokens } from "../../contracts/work.js";
import { toIso, toNullableIso } from "../../lib/db-types.js";

const colorSet = new Set<string>(colorTokens);
export const toColor = (value: string | null | undefined, fallback: ColorToken = "slate"): ColorToken =>
  value && colorSet.has(value) ? (value as ColorToken) : fallback;

export type UserRefJson = { id: string; display_name: string; email: string | null; avatar_url: string | null };

export const toUserRef = (row: UserRefJson | null | undefined): UserRef | null =>
  row
    ? { id: row.id, displayName: row.display_name, email: row.email, avatarUrl: row.avatar_url }
    : null;

export type ListRow = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  color: string | null;
  rank: string;
  has_status_override: boolean;
};

export const toList = (row: ListRow): List => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  description: row.description,
  color: row.color ? toColor(row.color) : null,
  rank: row.rank,
  hasStatusOverride: row.has_status_override
});

export type StatusRow = {
  id: string;
  scope: "global" | "project" | "list";
  key: string;
  name: string;
  category: "active" | "done" | "closed";
  color: string;
  is_initial: boolean;
  is_done: boolean;
  position: string | number;
};

export const toStatus = (row: StatusRow): TaskStatus => ({
  id: row.id,
  scope: row.scope,
  key: row.key,
  name: row.name,
  category: row.category,
  color: toColor(row.color),
  isInitial: row.is_initial,
  isDone: row.is_done,
  position: Number(row.position)
});

export type TaskRow = {
  id: string;
  number: string | number;
  project_key: string;
  project_id: string;
  list_id: string;
  parent_task_id: string | null;
  title: string;
  status_id: string;
  status_name: string;
  status_color: string;
  status_category: "active" | "done" | "closed";
  priority: TaskPriority;
  start_at: Date | null;
  due_at: Date | null;
  completed_at: Date | null;
  rank: string;
  assignees: UserRefJson[] | null;
  subtask_count: number;
  open_subtask_count: number;
  comment_count: number;
  attachment_count: number;
  created_at: Date;
  updated_at: Date;
};

export const toTaskSummary = (row: TaskRow): TaskSummary => ({
  id: row.id,
  key: `${row.project_key}-${row.number}`,
  number: Number(row.number),
  projectId: row.project_id,
  listId: row.list_id,
  parentTaskId: row.parent_task_id,
  title: row.title,
  status: {
    id: row.status_id,
    name: row.status_name,
    color: toColor(row.status_color),
    category: row.status_category
  },
  priority: row.priority,
  startAt: toNullableIso(row.start_at),
  dueAt: toNullableIso(row.due_at),
  completedAt: toNullableIso(row.completed_at),
  rank: row.rank,
  assignees: (row.assignees ?? []).map((user) => toUserRef(user)!),
  subtaskCount: Number(row.subtask_count),
  openSubtaskCount: Number(row.open_subtask_count),
  commentCount: Number(row.comment_count),
  attachmentCount: Number(row.attachment_count),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at)
});

export type AttachmentRow = {
  id: string;
  task_id: string;
  comment_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: string | number;
  uploaded_by: UserRefJson | null;
  created_at: Date;
};

export const toAttachment = (row: AttachmentRow, isImage: (mime: string) => boolean): Attachment => ({
  id: row.id,
  taskId: row.task_id,
  commentId: row.comment_id,
  fileName: row.file_name,
  mimeType: row.mime_type,
  sizeBytes: Number(row.size_bytes),
  isImage: isImage(row.mime_type),
  uploadedBy: toUserRef(row.uploaded_by),
  createdAt: toIso(row.created_at)
});

export type ActivityRow = {
  id: string;
  task_id: string;
  actor: UserRefJson | null;
  action: string;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: Date;
};

export const toActivity = (row: ActivityRow): Activity => ({
  id: row.id,
  taskId: row.task_id,
  actor: toUserRef(row.actor),
  action: row.action,
  previousValue: row.previous_value,
  newValue: row.new_value,
  createdAt: toIso(row.created_at)
});

export const accessRank: Record<ProjectAccessLevel, number> = { view: 1, submit: 2, manage: 3 };
