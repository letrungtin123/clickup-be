/**
 * Chat planner: channels, DMs and group DMs with members, settings and the authored scenes, scheduled as
 * real chat service calls (messages, threads, reactions, edits, deletes, files) on the timeline.
 */
import { randomUUID } from "node:crypto";

import { completeChatUpload, createChatUpload } from "../../src/modules/chat/attachments.service.js";
import {
  addChannelMembers,
  createChannel,
  joinChannel,
  openDirectConversation,
  setChannelArchived,
  updateChannel,
  updateChannelMember,
  updateMyMembership
} from "../../src/modules/chat/channels.service.js";
import { deleteMessage, editMessage, sendMessage, setReaction } from "../../src/modules/chat/messages.service.js";
import type { SeedEnv } from "./env.js";
import { allPersonaKeys } from "./env.js";
import { DAY, HOUR, MINUTE, Rng, at, hash } from "./time.js";
import { productionStaff, type ChannelKey, type ChatLine, type ChatScene, type GroupKey, type PersonaKey } from "./types.js";

/** Marks seeded chat messages (client message ids) so a reset can find them. */
export const seedClientIdPrefix = "5eed5eed";
const clientId = () => `${seedClientIdPrefix}${randomUUID().slice(8)}`;

type NotifyLevel = "all" | "mentions" | "none";

export type ConversationModel = {
  ref: string;
  kind: "public" | "private" | "dm" | "group_dm";
  name: string | null;
  description: string | null;
  topic: string | null;
  createdBy: PersonaKey;
  createdAt: number;
  initialMembers: PersonaKey[];
  /** Planned membership (grows when people join public channels). */
  members: Set<PersonaKey>;
  viewOnly: Set<PersonaKey>;
  admins: PersonaKey[];
  notify: Map<PersonaKey, NotifyLevel>;
  archivedAt: number | null;
  archivedBy: PersonaKey | null;
  id: string | null;
  messages: number;
};

const everyone = (env: SeedEnv, t: number) =>
  allPersonaKeys.filter((key) => env.has(key) && env.key(key) === key && env.active(key, t));

const groupMembers: Record<GroupKey, PersonaKey[]> = {
  "g-website": ["boss", "minh", "an", "linh"],
  "g-taichinh": ["boss", "linh", "admin", "acc1"],
  "g-khach-kho": ["acc1", "acc2", "lead1", "khoa"],
  "g-teambuilding": ["admin", "linh", "an", "nv02", "nv09"]
};

type LineModel = {
  conversation: ConversationModel;
  line: ChatLine;
  at: number;
  by: PersonaKey;
  root: LineModel | null;
  id: string | null;
};

export class ChatPlanner {
  readonly conversations = new Map<string, ConversationModel>();
  private readonly rng = new Rng(hash("chat"));

  constructor(
    private readonly env: SeedEnv,
    private readonly scenes: ChatScene[]
  ) {}

