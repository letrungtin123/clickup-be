type Stop = () => Promise<void>;

/** Starts every durable consumer owned by the worker. Modules add their consumers here. */
export const startWorkerConsumers = (): Promise<Stop> => {
  const stops: Stop[] = [];

  return Promise.resolve(async () => {
    await Promise.allSettled(stops.map((stop) => stop()));
  });
};
