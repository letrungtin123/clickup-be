import { getSql } from "../db/client.js";
import { registerRoomAuthorizer } from "../realtime/room-authorizers.js";
import { getProjectAccessLevel, projectLevelAtLeast } from "./access/resource-access.js";
import { authorizeChannelRoom } from "./chat/chat-access.js";
import { getSpaceAccess } from "./knowledge/access.js";
import { levelAtLeast } from "./knowledge/rules.js";
import { hasAnyProductionRole } from "./production/access.js";
import { authorizeTask } from "./work/tasks.service.js";

/** Wires each realtime room type to the module that owns its authorization rules. */
export const registerRoomAuthorizers = () => {
  registerRoomAuthorizer("project", async (context, projectId) => {
    const level = await getProjectAccessLevel(context, projectId);
    if (!level) {
      return null;
    }
    return projectLevelAtLeast(level, "submit") ? "submit" : "view";
  });

  registerRoomAuthorizer("task", async (context, taskId) => {
    try {
      const { access } = await authorizeTask(getSql(), context, taskId, "view");
      return projectLevelAtLeast(access.level, "submit") ? "submit" : "view";
    } catch {
      return null;
    }
  });

  registerRoomAuthorizer("channel", authorizeChannelRoom);

  // Knowledge spaces: members, and readers of public spaces (PD-031). Archived / deleted spaces have no room.
  registerRoomAuthorizer("knowledge", async (context, spaceId) => {
    const access = await getSpaceAccess(getSql(), context, spaceId);
    if (!access) {
      return null;
    }
    return levelAtLeast(access.level, "submit") ? "submit" : "view";
  });

  registerRoomAuthorizer("production", (context, organizationId) =>
    Promise.resolve(organizationId === context.organization.id && hasAnyProductionRole(context) ? "view" : null)
  );
};