  private channelDefs(): ConversationModel[] {
    const env = this.env;
    const rng = this.rng;
    const staff = productionStaff.filter((key) => env.has(key)) as PersonaKey[];
    const k = (keys: PersonaKey[]) => [...new Set(keys.filter((key) => env.has(key)).map((key) => env.key(key)))];
    const def = (
      partial: Partial<ConversationModel> & Pick<ConversationModel, "ref" | "kind" | "name" | "createdBy" | "createdAt" | "initialMembers">
    ): ConversationModel => ({
      description: null,
      topic: null,
      viewOnly: new Set(),
      admins: [],
      notify: new Map(),
      archivedAt: null,
      archivedBy: null,
      id: null,
      messages: 0,
      ...partial,
      // The director is in every channel (private and archived ones included).
      members: new Set(k([partial.createdBy, "boss", ...partial.initialMembers]))
    });
    const rollout = "2026-08-25";
    const defs = [
      def({
        ref: "chung", kind: "public", name: "chung", createdBy: "admin", createdAt: at(rollout, 8, 32),
        description: "Kênh chung của cả công ty: trao đổi hằng ngày, hỏi nhanh, nhắc việc chung.",
        topic: "Giờ làm: T2–T6 8:00–17:30, T7 8:00–12:00 · Sản xuất theo ca",
        initialMembers: everyone(env, at(rollout, 9)), admins: ["linh", "boss"]
      }),
      def({
        ref: "thong-bao", kind: "public", name: "thong-bao", createdBy: "boss", createdAt: at(rollout, 8, 36),
        description: "Thông báo chính thức từ Ban giám đốc và Hành chính. Vui lòng trả lời trong thread.",
        topic: "Chỉ đăng thông báo · hỏi đáp trong thread",
        initialMembers: everyone(env, at(rollout, 9)), admins: ["linh", "admin"], viewOnly: new Set(k(["nv15"]))
      }),
      def({
        ref: "san-xuat", kind: "public", name: "san-xuat", createdBy: "linh", createdAt: at(rollout, 9, 5),
        description: "Điều phối sản xuất: phân job, bàn giao ca, deadline khách, đơn gấp.",
        topic: "Bàn giao ca trước 16:00 và 22:00 · đơn gấp gắn @trưởng ca",
        initialMembers: k(["boss", "khoa", "lead1", "lead2", "acc1", "acc2", ...staff, "loc"]), admins: ["lead1", "lead2"]
      }),
      def({
        ref: "it-ho-tro", kind: "public", name: "it-ho-tro", createdBy: "minh", createdAt: at(rollout, 10, 12),
        description: "Hỗ trợ IT: tài khoản, VPN, NAS, máy trạm, phần mềm, Nesso Work.",
        topic: "Báo lỗi kèm ảnh chụp màn hình + tên máy · khẩn gọi máy lẻ 105",
        initialMembers: k(["admin", "boss", "linh"]), admins: ["admin"]
      }),
      def({
        ref: "ban-dieu-hanh", kind: "private", name: "ban-dieu-hanh", createdBy: "boss", createdAt: at(rollout, 11, 3),
        description: "Ban điều hành: kế hoạch, nhân sự, tài chính, khách hàng lớn.",
        initialMembers: k(["linh", "admin", "acc1", "lead1"]), admins: ["linh"]
      }),
      def({
        ref: "qc-chat-luong", kind: "public", name: "qc-chat-luong", createdBy: "khoa", createdAt: at("2026-08-26", 8, 45),
        description: "Chất lượng: lỗi hay gặp, checklist QC, style guide khách, tỷ lệ fail theo tuần.",
        topic: "Checklist QC v1 · ảnh lỗi gửi kèm mã job",
        initialMembers: k(["boss", "linh", "lead1", "lead2", "acc1", ...staff]), admins: ["lead1"]
      }),
      def({
        ref: "marketing", kind: "public", name: "marketing", createdBy: "an", createdAt: at("2026-08-26", 9, 20),
        description: "Fanpage, portfolio before/after, quảng cáo, sự kiện và nhận diện thương hiệu.",
        topic: "Lịch đăng bài: T3–T5–T7 · duyệt nội dung trước 16:00",
        initialMembers: k(["boss", "linh", "minh", "acc1", "acc2", "hanh"]), admins: ["linh"]
      }),
      def({
        ref: "leader-san-xuat", kind: "private", name: "leader-san-xuat", createdBy: "linh", createdAt: at("2026-08-26", 13, 40),
        description: "Trưởng ca + QC + vận hành: năng lực, lịch ca, nhân sự, KPI.",
        initialMembers: k(["boss", "lead1", "lead2", "khoa"]), admins: ["lead1"]
      }),
      def({
        ref: "tan-gau", kind: "public", name: "tan-gau", createdBy: "an", createdAt: at("2026-08-27", 11, 50),
        description: "Ăn gì, uống gì, chơi gì. Không bàn công việc ở đây nhé 😄",
        topic: "Thứ 5 đá bóng 19:00 · thứ 6 trà sữa",
        initialMembers: everyone(env, at("2026-08-27", 12)).filter(() => rng.chance(0.75))
      }),
      def({
        ref: "team-building-thang-9", kind: "public", name: "team-building-thang-9", createdBy: "admin", createdAt: at("2026-09-01", 9, 10),
        description: "Chuẩn bị chuyến đi Vũng Tàu 26–27/9: đăng ký, xe, phòng, chương trình.",
        topic: "Hạn đăng ký: 18/9",
        initialMembers: k(["boss", "linh", "an", "nv02", "nv09", ...staff.filter(() => rng.chance(0.5))]),
        admins: ["linh"], archivedAt: at("2026-09-28", 10, 15), archivedBy: "admin"
      })
    ];
    // Notification preferences (Mọi tin nhắn / Chỉ khi nhắc tên / Tắt).
    const notify = (ref: string, key: PersonaKey, level: NotifyLevel) => defs.find((d) => d.ref === ref)?.notify.set(env.key(key), level);
    for (const ref of ["san-xuat", "qc-chat-luong", "tan-gau", "it-ho-tro"]) {
      notify(ref, "boss", "mentions");
    }
    notify("tan-gau", "linh", "mentions");
    notify("it-ho-tro", "linh", "mentions");
    notify("san-xuat", "admin", "none");
    notify("chung", "khoa", "mentions");
    for (const key of staff) {
      const roll = rng.next();
      if (roll < 0.25) notify("tan-gau", key, "none");
      else if (roll < 0.45) notify("tan-gau", key, "mentions");
      if (rng.chance(0.3)) notify("chung", key, "mentions");
      if (rng.chance(0.35)) notify("it-ho-tro", key, "mentions");
    }
    return defs;
  }

