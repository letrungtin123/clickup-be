/**
 * Work management planner: turns ProjectSeed content into a normalized model (statuses, dates, assignees,
 * comments…), balances "My tasks" per person, then schedules real service calls on the timeline.
 */
import type { RichTextDoc } from "../../src/contracts/rich-text.js";
import type { TaskPriority } from "../../src/contracts/work.js";
import { archiveList, archiveProject, createList, createProject, updateList, upsertProjectMember } from "../../src/modules/work/projects.service.js";
import { loadEffectiveWorkflow, replaceWorkflow } from "../../src/modules/work/statuses.service.js";
import { createTask, deleteTask, moveTask, updateTask } from "../../src/modules/work/tasks.service.js";
import { createComment, updateComment } from "../../src/modules/work/timeline.service.js";
import { completeTaskUpload, createTaskUpload } from "../../src/modules/work/attachments.service.js";
import type { SeedEnv } from "./env.js";
import { mentionedKeys } from "./markup.js";
import { DAY, HOUR, MINUTE, Rng, at, endOfLocalDay, hash, intoWorkingHours, local, startOfLocalDay } from "./time.js";
import {
  productionStaff,
  type CommentPool,
  type CommentSeed,
  type DueBucket,
  type FileSpec,
  type ListSeed,
  type PersonaKey,
  type Priority,
  type ProjectSeed,
  type StatusSeed,
  type SubtaskSeed,
  type TaskSeed
} from "./types.js";

type Access = "view" | "submit" | "manage";
const levelRank: Record<Access, number> = { view: 1, submit: 2, manage: 3 };

export type ProjectModel = {
  seed: ProjectSeed;
  id: string | null;
  createdAt: number;
  archivedAt: number | null;
  members: Map<PersonaKey, Access>;
  memberJoinedAt: Map<PersonaKey, number>;
  lists: ListModel[];
};

export type ListModel = {
  project: ProjectModel;
  seed: ListSeed;
  index: number;
  id: string | null;
  workflow: StatusSeed[];
  hasOverride: boolean;
  statusIds: Map<string, string>;
  createdAt: number;
  archivedAt: number | null;
};

type Step = { at: number; status: StatusSeed; by: PersonaKey };

export type CommentModel = {
  by: PersonaKey;
  text: string;
  at: number;
  edited: { at: number; text: string } | null;
  files: FileSpec[];
  replies: CommentModel[];
  id: string | null;
};

export type TaskModel = {
  list: ListModel;
  parent: TaskModel | null;
  title: string;
  desc: string | null;
  /** Shorter first version of the description, edited to `desc` at `descEditAt`. */
  descDraft: string | null;
  descEditAt: number | null;
  priority: Priority;
  initialPriority: Priority;
  priorityChangeAt: number | null;
  creator: PersonaKey;
  createdAt: number;
  assignees: PersonaKey[];
  /** Assignees added at creation; the rest are added at `lateAssignAt`. */
  initialAssignees: PersonaKey[];
  lateAssignAt: number | null;
  /** One assignee swapped mid-way (removed → added). */
  swap: { at: number; from: PersonaKey; to: PersonaKey } | null;
  final: StatusSeed;
  steps: Step[];
  doneAt: number | null;
  due: DueBucket;
  dueAt: number | null;
  startAt: number | null;
  /** Due date first set to this value, then changed to `dueAt` at `dueChangeAt`. */
  firstDueAt: number | null;
  dueSetAt: number | null;
  dueChangeAt: number | null;
  comments: CommentModel[];
  files: { spec: FileSpec; at: number; by: PersonaKey }[];
  trashAt: number | null;
  subtasks: TaskModel[];
  id: string | null;
  /** List the task is in at execution time (subtasks follow a moved parent). */
  runtimeListId: string | null;
  rng: Rng;
};

const done = (status: StatusSeed) => status.category !== "active";

// Model --------------------------------------------------------------------------------------------------------

export class WorkPlanner {
  readonly projects: ProjectModel[] = [];
  readonly tasks: TaskModel[] = [];

  constructor(
    private readonly env: SeedEnv,
    private readonly content: ProjectSeed[],
    private readonly pool: CommentPool
  ) {}

  access(project: ProjectModel, key: PersonaKey): Access | null {
    const k = this.env.key(key);
    if (this.env.p(k).role === "superadmin") {
      return "manage";
    }
    const explicit = project.members.get(k);
    if (explicit) {
      return explicit;
    }
    return project.seed.visibility === "public" ? "submit" : null;
  }

  canSubmit(project: ProjectModel, key: PersonaKey, t: number) {
    const level = this.access(project, key);
    return this.env.active(key, t) && level !== null && levelRank[level] >= 2;
  }

  /** People who may be assigned (public: any active member; private: project members). */
  assignable(project: ProjectModel, key: PersonaKey, t: number) {
    return this.env.active(key, t) && this.access(project, key) !== null;
  }

  managers(project: ProjectModel) {
    return [...project.members.entries()].filter(([, level]) => level === "manage").map(([key]) => key);
  }

  /** A manager who can act at t (owner first). */
  manager(project: ProjectModel, t: number, permission = "task.update"): PersonaKey {
    const owner = this.env.key(project.seed.owner);
    const candidates = [owner, ...this.managers(project).filter((key) => key !== owner && key !== "boss"), "boss" as PersonaKey];
    return candidates.find((key) => this.env.active(key, t) && this.env.can(key, permission) && this.canSubmit(project, key, t)) ?? "boss";
  }

  build() {
    for (const seed of this.content) {
      this.projects.push(this.buildProject(seed));
    }
    for (const project of this.projects) {
      for (const list of project.lists) {
        list.seed.tasks.forEach((task, index) => this.buildTask(list, task, null, index));
      }
    }
    this.reassignLeavers();
    this.balance();
    this.fillerComments();
  }

