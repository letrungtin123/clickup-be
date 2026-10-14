import { z } from "zod";

import { DepartmentSchema } from "./departments.js";
import { SafeSearchSchema } from "./schemas.js";
import { ColorTokenSchema, TaskStatusRefSchema, UserRefSchema } from "./work.js";

/** Global search contract (spec §29, §55). Every group is authorization-filtered server side. */

const Id = z.string().uuid();
const IsoDate = z.string().datetime({ offset: true });

/** "knowledge": knowledge items the caller can read (PD-031): active + retired for readers, drafts for submit+. */
export const searchGroups = ["tasks", "projects", "lists", "people", "messages", "knowledge"] as const;
export const SearchGroupSchema = z.enum(searchGroups);
export type SearchGroup = z.infer<typeof SearchGroupSchema>;

export const GlobalSearchQuerySchema = z.object({
  q: SafeSearchSchema(200, 2),
  groups: z
    .preprocess(
      (value) => (typeof value === "string" && value.length > 0 ? value.split(",").map((entry) => entry.trim()) : [...searchGroups]),
      z.array(SearchGroupSchema).min(1).max(searchGroups.length)
    ),
  limit: z.coerce.number().int().min(1).max(20).default(8),
  /**
   * The caller's current department (PD-041): PHOTO_RETOUCH leaves the workspace groups (tasks, projects, lists) empty;
   * PRODUCTION / omitted searches them as usual. Shared groups (people, messages, knowledge) are never scoped.
   */
  department: DepartmentSchema.optional()
});
export type GlobalSearchQuery = z.infer<typeof GlobalSearchQuerySchema>;

export const TaskSearchHitSchema = z.object({
  id: Id,
  key: z.string(),
  title: z.string(),
  projectId: Id,
  projectName: z.string(),
  listId: Id,
  listName: z.string(),
  status: TaskStatusRefSchema,
  completedAt: IsoDate.nullable(),
  updatedAt: IsoDate
});

export const ProjectSearchHitSchema = z.object({ id: Id, key: z.string(), name: z.string(), color: ColorTokenSchema, visibility: z.enum(["public", "private"]) });
export const ListSearchHitSchema = z.object({ id: Id, name: z.string(), projectId: Id, projectName: z.string() });

export const MessageSearchHitSchema = z.object({
  messageId: Id,
  channelId: Id,
  channelName: z.string().nullable(),
  channelKind: z.string(),
  threadRootId: Id.nullable(),
  author: UserRefSchema.nullable(),
  text: z.string(),
  createdAt: IsoDate
});

/** Knowledge item hit: active first, drafts next (submit+ only), retired ("Hết hiệu lực") last. Open the item page (FE route /k/<spaceId>/i/<id>). */
export const KnowledgeSearchHitSchema = z.object({
  id: Id,
  spaceId: Id,
  spaceName: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  importance: z.enum(["normal", "important", "critical"]),
  status: z.object({ id: Id, name: z.string(), color: ColorTokenSchema, group: z.enum(["draft", "active", "retired"]) }),
  updatedAt: IsoDate
});
export type KnowledgeSearchHit = z.infer<typeof KnowledgeSearchHitSchema>;

export const GlobalSearchResultSchema = z.object({
  tasks: z.array(TaskSearchHitSchema),
  projects: z.array(ProjectSearchHitSchema),
  lists: z.array(ListSearchHitSchema),
  people: z.array(UserRefSchema),
  messages: z.array(MessageSearchHitSchema),
  knowledge: z.array(KnowledgeSearchHitSchema).default([])
});
export type GlobalSearchResult = z.infer<typeof GlobalSearchResultSchema>;
export type MessageSearchHit = z.infer<typeof MessageSearchHitSchema>;

// Trash -------------------------------------------------------------------------------------------

export const TrashedTaskSchema = z.object({
  id: Id,
  key: z.string(),
  title: z.string(),
  projectId: Id,
  projectName: z.string(),
  listId: Id,
  listName: z.string(),
  subtaskCount: z.number().int(),
  deletedAt: IsoDate,
  deletedBy: UserRefSchema.nullable(),
  canRestore: z.boolean(),
  canPurge: z.boolean()
});
export type TrashedTask = z.infer<typeof TrashedTaskSchema>;

export const TrashPageSchema = z.object({
  items: z.array(TrashedTaskSchema),
  pageInfo: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() })
});

export const TrashQuerySchema = z.object({
  projectId: Id.optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});