  private dm(a: PersonaKey, b: PersonaKey, t: number): ConversationModel {
    const env = this.env;
    const [x, y] = [env.key(a), env.key(b)];
    const ref = `dm:${[x, y].sort().join("+")}`;
    let conversation = this.conversations.get(ref);
    if (!conversation) {
      conversation = {
        ref, kind: "dm", name: null, description: null, topic: null, createdBy: x, createdAt: t - 30_000,
        initialMembers: [y], members: new Set([x, y]), viewOnly: new Set(), admins: [], notify: new Map(),
        archivedAt: null, archivedBy: null, id: null, messages: 0
      };
      this.conversations.set(ref, conversation);
    }
    return conversation;
  }

  private group(key: GroupKey, opener: PersonaKey, t: number): ConversationModel {
    const env = this.env;
    const ref = `group:${key}`;
    let conversation = this.conversations.get(ref);
    if (!conversation) {
      const members = [...new Set(groupMembers[key].filter((entry) => env.has(entry)).map((entry) => env.key(entry)))];
      const creator = members.includes(env.key(opener)) ? env.key(opener) : members[0]!;
      conversation = {
        ref, kind: "group_dm", name: null, description: null, topic: null, createdBy: creator, createdAt: t - 30_000,
        initialMembers: members.filter((entry) => entry !== creator), members: new Set(members), viewOnly: new Set(), admins: [],
        notify: new Map(), archivedAt: null, archivedBy: null, id: null, messages: 0
      };
      this.conversations.set(ref, conversation);
    }
    return conversation;
  }

  plan() {
    const env = this.env;
    const scenes = [...this.scenes].sort((a, b) => at(a.date, ...hm(a.time)) - at(b.date, ...hm(b.time)));
    for (const def of this.channelDefs()) {
      // A channel exists before its first conversation.
      const first = scenes.find((scene) => "channel" in scene.where && scene.where.channel === def.ref);
      if (first) {
        const firstAt = at(first.date, ...hm(first.time));
        if (firstAt - 10 * MINUTE < def.createdAt) {
          def.createdAt = Math.max(at("2026-08-25", 7, 45), firstAt - this.rng.int(12, 40) * MINUTE);
        }
      }
      this.conversations.set(def.ref, def);
    }
    const lines: LineModel[] = [];
    for (const scene of scenes) {
      const start = at(scene.date, ...hm(scene.time));
      if (start > env.planEnd) {
        continue;
      }
      const opener = scene.lines[0]?.by ?? "boss";
      const where = scene.where;
      const conversation =
        "channel" in where
          ? this.conversations.get(where.channel)!
          : "dm" in where
            ? this.dm(where.dm[0], where.dm[1], start)
            : this.group(where.group, opener, start);
      if (!conversation) {
        continue;
      }
      let cursor = start;
      let previous: PersonaKey | null = null;
      for (const line of scene.lines) {
        cursor += (line.gap ?? (previous === line.by ? this.rng.float(0.3, 1.2) : this.rng.float(1, 6))) * MINUTE;
        previous = line.by;
        const model = this.line(conversation, line, cursor, null);
        if (!model) {
          continue;
        }
        lines.push(model);
        let replyCursor = cursor;
        for (const reply of line.thread ?? []) {
          replyCursor += (reply.gap ?? this.rng.float(2, 18)) * MINUTE;
          const replyModel = this.line(conversation, reply, replyCursor, model);
          if (replyModel) {
            lines.push(replyModel);
          }
        }
      }
    }
    this.scheduleConversations();
    for (const model of lines) {
      this.scheduleLine(model);
    }
  }