  private buildProject(seed: ProjectSeed): ProjectModel {
    const rng = new Rng(hash(seed.key));
    const createdAt = at(seed.createdOn, 8, rng.int(15, 50));
    const members = new Map<PersonaKey, Access>();
    const joined = new Map<PersonaKey, number>();
    const add = (raw: PersonaKey, level: Access) => {
      if (!this.env.has(raw)) {
        return;
      }
      const key = this.env.key(raw);
      const current = members.get(key);
      if (!current || levelRank[level] > levelRank[current]) {
        members.set(key, level);
      }
    };
    add(seed.owner, "manage");
    for (const [key, level] of Object.entries(seed.members) as [PersonaKey, Access][]) {
      add(key, level);
    }
    add("boss", "manage");
    for (const key of members.keys()) {
      // Most members are added right after creation, a few a few days later (public projects only).
      const late = seed.visibility === "public" && key !== this.env.key(seed.owner) && rng.chance(0.25);
      joined.set(key, createdAt + (late ? rng.int(1, 6) * DAY + rng.int(0, 6) * HOUR : rng.int(15, 70) * MINUTE));
    }
    const project: ProjectModel = {
      seed,
      id: null,
      createdAt,
      archivedAt: seed.archivedOn ? at(seed.archivedOn, 17, rng.int(0, 40)) : null,
      members,
      memberJoinedAt: joined,
      lists: []
    };
    seed.lists.forEach((listSeed, index) => {
      project.lists.push({
        project,
        seed: listSeed,
        index,
        id: null,
        workflow: listSeed.workflow ?? seed.workflow,
        hasOverride: Boolean(listSeed.workflow),
        statusIds: new Map(),
        createdAt: createdAt + (index + 1) * 2 * MINUTE,
        archivedAt: null
      });
    });
    return project;
  }

  private defaultFinal(list: ListModel, rng: Rng): StatusSeed {
    const active = list.workflow.filter((status) => status.category === "active");
    const doneStatus = list.workflow.find((status) => status.category === "done")!;
    const closed = list.workflow.find((status) => status.category === "closed");
    const roll = rng.next();
    if (roll < 0.35) {
      return doneStatus;
    }
    if (roll < 0.38 && closed) {
      return closed;
    }
    return rng.weighted(active.map((status, index) => [status, Math.max(1, active.length - index)] as const));
  }

  private pickAssignees(project: ProjectModel, rng: Rng, t: number, count: number): PersonaKey[] {
    const pool = [...project.members.keys()].filter((key) => key !== "boss" && this.assignable(project, key, t));
    if (project.seed.visibility === "public") {
      for (const key of productionStaff) {
        if (this.env.has(key) && rng.chance(0.15)) {
          pool.push(key);
        }
      }
    }
    return rng.sample([...new Set(pool)], count);
  }

  private clampTime(t: number, min: number, max: number, rng: Rng, evening = false) {
    // Overflow lands somewhere in the last hours of the window, not exactly on its edge.
    const bounded = t > max ? max - rng.float(0, Math.min(Math.max(max - min, 0), 8 * HOUR)) : Math.max(t, min);
    const value = intoWorkingHours(bounded, rng, evening);
    return value < min || value > max ? bounded : value;
  }

  private dueFor(bucket: DueBucket, rng: Rng, createdAt: number, doneAt: number | null): number | null {
    const now = this.env.now;
    const eod = (t: number) => endOfLocalDay(t);
    switch (bucket) {
      case "none":
        return null;
      case "today":
        return eod(now);
      case "overdue":
        return eod(now - rng.int(1, 12) * DAY);
      case "tomorrow":
        return eod(now + rng.int(1, 2) * DAY);
      case "week":
        return eod(now + rng.int(3, 7) * DAY);
      case "next_week":
        return eod(now + rng.int(8, 14) * DAY);
      case "later":
        return eod(now + rng.int(15, 55) * DAY);
      case "past": {
        const anchor = doneAt ?? now - rng.int(2, 20) * DAY;
        return Math.max(eod(anchor + rng.int(-3, 2) * DAY), eod(createdAt));
      }
    }
  }

  private statusPath(list: ListModel, final: StatusSeed, rng: Rng): StatusSeed[] {
    const workflow = list.workflow;
    const initial = workflow[0]!;
    const active = workflow.filter((status) => status.category === "active");
    if (final.name === initial.name) {
      return [initial];
    }
    const path: StatusSeed[] = [initial];
    if (final.category === "active") {
      const index = active.findIndex((status) => status.name === final.name);
      for (const status of active.slice(1, Math.max(1, index))) {
        if (rng.chance(0.55)) {
          path.push(status);
        }
      }
    } else {
      const middle = active.slice(1);
      if (final.category === "done") {
        for (const status of middle) {
          if (rng.chance(middle.length > 2 ? 0.45 : 0.7)) {
            path.push(status);
          }
        }
      } else if (middle.length > 0 && rng.chance(0.4)) {
        path.push(rng.pick(middle));
      }
    }
    path.push(final);
    return path;
  }

