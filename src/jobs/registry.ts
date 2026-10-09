import { startDeadlineScheduler } from "../modules/notifications/deadline-scheduler.js";
import { emailBindings, handleEmailEvent, startEmailDigestSweeper } from "../modules/notifications/notification-email.js";
import { handleNotificationEvent, notificationBindings } from "../modules/notifications/notification-handlers.js";
import { startKpiSettlementScheduler } from "../modules/production/kpi-settlement-scheduler.js";
import { startProductionLatenessScheduler } from "../modules/production/lateness-scheduler.js";
import { startConsumer } from "./consumer.js";
import { startMaintenanceScheduler } from "./maintenance-scheduler.js";

type Stop = () => Promise<void>;

/** Starts every durable consumer and scheduler owned by the worker. Modules add theirs here. */
export const startWorkerConsumers = async (): Promise<Stop> => {
  const stops: Stop[] = [];

  stops.push(
    await startConsumer({
      name: "nesso.notifications",
      bindings: notificationBindings,
      retryDelayMs: 15_000,
      prefetch: 20,
      maxAttempts: 5,
      handler: handleNotificationEvent
    })
  );
  // Notification e-mail digests (PD-013); idle until SMTP_HOST / SMTP_FROM are configured.
  stops.push(
    await startConsumer({
      name: "nesso.email",
      bindings: emailBindings,
      retryDelayMs: 60_000,
      prefetch: 5,
      maxAttempts: 5,
      handler: handleEmailEvent
    })
  );
  stops.push(startEmailDigestSweeper());
  stops.push(startDeadlineScheduler());
  stops.push(startMaintenanceScheduler());
  stops.push(startProductionLatenessScheduler());
  stops.push(startKpiSettlementScheduler());

  return async () => {
    await Promise.allSettled(stops.map((stop) => stop()));
  };
};