  /** Validates a line against membership/time; public-channel speakers join first. */
  private line(conversation: ConversationModel, line: ChatLine, t: number, root: LineModel | null): LineModel | null {
    const env = this.env;
    if (t > env.planEnd || !env.has(line.by)) {
      return null;
    }
    const by = env.key(line.by);
    if (!env.active(by, t)) {
      env.count("chat.skipped.inactive_author");
      return null;
    }
    if ((conversation.archivedAt !== null && t >= conversation.archivedAt) || t < conversation.createdAt + MINUTE) {
      env.count(`chat.skipped.outside_channel_life.${conversation.ref}`);
      return null;
    }
    if (!conversation.members.has(by)) {
      if (conversation.kind !== "public") {
        env.count(`chat.skipped.not_member.${conversation.ref}`);
        return null;
      }
      conversation.members.add(by);
      env.schedule(t - 40_000, "chat.join", by, async () => {
        if (conversation.id) {
          await joinChannel(await env.ctx(by), conversation.id);
          env.count("chat.joins");
        }
      });
    }
    if (conversation.viewOnly.has(by)) {
      env.count("chat.skipped.view_only");
      return null;
    }
    if (!line.text && !(line.files && line.files.length > 0)) {
      return null;
    }
    return { conversation, line, at: t, by, root, id: null };
  }

  private canMention(conversation: ConversationModel) {
    return (key: PersonaKey) =>
      conversation.kind === "public" ? true : conversation.members.has(this.env.key(key));
  }

  private scheduleConversations() {
    const env = this.env;
    for (const conversation of this.conversations.values()) {
      if (conversation.kind === "dm" || conversation.kind === "group_dm") {
        const others = conversation.initialMembers.filter((key) => key !== conversation.createdBy);
        env.schedule(conversation.createdAt, "chat.dm", conversation.createdBy, async () => {
          const opened = await openDirectConversation(await env.ctx(conversation.createdBy), {
            userIds: others.map((key) => env.p(key).id)
          });
          conversation.id = opened.channel.id;
          env.count(conversation.kind === "dm" ? "dms" : "group_dms");
        });
        continue;
      }
      const creator = env.key(conversation.createdBy);
      const initial = [...conversation.members].filter((key) => key !== creator && env.active(key, conversation.createdAt));
      env.schedule(conversation.createdAt, "chat.channel", creator, async () => {
        const context = await env.ctx(creator);
        const created = await createChannel(context, {
          kind: conversation.kind as "public" | "private",
          name: conversation.name!,
          description: conversation.description,
          memberIds: initial.map((key) => env.p(key).id)
        });
        conversation.id = created.id;
        env.count("channels");
        if (conversation.topic) {
          await updateChannel(context, created.id, { topic: conversation.topic });
        }
      });
      const t = conversation.createdAt + 3 * MINUTE;
      for (const admin of conversation.admins) {
        const key = env.key(admin);
        if (key === creator || !conversation.members.has(key)) {
          continue;
        }
        env.schedule(t, "chat.admin", creator, async () => {
          if (conversation.id) {
            await updateChannelMember(await env.ctx(creator), conversation.id, env.p(key).id, { role: "admin" });
          }
        });
      }
      for (const key of conversation.viewOnly) {
        env.schedule(t + MINUTE, "chat.view_only", creator, async () => {
          if (conversation.id) {
            await updateChannelMember(await env.ctx(creator), conversation.id, env.p(key).id, { access: "view" });
            env.count("chat.view_only_members");
          }
        });
      }
      for (const [key, level] of conversation.notify) {
        const when = conversation.createdAt + this.rng.float(0.2, 6) * DAY;
        env.schedule(Math.min(when, env.planEnd - HOUR), "chat.notify", key, async () => {
          if (conversation.id && conversation.members.has(key)) {
            await updateMyMembership(await env.ctx(key), conversation.id, { notifyLevel: level }).catch((error: unknown) => {
              // Not (yet) a member: e.g. someone who only joins later.
              if (!(error instanceof Error && /member/i.test(error.message))) {
                throw error;
              }
            });
            env.count(`chat.notify.${level}`);
          }
        });
      }
      if (conversation.archivedAt !== null) {
        const by = env.key(conversation.archivedBy ?? creator);
        env.schedule(conversation.archivedAt, "chat.archive", by, async () => {
          if (conversation.id) {
            await setChannelArchived(await env.ctx(by), conversation.id, true);
            env.count("channels.archived");
          }
        });
      }
    }
    // One mid-period topic change in #san-xuat (system message) and back.
    const production = this.conversations.get("san-xuat");
    if (production) {
      const by = env.key("linh");
      env.schedule(at("2026-09-14", 7, 50), "chat.topic", by, async () => {
        if (production.id) {
          await updateChannel(await env.ctx(by), production.id, { topic: "Cao điểm 14–19/9: ưu tiên đơn Úc · ca đêm đến 23:30" });
        }
      });
      env.schedule(at("2026-09-21", 8, 5), "chat.topic", by, async () => {
        if (production.id) {
          await updateChannel(await env.ctx(by), production.id, { topic: production.topic });
        }
      });
    }
  }