  private buildTask(list: ListModel, seed: TaskSeed | SubtaskSeed, parent: TaskModel | null, index: number): TaskModel {
    const project = list.project;
    const rng = new Rng(hash(`${project.seed.key}:${list.index}:${parent ? `${parent.title}/` : ""}${seed.title}:${index}`));
    const env = this.env;
    const taskSeed = seed as TaskSeed;
    const projectEnd = Math.min(project.archivedAt ?? env.planEnd, env.planEnd);
    const listEnd = list.seed.archived ? Math.min(projectEnd, at("2026-09-25", 10)) : projectEnd;
    const floor = Math.max(list.createdAt + 20 * MINUTE, project.createdAt + 40 * MINUTE);

    // Final status
    let final = seed.status ? list.workflow.find((status) => status.name === seed.status) : undefined;
    if (!final) {
      final = parent && done(parent.final) ? list.workflow.find((status) => status.category === "done")! : this.defaultFinal(list, rng);
    }
    if (list.seed.archived || project.seed.archivedOn) {
      final = list.workflow.find((status) => status.category === "done")!;
    }
    if (parent && done(parent.final) && !done(final)) {
      final = list.workflow.find((status) => status.category === "done")!;
    }

    // Created
    let createdAt: number;
    if (parent) {
      createdAt = parent.createdAt + rng.int(5, 60 * 30) * MINUTE;
    } else if (taskSeed.createdDaysAgo !== undefined) {
      createdAt = startOfLocalDay(env.now - taskSeed.createdDaysAgo * DAY) + rng.float(8.2, 17.4) * HOUR;
    } else if (done(final)) {
      createdAt = env.now - rng.int(8, 42) * DAY;
    } else {
      createdAt = env.now - rng.weighted([[rng.int(1, 6), 4], [rng.int(7, 20), 4], [rng.int(21, 40), 2]] as const) * DAY;
    }

    // Due bucket
    let due: DueBucket = seed.due ?? (done(final) ? "past" : rng.weighted([
      ["overdue", 12], ["today", 6], ["tomorrow", 6], ["week", 20], ["next_week", 15], ["later", 13], ["none", 28]
    ] as const));
    if (!done(final) && due === "past") {
      due = "overdue";
    }
    if (parent && !seed.due && rng.chance(0.5)) {
      due = done(final) ? "past" : "none";
    }

    // Done moment
    let doneAt: number | null = null;
    const latest = Math.min(listEnd, env.planEnd) - 30 * MINUTE;
    createdAt = this.clampTime(createdAt, floor, latest - (done(final) ? 6 * HOUR : 0), rng);
    if (parent) {
      createdAt = Math.max(createdAt, parent.createdAt + 5 * MINUTE);
      if (parent.doneAt !== null) {
        createdAt = Math.max(parent.createdAt + 5 * MINUTE, Math.min(createdAt, parent.doneAt - rng.int(20, 300) * MINUTE));
      }
    }
    if (done(final)) {
      const upper = parent?.doneAt ? parent.doneAt - 10 * MINUTE : latest;
      doneAt = this.clampTime(createdAt + rng.float(0.2, 12) * DAY, createdAt + 20 * MINUTE, Math.max(upper, createdAt + 25 * MINUTE), rng);
      if (doneAt <= createdAt) {
        doneAt = createdAt + 30 * MINUTE;
      }
    }

    let dueAt = this.dueFor(due, rng, createdAt, doneAt);
    if (dueAt !== null && dueAt < createdAt + 6 * HOUR && !done(final)) {
      // Created before its (overdue) deadline.
      createdAt = this.clampTime(dueAt - rng.int(2, 8) * DAY, floor, dueAt - 4 * HOUR, rng);
    }
    if (dueAt !== null && dueAt < createdAt) {
      dueAt = endOfLocalDay(createdAt);
    }
    const startAt = dueAt !== null && rng.chance(0.3) ? Math.max(startOfLocalDay(createdAt), startOfLocalDay(dueAt - rng.int(1, 5) * DAY)) : null;

    // Creator
    const defaultCreators = this.managers(project).filter((key) => key !== "boss");
    let creator: PersonaKey = taskSeed.creator
      ? env.key(taskSeed.creator)
      : parent
        ? (parent.assignees[0] ?? parent.creator)
        : rng.pick(defaultCreators.length > 0 && project.seed.visibility === "public" ? defaultCreators : this.managers(project));
    if (!this.canSubmit(project, creator, createdAt)) {
      creator = this.manager(project, createdAt, "task.create");
    }

    // Assignees
    let assignees: PersonaKey[];
    if (seed.assignees) {
      assignees = [...new Set(seed.assignees.filter((key) => env.has(key)).map((key) => env.key(key)))].filter((key) =>
        this.assignable(project, key, createdAt)
      );
    } else if (parent) {
      assignees = parent.assignees.length > 0 && rng.chance(0.6) ? rng.sample(parent.assignees, 1) : this.pickAssignees(project, rng, createdAt, rng.chance(0.75) ? 1 : 0);
    } else {
      assignees = this.pickAssignees(project, rng, createdAt, rng.weighted([[1, 60], [2, 25], [0, 9], [3, 6]] as const));
    }
    assignees = assignees.slice(0, 3);
    const lateAssign = assignees.length > 0 && rng.chance(0.22);
    const initialAssignees = lateAssign ? assignees.slice(0, rng.int(0, assignees.length - 1)) : [...assignees];

    const priority: Priority = seed.priority ?? rng.weighted([["urgent", 8], ["high", 25], ["normal", 52], ["low", 15]] as const);
    const priorityChange = rng.chance(0.06);
    const initialPriority: Priority = priorityChange ? rng.pick((["low", "normal", "high"] as const).filter((value) => value !== priority)) : priority;

    const task: TaskModel = {
      list,
      parent,
      title: seed.title,
      desc: taskSeed.desc ?? null,
      descDraft: null,
      descEditAt: null,
      priority,
      initialPriority,
      priorityChangeAt: null,
      creator,
      createdAt,
      assignees,
      initialAssignees,
      lateAssignAt: null,
      swap: null,
      final,
      steps: [],
      doneAt,
      due,
      dueAt,
      startAt,
      firstDueAt: null,
      dueSetAt: null,
      dueChangeAt: null,
      comments: [],
      files: [],
      trashAt: null,
      subtasks: [],
      id: null,
      runtimeListId: null,
      rng
    };

    const end = doneAt ?? Math.min(latest, env.planEnd - 40 * MINUTE);
    const mid = (from: number, to: number) => this.clampTime(from + rng.float(0.15, 0.85) * Math.max(to - from, 30 * MINUTE), from + 5 * MINUTE, Math.max(to, from + 6 * MINUTE), rng);

    if (lateAssign) {
      task.lateAssignAt = mid(createdAt, Math.min(end, createdAt + 2 * DAY));
    }
    if (priorityChange) {
      task.priorityChangeAt = mid(createdAt, end);
    }
    if (task.desc && rng.chance(0.08)) {
      task.descDraft = task.desc.split(/\n\s*\n/)[0] ?? null;
      if (task.descDraft === task.desc) {
        task.descDraft = null;
      } else {
        task.descEditAt = mid(createdAt, end);
      }
    }
    if (dueAt !== null) {
      if (rng.chance(0.35)) {
        task.dueSetAt = mid(createdAt, Math.min(end, createdAt + 3 * DAY));
      }
      if (rng.chance(0.18)) {
        task.firstDueAt = endOfLocalDay(dueAt - rng.int(2, 6) * DAY);
        if (task.firstDueAt < createdAt) {
          task.firstDueAt = null;
        } else {
          task.dueChangeAt = mid(Math.max(task.dueSetAt ?? createdAt, Math.min(task.firstDueAt, end) - DAY), end);
        }
      }
    }
    if (assignees.length > 0 && !lateAssign && rng.chance(0.07) && !list.project.seed.archivedOn) {
      const replacement = this.pickAssignees(project, rng, createdAt, 3).find((key) => !assignees.includes(key));
      const from = rng.pick(assignees);
      if (replacement && from !== replacement) {
        task.swap = { at: mid(createdAt, end), from: replacement, to: from };
        // Initially assigned to `replacement`, later handed over to `from` (the final assignee).
        task.initialAssignees = [...task.initialAssignees.filter((key) => key !== from), replacement];
      }
    }

    // Status steps
    const path = this.statusPath(list, final, rng);
    const changes = path.slice(1);
    let cursor = createdAt;
    changes.forEach((status, stepIndex) => {
      const isLast = stepIndex === changes.length - 1;
      const limit = isLast && doneAt ? doneAt : end;
      const remaining = changes.length - stepIndex;
      const target = isLast && doneAt ? doneAt : cursor + (limit - cursor) * rng.float(0.2, 0.9) / remaining;
      const stamp = isLast && doneAt ? doneAt : this.clampTime(target, cursor + 10 * MINUTE, Math.max(limit, cursor + 11 * MINUTE), rng);
      task.steps.push({ at: stamp, status, by: assignees[0] ?? creator });
      cursor = stamp;
    });

    // Comments
    const lifeEnd = Math.min((doneAt ?? env.planEnd) + 2 * DAY, listEnd, env.planEnd - 5 * MINUTE);
    const commentTime = (offsetDays: number | undefined, after: number) => {
      const base = offsetDays !== undefined ? createdAt + offsetDays * DAY : after + rng.float(0.05, 0.6) * Math.max(lifeEnd - after, HOUR);
      return this.clampTime(base, Math.max(after, createdAt + 10 * MINUTE), Math.max(lifeEnd, createdAt + 15 * MINUTE), rng, rng.chance(0.08));
    };
    let commentCursor = createdAt;
    for (const comment of (taskSeed.comments ?? []) as CommentSeed[]) {
      const model = this.comment(project, comment, commentTime(comment.at, commentCursor), lifeEnd, rng);
      if (model) {
        task.comments.push(model);
        commentCursor = Math.max(commentCursor, model.at);
      }
    }
    task.comments.sort((a, b) => a.at - b.at);

    // Files on the task
    for (const spec of taskSeed.files ?? []) {
      const by = this.canSubmit(project, assignees[0] ?? creator, createdAt) ? (assignees[0] ?? creator) : creator;
      task.files.push({ spec, by, at: this.clampTime(createdAt + rng.float(0.1, 0.6) * Math.max(end - createdAt, HOUR), createdAt + 5 * MINUTE, end, rng) });
    }

    if (taskSeed.trash && !project.seed.archivedOn && !list.seed.archived) {
      task.trashAt = this.clampTime(createdAt + rng.float(0.1, 3) * DAY, createdAt + 30 * MINUTE, env.planEnd - 10 * MINUTE, rng);
    }

    this.tasks.push(task);
    if (parent) {
      parent.subtasks.push(task);
    }
    (taskSeed.subtasks ?? []).forEach((sub, subIndex) => {
      this.buildTask(list, typeof sub === "string" ? { title: sub } : sub, task, subIndex);
    });
    return task;
  }

