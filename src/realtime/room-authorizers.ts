import type { RealtimeRoomType } from "../contracts/realtime.js";
import type { AccessContext } from "../modules/access/access-context.js";

/**
 * Resolves whether the caller may receive events for a room. Return "view" / "submit" when
 * allowed, or null when the resource is missing or not visible (never reveal which).
 */
export type RoomAccess = "view" | "submit" | null;
export type RoomAuthorizer = (context: AccessContext, resourceId: string) => Promise<RoomAccess>;

const authorizers = new Map<RealtimeRoomType, RoomAuthorizer>();

export const registerRoomAuthorizer = (type: RealtimeRoomType, authorizer: RoomAuthorizer) => {
  authorizers.set(type, authorizer);
};

export const authorizeRoom = async (
  context: AccessContext,
  type: RealtimeRoomType,
  resourceId: string
): Promise<RoomAccess> => {
  const authorizer = authorizers.get(type);
  if (!authorizer) {
    return null;
  }

  return await authorizer(context, resourceId);
};