  private scheduleLine(model: LineModel) {
    const env = this.env;
    const { conversation, line, by } = model;
    const rng = new Rng(hash(`${conversation.ref}:${model.at}:${line.text ?? ""}`));
    env.schedule(model.at, model.root ? "chat.reply" : "chat.message", by, async () => {
      if (!conversation.id || (model.root && !model.root.id)) {
        return;
      }
      const context = await env.ctx(by);
      const attachmentIds: string[] = [];
      for (const spec of line.files ?? []) {
        const file = await env.makeFile(spec);
        const ticket = await createChatUpload(context, conversation.id, { fileName: file.name, mimeType: file.mimeType, sizeBytes: file.bytes.length });
        await env.putFile(ticket.uploadUrl, file.bytes, file.mimeType);
        await completeChatUpload(context, ticket.attachmentId);
        attachmentIds.push(ticket.attachmentId);
        env.count("chat.files");
        env.count("files.bytes", file.bytes.length);
      }
      const { message } = await sendMessage(context, conversation.id, {
        body: env.doc(line.text ?? "", this.canMention(conversation), model.at),
        clientMessageId: clientId(),
        threadRootId: model.root?.id ?? null,
        attachmentIds
      });
      model.id = message.id;
      conversation.messages += 1;
      env.count(model.root ? "chat.replies" : "chat.messages");
    });
    for (const [emoji, people] of Object.entries(line.react ?? {})) {
      for (const raw of people) {
        if (!env.has(raw)) {
          continue;
        }
        const key = env.key(raw);
        const t = Math.min(model.at + rng.float(0.5, 95) * MINUTE, env.planEnd - 30_000);
        if (!conversation.members.has(key) || conversation.viewOnly.has(key) || !env.active(key, t) || t <= model.at) {
          continue;
        }
        if (conversation.archivedAt !== null && t >= conversation.archivedAt) {
          continue;
        }
        env.schedule(t, "chat.react", key, async () => {
          if (model.id) {
            await setReaction(await env.ctx(key), model.id, emoji, true);
            env.count("chat.reactions");
          }
        });
      }
    }
    if (line.edited) {
      const text = line.edited;
      const t = Math.min(model.at + rng.float(2, 25) * MINUTE, env.planEnd - 20_000);
      if (t > model.at && (conversation.archivedAt === null || t < conversation.archivedAt)) {
        env.schedule(t, "chat.edit", by, async () => {
          if (model.id) {
            await editMessage(await env.ctx(by), model.id, env.doc(text, this.canMention(conversation), t));
            env.count("chat.edited");
          }
        });
      }
    }
    if (line.deleted) {
      const t = Math.min(model.at + rng.float(1, 8) * MINUTE, env.planEnd - 10_000);
      if (t > model.at && (conversation.archivedAt === null || t < conversation.archivedAt)) {
        env.schedule(t, "chat.delete", by, async () => {
          if (model.id) {
            await deleteMessage(await env.ctx(by), model.id);
            env.count("chat.deleted");
          }
        });
      }
    }
  }
}

const hm = (time: string): [number, number] => {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return [h, m];
};

export { groupMembers };
export type { ChannelKey };