  private comment(project: ProjectModel, seed: CommentSeed, t: number, lifeEnd: number, rng: Rng): CommentModel | null {
    let by = this.env.has(seed.by) ? this.env.key(seed.by) : this.manager(project, t);
    if (!this.canSubmit(project, by, t) || !this.env.can(by, "task.comment")) {
      by = this.manager(project, t, "task.comment");
    }
    const model: CommentModel = { by, text: seed.text, at: t, edited: null, files: seed.files ?? [], replies: [], id: null };
    if (seed.edited) {
      model.edited = { at: Math.min(t + rng.int(3, 90) * MINUTE, lifeEnd), text: seed.edited };
    }
    let cursor = t;
    for (const reply of seed.replies ?? []) {
      const at = this.clampTime(cursor + rng.float(0.15, 20) * HOUR, cursor + 4 * MINUTE, Math.max(lifeEnd, cursor + 5 * MINUTE), rng, rng.chance(0.1));
      const replyModel = this.comment(project, { ...reply, replies: [] }, at, lifeEnd, rng);
      if (replyModel) {
        model.replies.push(replyModel);
        cursor = replyModel.at;
      }
    }
    return model;
  }

  /** Open work assigned to people who left is handed to a colleague when they leave. */
  private reassignLeavers() {
    for (const task of this.tasks) {
      for (const key of task.assignees) {
        const persona = this.env.p(key);
        if (persona.leftAt === null) {
          continue;
        }
        const openAtLeave = task.doneAt === null || task.doneAt > persona.leftAt;
        if (task.createdAt >= persona.leftAt) {
          task.assignees = task.assignees.filter((entry) => entry !== key);
          task.initialAssignees = task.initialAssignees.filter((entry) => entry !== key);
          continue;
        }
        if (openAtLeave && !task.swap && !task.trashAt) {
          const replacement = this.pickAssignees(task.list.project, task.rng, persona.leftAt, 4).find(
            (candidate) => !task.assignees.includes(candidate) && this.env.p(candidate).leftAt === null
          );
          if (replacement) {
            task.swap = { at: persona.leftAt + task.rng.int(2, 40) * HOUR, from: key, to: replacement };
            task.assignees = [...task.assignees.filter((entry) => entry !== key), replacement];
            if (!task.initialAssignees.includes(key)) {
              task.initialAssignees.push(key);
            }
            task.lateAssignAt = task.lateAssignAt && task.lateAssignAt < persona.leftAt ? task.lateAssignAt : null;
          }
        }
      }
    }
  }

