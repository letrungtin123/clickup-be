import { startDeadlineScheduler } from "../modules/notifications/deadline-scheduler.js";
import { handleNotificationEvent, notificationBindings } from "../modules/notifications/notification-handlers.js";
import { startConsumer } from "./consumer.js";

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
  stops.push(startDeadlineScheduler());

  return async () => {
    await Promise.allSettled(stops.map((stop) => stop()));
  };
};
