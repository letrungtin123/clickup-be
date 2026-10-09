export const Permission = {
  ProjectView: "project.view",
  ProjectCreate: "project.create",
  ProjectUpdate: "project.update",
  ProjectDelete: "project.delete",
  ProjectManageMembers: "project.manage_members",

  ListView: "list.view",
  ListCreate: "list.create",
  ListUpdate: "list.update",
  ListDelete: "list.delete",
  ListManageStatus: "list.manage_status",

  TaskView: "task.view",
  TaskCreate: "task.create",
  TaskUpdate: "task.update",
  TaskDelete: "task.delete",
  TaskAssign: "task.assign",
  TaskComment: "task.comment",

  StatusView: "status.view",
  StatusCreate: "status.create",
  StatusUpdate: "status.update",
  StatusDelete: "status.delete",

  ChannelView: "channel.view",
  ChannelCreate: "channel.create",
  ChannelUpdate: "channel.update",
  ChannelDelete: "channel.delete",
  ChannelManageMembers: "channel.manage_members",

  KnowledgeView: "knowledge.view",
  KnowledgeCreate: "knowledge.create",
  KnowledgeUpdate: "knowledge.update",
  KnowledgeDelete: "knowledge.delete",
  KnowledgeManageMembers: "knowledge.manage_members",

  RoleView: "role.view",
  RoleCreate: "role.create",
  RoleUpdate: "role.update",
  RoleDelete: "role.delete",
  RoleAssignPermission: "role.assign_permission",

  MemberView: "member.view",
  MemberManage: "member.manage"
} as const;

export const permissionValues = Object.values(Permission);

export type PermissionKey = (typeof Permission)[keyof typeof Permission];

export const superAdminPermissionKeys = permissionValues;