  private isOpen(task: TaskModel) {
    return task.doneAt === null && task.trashAt === null && !task.list.seed.archived && !task.list.project.seed.archivedOn;
  }

  /**
   * "Việc của tôi": every active person gets 5–20 open tasks incl. ≥1 overdue and ≥1 due today; boss 15–25
   * assigned in total.
   */
  private balance() {
    const env = this.env;
    const rng = new Rng(hash("balance"));
    const people = ([
      "boss", "linh", "admin", "minh", "an", "khoa", "lead1", "lead2", "acc1", "acc2", ...productionStaff
    ] as PersonaKey[]).filter((key) => env.has(key) && env.key(key) === key && env.p(key).leftAt === null);
    const openOf = (key: PersonaKey) => this.tasks.filter((task) => this.isOpen(task) && task.assignees.includes(key));
    const assign = (task: TaskModel, key: PersonaKey) => {
      task.assignees.push(key);
      if (!task.swap || task.swap.to !== key) {
        task.initialAssignees.push(key);
      }
    };
    // Caps first: hand surplus open work to the least-loaded colleague of the same project.
    const cap = (key: PersonaKey) => (key === "boss" ? 14 : 18);
    for (const key of [...people].sort((a, b) => openOf(b).length - openOf(a).length)) {
      const open = openOf(key);
      if (open.length <= cap(key)) {
        continue;
      }
      const surplus = [...open]
        .sort((a, b) => Number(Boolean(b.parent)) - Number(Boolean(a.parent)) || Number(b.due === "none" || b.due === "later") - Number(a.due === "none" || a.due === "later"))
        .filter((task) => !task.swap || (task.swap.to !== key && task.swap.from !== key))
        .slice(0, open.length - cap(key));
      for (const task of surplus) {
        if (task.assignees.length > 1) {
          task.assignees = task.assignees.filter((entry) => entry !== key);
          task.initialAssignees = task.initialAssignees.filter((entry) => entry !== key);
          continue;
        }
        const project = task.list.project;
        const replacement = [...project.members.keys()]
          .filter((other) => other !== key && other !== "boss" && people.includes(other) && this.canSubmit(project, other, task.createdAt))
          .map((other) => [other, openOf(other).length] as const)
          .filter(([, load]) => load < 15)
          .sort((a, b) => a[1] - b[1])[0]?.[0];
        if (replacement) {
          task.assignees = task.assignees.map((entry) => (entry === key ? replacement : entry));
          task.initialAssignees = task.initialAssignees.map((entry) => (entry === key ? replacement : entry));
        } else {
          // Nobody free: the item stays in the backlog without an owner ("Chưa giao").
          task.assignees = [];
          task.initialAssignees = [];
        }
      }
    }
    for (const key of rng.shuffle(people)) {
      let open = openOf(key);
      const minimum = key === "boss" ? 9 : rng.int(5, 8);
      if (open.length < minimum) {
        const candidates = rng.shuffle(
          this.tasks.filter(
            (task) =>
              this.isOpen(task) &&
              !task.assignees.includes(key) &&
              task.assignees.length < 3 &&
              this.assignable(task.list.project, key, task.createdAt) &&
              (key === "boss" || task.list.project.members.has(key) || task.list.project.seed.visibility === "public")
          )
        ).sort((a, b) => Number(b.list.project.members.has(key)) - Number(a.list.project.members.has(key)));
        for (const task of candidates.slice(0, minimum - open.length)) {
          assign(task, key);
        }
        open = openOf(key);
      }
      if (open.length > 20) {
        for (const task of open.slice(20)) {
          if (task.assignees.length > 1) {
            task.assignees = task.assignees.filter((entry) => entry !== key);
            task.initialAssignees = task.initialAssignees.filter((entry) => entry !== key);
          }
        }
        open = openOf(key);
      }
      const ensureBucket = (bucket: "overdue" | "today") => {
        if (open.some((task) => task.due === bucket)) {
          return;
        }
        const target = open.find((task) => task.due !== "overdue" && task.due !== "today" && !task.parent) ?? open.find((task) => task.due !== "overdue" && task.due !== "today");
        if (!target) {
          return;
        }
        target.due = bucket;
        target.dueAt = this.dueFor(bucket, target.rng, target.createdAt, null);
        target.firstDueAt = null;
        target.dueChangeAt = null;
        if (target.startAt !== null && target.dueAt !== null && target.startAt > target.dueAt) {
          target.startAt = startOfLocalDay(target.dueAt);
        }
        if (target.dueAt !== null && target.dueAt < target.createdAt + 6 * HOUR) {
          target.createdAt = Math.max(target.list.project.createdAt + HOUR, target.dueAt - target.rng.int(2, 6) * DAY);
          for (const step of target.steps) {
            step.at = Math.max(step.at, target.createdAt + 15 * MINUTE);
          }
        }
      };
      ensureBucket("overdue");
      ensureBucket("today");
      // Nobody looks negligent: at most ~30% of someone's open work is overdue.
      const overdue = open.filter((task) => task.due === "overdue");
      const allowed = Math.max(2, Math.round(open.length * 0.3));
      for (const task of overdue.slice(allowed)) {
        task.due = task.rng.chance(0.5) ? "tomorrow" : "week";
        task.dueAt = this.dueFor(task.due, task.rng, task.createdAt, null);
        if (task.firstDueAt !== null && task.dueAt !== null && task.firstDueAt >= task.dueAt) {
          task.firstDueAt = null;
          task.dueChangeAt = null;
        }
      }
    }
    // boss: 15–25 assigned in total (open + done)
    const bossTotal = () => this.tasks.filter((task) => task.assignees.includes("boss") && task.trashAt === null).length;
    for (const task of rng.shuffle(this.tasks.filter((entry) => entry.assignees.includes("boss") && entry.assignees.length > 1 && !this.isOpen(entry)))) {
      if (bossTotal() <= 24) {
        break;
      }
      task.assignees = task.assignees.filter((entry) => entry !== "boss");
      task.initialAssignees = task.initialAssignees.filter((entry) => entry !== "boss");
    }
    if (bossTotal() < 16) {
      const doneCandidates = rng.shuffle(this.tasks.filter((task) => task.doneAt !== null && !task.assignees.includes("boss") && task.assignees.length < 3 && !task.parent));
      for (const task of doneCandidates.slice(0, 16 - bossTotal())) {
        assign(task, "boss");
      }
    }
  }

