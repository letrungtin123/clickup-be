import { registerRoomAuthorizer } from "../realtime/room-authorizers.js";
import { getProjectAccessLevel, projectLevelAtLeast } from "./access/resource-access.js";

/** Wires each realtime room type to the module that owns its authorization rules. */
export const registerRoomAuthorizers = () => {
  registerRoomAuthorizer("project", async (context, projectId) => {
    const level = await getProjectAccessLevel(context, projectId);
    if (!level) {
      return null;
    }
    return projectLevelAtLeast(level, "submit") ? "submit" : "view";
  });
};
