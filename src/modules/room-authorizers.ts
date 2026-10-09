import { getSql } from "../db/client.js";
import { registerRoomAuthorizer } from "../realtime/room-authorizers.js";
import { getProjectAccessLevel, projectLevelAtLeast } from "./access/resource-access.js";
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
};