  /** Generic comments on some tasks without authored ones. */
  private fillerComments() {
    const rng = new Rng(hash("filler"));
    for (const task of this.tasks) {
      if (task.comments.length > 0 || task.trashAt !== null || !rng.chance(task.parent ? 0.12 : 0.42)) {
        continue;
      }
      const project = task.list.project;
      const end = Math.min(task.doneAt ?? this.env.planEnd, project.archivedAt ?? this.env.planEnd, this.env.planEnd - 10 * MINUTE);
      const count = rng.weighted([[1, 5], [2, 3], [3, 2]] as const);
      let cursor = task.createdAt;
      for (let index = 0; index < count; index += 1) {
        const assignee = task.assignees.length > 0 ? rng.pick(task.assignees) : null;
        const managerTurn = !assignee || rng.chance(0.4);
        const kind: keyof CommentPool = managerTurn
          ? rng.pick(["managerNudge", "question", "review"] as const)
          : task.doneAt !== null && index === count - 1
            ? "done"
            : rng.pick(["progress", "progress", "question", "blocker"] as const);
        let text = rng.pick(this.pool[kind]);
        text = text.replace(/\{assignee\}/g, assignee ? `@{${assignee}}` : "mọi người");
        const by = managerTurn ? (rng.chance(0.5) ? task.creator : this.manager(project, cursor)) : assignee!;
        const at = this.clampTime(cursor + rng.float(0.1, 0.5) * Math.max(end - cursor, HOUR), cursor + 10 * MINUTE, Math.max(end, cursor + 11 * MINUTE), rng);
        const model = this.comment(project, { by, text }, at, end, rng);
        if (model && model.at <= end) {
          task.comments.push(model);
          cursor = model.at;
        }
      }
    }
  }

  // Scheduling ---------------------------------------------------------------------------------------------

  schedule() {
    const env = this.env;
    for (const project of this.projects) {
      this.scheduleProject(project);
    }
    for (const task of this.tasks) {
      this.scheduleTask(task);
    }
    this.scheduleReorders();
    // Archived lists / project
    for (const project of this.projects) {
      for (const list of project.lists.filter((entry) => entry.seed.archived)) {
        const lastDone = Math.max(
          list.createdAt,
          ...this.tasks.filter((task) => task.list === list).flatMap((task) => [task.doneAt ?? 0, ...task.comments.map((c) => c.at)])
        );
        list.archivedAt = Math.min(Math.max(lastDone + 18 * HOUR, at("2026-09-25", 10)), env.planEnd - HOUR);
        const by = this.manager(project, list.archivedAt, "list.delete");
        env.schedule(list.archivedAt, "list.archive", by, async () => {
          if (project.id && list.id) {
            await archiveList(await env.ctx(by), project.id, list.id);
            env.count("lists.archived");
          }
        });
      }
      if (project.archivedAt) {
        const by = env.can(project.seed.owner, "project.delete") ? env.key(project.seed.owner) : "boss";
        env.schedule(project.archivedAt, "project.archive", by, async () => {
          if (project.id) {
            await archiveProject(await env.ctx(by), project.id);
            env.count("projects.archived");
          }
        });
      }
    }
  }

  private scheduleProject(project: ProjectModel) {
    const env = this.env;
    const owner = env.key(project.seed.owner);
    const seed = project.seed;
    env.schedule(project.createdAt, "project.create", owner, async () => {
      const context = await env.ctx(owner);
      const created = await createProject(context, {
        key: seed.key,
        name: seed.name,
        description: seed.description,
        visibility: seed.visibility,
        color: seed.color,
        icon: seed.icon
      });
      project.id = created.id;
      env.count("projects");
      const [first, ...rest] = project.lists;
      const defaultList = created.lists[0];
      if (first && defaultList) {
        await updateList(context, created.id, defaultList.id, {
          name: first.seed.name,
          description: first.seed.description ?? null,
          color: first.seed.color ?? null
        });
        first.id = defaultList.id;
      }
      for (const list of rest) {
        const createdList = await createList(context, created.id, {
          name: list.seed.name,
          description: list.seed.description ?? null,
          color: list.seed.color ?? null
        });
        list.id = createdList.id;
      }
      env.count("lists", project.lists.length);
      await replaceWorkflow(context, created.id, {
        listId: null,
        inherit: false,
        statuses: seed.workflow.map((status) => ({ name: status.name, category: status.category, color: status.color })),
        remap: []
      });
      for (const list of project.lists.filter((entry) => entry.hasOverride && entry.id)) {
        await replaceWorkflow(context, created.id, {
          listId: list.id,
          inherit: false,
          statuses: list.workflow.map((status) => ({ name: status.name, category: status.category, color: status.color })),
          remap: []
        });
      }
      for (const list of project.lists) {
        const workflow = await loadEffectiveWorkflow(env.sql, context.organization.id, created.id, list.id);
        for (const item of workflow.items) {
          list.statusIds.set(item.name, item.id);
        }
      }
    });
    for (const [key, level] of project.members) {
      if (key === owner) {
        continue;
      }
      const t = project.memberJoinedAt.get(key) ?? project.createdAt + 20 * MINUTE;
      env.schedule(t, "project.member", owner, async () => {
        if (!project.id) {
          return;
        }
        await upsertProjectMember(await env.ctx(owner), project.id, { userId: env.p(key).id, accessLevel: level });
        env.count("project_members");
      });
    }
  }

