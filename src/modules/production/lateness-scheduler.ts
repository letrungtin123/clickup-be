import { getSql } from "../../db/client.js";
import { logger } from "../../lib/logger.js";
import { notifyDeadline } from "./notifications.js";
import { markDueSoonTasks, markLateTasks } from "./tasks.service.js";

const intervalMs = 15 * 60 * 1000;

/**
 * SPEC Phase 2 §2 + PLAN §8: every 15 minutes, open production tasks past their deadline are flagged
 * late, and the worker + job leader are told once per task and deadline (late, and "còn N giờ").
 * One worker instance at a time (transaction-scoped advisory lock); the tasks are marked notified in the
 * same short transaction and the notifications are written after it commits (deduplicated as well).
 */
export const runLatenessScan = async () => {
  const scan = await getSql().begin(async (sql) => {
    const locked = await sql<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended('production:lateness', 0)) AS locked`;
    return locked[0]?.locked ? { late: await markLateTasks(sql), dueSoon: await markDueSoonTasks(sql) } : null;
  });
  if (!scan) {
    return;
  }
  await notifyDeadline("production.task_late", scan.late);
  await notifyDeadline("production.task_due_soon", scan.dueSoon);
  if (scan.late.length > 0) {
    logger.info({ notified: scan.late.length }, "Production tasks notified late");
  }
};

export const startProductionLatenessScheduler = () => {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = () => {
    if (stopped) {
      return;
    }
    runLatenessScan()
      .catch((error: unknown) => logger.error({ err: error }, "Production lateness scan failed"))
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(tick, intervalMs);
        }
      });
  };
  timer = setTimeout(tick, 30_000);
  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
    return Promise.resolve();
  };
};
