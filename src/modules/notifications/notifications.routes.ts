import { Router, type Router as ExpressRouter } from "express";

import {
  ArchiveNotificationsRequestSchema,
  MarkNotificationsReadRequestSchema,
  NotificationPageSchema,
  NotificationQuerySchema,
  UnreadCountSchema
} from "../../contracts/notifications.js";
import { requireSupabaseUser } from "../../middleware/auth.js";
import { handle } from "../work/http.js";
import { archiveNotifications, getUnreadCount, listNotifications, markRead } from "./notifications.service.js";

export const createNotificationRoutes = (): ExpressRouter => {
  const routes = Router();
  routes.use("/notifications", requireSupabaseUser);

  routes.get(
    "/notifications",
    handle(async (context, req) => NotificationPageSchema.parse(await listNotifications(context, NotificationQuerySchema.parse(req.query))))
  );
  routes.get("/notifications/unread-count", handle(async (context) => UnreadCountSchema.parse(await getUnreadCount(context))));
  routes.post(
    "/notifications/read",
    handle(async (context, req) => UnreadCountSchema.parse(await markRead(context, MarkNotificationsReadRequestSchema.parse(req.body))))
  );
  routes.post(
    "/notifications/archive",
    handle(async (context, req) =>
      UnreadCountSchema.parse(await archiveNotifications(context, ArchiveNotificationsRequestSchema.parse(req.body).ids))
    )
  );

  return routes;
};