  private doc(task: TaskModel, text: string, t: number): RichTextDoc {
    const project = task.list.project;
    return this.env.doc(text, (key) => this.access(project, key) !== null, t);
  }

  private scheduleTask(task: TaskModel) {
    const env = this.env;
    const project = task.list.project;
    const list = task.list;
    const statusId = (status: StatusSeed) => list.statusIds.get(status.name);
    const parentTrash = task.parent?.trashAt ?? task.parent?.parent?.trashAt ?? null;
    if (parentTrash !== null && task.createdAt >= parentTrash) {
      return;
    }
    // Nothing happens to a task once it (or an ancestor) is in the trash.
    const limit = Math.min(task.trashAt ?? Infinity, parentTrash ?? Infinity);
    const schedule = (t: number, label: string, by: PersonaKey | null, run: () => Promise<unknown>) => {
      if (t < limit) {
        env.schedule(t, label, by, run);
      }
    };
    const actor = (preferred: PersonaKey[], t: number, permission = "task.update") =>
      preferred.find((key) => this.canSubmit(project, key, t) && env.can(key, permission)) ?? this.manager(project, t, permission);

    schedule(task.createdAt, "task.create", task.creator, async () => {
      const listId = task.parent?.runtimeListId ?? list.id;
      if (!project.id || !listId || (task.parent && !task.parent.id)) {
        return;
      }
      const initial = statusId(list.workflow[0]!);
      const dueAtCreation = task.dueSetAt === null ? (task.firstDueAt ?? task.dueAt) : null;
      const created = await createTask(await env.ctx(task.creator), project.id, {
        listId,
        parentTaskId: task.parent?.id ?? null,
        title: task.title,
        description: task.descDraft ?? task.desc ? this.doc(task, (task.descDraft ?? task.desc)!, task.createdAt) : null,
        ...(initial ? { statusId: initial } : {}),
        priority: task.initialPriority as TaskPriority,
        assigneeIds: task.initialAssignees.filter((key) => this.assignable(project, key, task.createdAt)).map((key) => env.p(key).id),
        startAt: dueAtCreation !== null && task.startAt !== null && task.startAt <= dueAtCreation ? new Date(task.startAt).toISOString() : null,
        dueAt: dueAtCreation !== null ? new Date(dueAtCreation).toISOString() : null
      });
      task.id = created.id;
      task.runtimeListId = listId;
      env.count(task.parent ? "subtasks" : "tasks");
    });

    const update = (t: number, label: string, by: PersonaKey, input: Parameters<typeof updateTask>[2]) => {
      schedule(t, label, by, async () => {
        if (!task.id) {
          return;
        }
        await updateTask(await env.ctx(by), task.id, input);
        env.count(`activity.${label}`);
      });
    };

    if (task.dueSetAt !== null && task.dueAt !== null) {
      const by = actor([task.creator, ...task.assignees], task.dueSetAt);
      const value = task.firstDueAt ?? task.dueAt;
      update(task.dueSetAt, "due", by, {
        dueAt: new Date(value).toISOString(),
        ...(task.startAt !== null && task.startAt <= value ? { startAt: new Date(task.startAt).toISOString() } : {})
      });
    }
    if (task.dueChangeAt !== null && task.firstDueAt !== null && task.dueAt !== null) {
      const by = actor([...task.assignees, task.creator], task.dueChangeAt);
      update(Math.max(task.dueChangeAt, (task.dueSetAt ?? task.createdAt) + 5 * MINUTE), "due_change", by, { dueAt: new Date(task.dueAt).toISOString() });
    }
    if (task.lateAssignAt !== null) {
      const late = task.assignees.filter((key) => !task.initialAssignees.includes(key) && (!task.swap || task.swap.to !== key));
      if (late.length > 0) {
        const by = actor([task.creator, this.manager(project, task.lateAssignAt)], task.lateAssignAt, "task.assign");
        update(task.lateAssignAt, "assign", by, { assignees: { add: late.map((key) => env.p(key).id), remove: [] } });
      }
    }
    if (task.swap) {
      const swap = task.swap;
      const by = actor([this.manager(project, swap.at), task.creator], swap.at, "task.assign");
      update(swap.at, "reassign", by, { assignees: { add: [env.p(swap.to).id], remove: [env.p(swap.from).id] } });
    }
    if (task.priorityChangeAt !== null) {
      update(task.priorityChangeAt, "priority", actor([task.creator, this.manager(project, task.priorityChangeAt)], task.priorityChangeAt), {
        priority: task.priority as TaskPriority
      });
    }
    if (task.descEditAt !== null && task.desc) {
      const by = actor([task.creator], task.descEditAt);
      schedule(task.descEditAt, "description", by, async () => {
        if (task.id) {
          await updateTask(await env.ctx(by), task.id, { description: this.doc(task, task.desc!, task.descEditAt!) });
        }
      });
    }
    for (const step of task.steps) {
      const by = actor([...task.assignees.filter((key) => env.active(key, step.at)), task.creator], step.at);
      schedule(step.at, "status", by, async () => {
        const id = statusId(step.status);
        if (task.id && id) {
          await updateTask(await env.ctx(by), task.id, { statusId: id });
          env.count(done(step.status) ? "tasks.completed" : "tasks.status_changes");
        }
      });
    }
    for (const file of task.files) {
      const by = this.canSubmit(project, file.by, file.at) ? file.by : this.manager(project, file.at);
      schedule(file.at, "task.file", by, async () => {
        if (task.id) {
          await this.uploadTaskFile(task.id, by, file.spec, "task");
          env.count("task_attachments");
        }
      });
    }
    for (const comment of task.comments) {
      this.scheduleComment(task, comment, null, schedule);
    }
    if (task.trashAt !== null && (parentTrash === null || task.trashAt < parentTrash)) {
      const by = this.manager(project, task.trashAt, "task.delete");
      env.schedule(task.trashAt, "task.trash", by, async () => {
        if (task.id) {
          await deleteTask(await env.ctx(by), task.id);
          env.count("tasks.trashed");
        }
      });
    }
  }

  private async uploadTaskFile(taskId: string, by: PersonaKey, spec: FileSpec, target: "task" | "comment") {
    const env = this.env;
    const context = await env.ctx(by);
    const file = await env.makeFile(spec);
    const ticket = await createTaskUpload(context, taskId, { fileName: file.name, mimeType: file.mimeType, sizeBytes: file.bytes.length });
    await env.putFile(ticket.uploadUrl, file.bytes, file.mimeType);
    await completeTaskUpload(context, ticket.attachmentId, target);
    env.count("files.bytes", file.bytes.length);
    return ticket.attachmentId;
  }

  private scheduleComment(
    task: TaskModel,
    comment: CommentModel,
    parent: CommentModel | null,
    schedule: (t: number, label: string, by: PersonaKey | null, run: () => Promise<unknown>) => void
  ) {
    const env = this.env;
    schedule(comment.at, parent ? "comment.reply" : "comment", comment.by, async () => {
      if (!task.id || (parent && !parent.id)) {
        return;
      }
      const attachmentIds: string[] = [];
      for (const spec of comment.files) {
        attachmentIds.push(await this.uploadTaskFile(task.id, comment.by, spec, "comment"));
        env.count("comment_attachments");
      }
      const created = await createComment(await env.ctx(comment.by), task.id, {
        body: this.doc(task, comment.text, comment.at),
        parentCommentId: parent?.id ?? null,
        attachmentIds
      });
      comment.id = created.id;
      env.count(parent ? "comments.replies" : "comments");
      if (mentionedKeys(comment.text).length > 0) {
        env.count("comments.with_mentions");
      }
    });
    if (comment.edited) {
      const edited = comment.edited;
      schedule(edited.at, "comment.edit", comment.by, async () => {
        if (task.id && comment.id) {
          await updateComment(await env.ctx(comment.by), task.id, comment.id, this.doc(task, edited.text, edited.at));
          env.count("comments.edited");
        }
      });
    }
    for (const reply of comment.replies) {
      this.scheduleComment(task, reply, comment, schedule);
    }
  }

  /** Drag & drop: a few open tasks are moved above another task of the same list. */
  private scheduleReorders() {
    const env = this.env;
    const rng = new Rng(hash("reorder"));
    const roots = this.tasks.filter((task) => !task.parent && this.isOpen(task));
    const movable = rng.shuffle(roots.filter((task) => !task.list.hasOverride && task.list.project.lists.filter((list) => !list.hasOverride && !list.seed.archived).length > 1)).slice(0, 5);
    const stable = roots.filter((task) => !movable.includes(task));
    let planned = 0;
    for (const task of rng.shuffle(stable)) {
      if (planned >= 18) {
        break;
      }
      const sibling = stable.find((other) => other !== task && other.list === task.list && other.createdAt < task.createdAt);
      if (!sibling) {
        continue;
      }
      const t = this.clampTime(task.createdAt + rng.float(0.1, 2) * DAY, task.createdAt + 20 * MINUTE, env.planEnd - 20 * MINUTE, rng);
      const by = this.manager(task.list.project, t);
      env.schedule(t, "task.reorder", by, async () => {
        if (task.id && sibling.id) {
          await moveTask(await env.ctx(by), task.id, { placement: { beforeId: sibling.id } });
          env.count("tasks.reordered");
        }
      });
      planned += 1;
    }
    // A few tasks change list (same workflow) mid-life.
    for (const task of movable) {
      const target = task.list.project.lists.find((list) => list !== task.list && !list.hasOverride && !list.seed.archived);
      if (!target) {
        continue;
      }
      const t = this.clampTime(task.createdAt + rng.float(0.05, 0.5) * DAY, task.createdAt + 10 * MINUTE, env.planEnd - 30 * MINUTE, rng);
      const by = this.manager(task.list.project, t);
      const from = task.list;
      env.schedule(t, "task.move", by, async () => {
        if (task.id && target.id) {
          await moveTask(await env.ctx(by), task.id, { listId: target.id });
          const follow = (node: TaskModel) => {
            node.runtimeListId = target.id;
            node.subtasks.forEach(follow);
          };
          follow(task);
          env.count("tasks.moved");
        }
      });
      // Later status steps resolve against the new list.
      task.list = target;
      for (const sub of task.subtasks) {
        sub.list = target;
      }
      void from;
    }
  }
}

/** Debug summary of the model (used by --plan). */
export const describeWork = (planner: WorkPlanner, env: SeedEnv) => {
  const open = planner.tasks.filter((task) => task.doneAt === null && task.trashAt === null && !task.list.seed.archived && !task.list.project.seed.archivedOn);
  const perPerson = new Map<string, { open: number; overdue: number; today: number }>();
  for (const task of open) {
    for (const key of task.assignees) {
      const entry = perPerson.get(key) ?? { open: 0, overdue: 0, today: 0 };
      entry.open += 1;
      if (task.due === "overdue") entry.overdue += 1;
      if (task.due === "today") entry.today += 1;
      perPerson.set(key, entry);
    }
  }
  const comments = planner.tasks.reduce((sum, task) => sum + task.comments.reduce((inner, c) => inner + 1 + c.replies.length, 0), 0);
  return {
    projects: planner.projects.length,
    tasks: planner.tasks.filter((task) => !task.parent).length,
    subtasks: planner.tasks.filter((task) => task.parent).length,
    comments,
    files: planner.tasks.reduce((sum, task) => sum + task.files.length + task.comments.reduce((inner, c) => inner + c.files.length + c.replies.reduce((r, x) => r + x.files.length, 0), 0), 0),
    perPerson: Object.fromEntries([...perPerson.entries()].map(([key, value]) => [`${key}`, value])),
    bossTotal: planner.tasks.filter((task) => task.assignees.includes("boss")).length,
    lastLocal: local(env.planEnd)
  };
};
