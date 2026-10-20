import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { logger } from "../../lib/logger.js";
import { closeDaysOf, loadSettings } from "./catalog.service.js";
import { settleMonth, settlementLockKey } from "./kpi-settlement.service.js";
import { latestClosedPeriod, periodCloseInstant, shouldAutoSettle } from "./scoring.js";

const intervalMs = 60_000;
/** PD-066: a period held up by missing KPI targets is retried every tick but logged at most once an hour. */
const blockedLogIntervalMs = 3_600_000;
const blockedLoggedAt = new Map<string, number>();

/** Settles the organization's latest closed period when it is due (see runKpiSettlementTick). */
const settleOrganization = async (organizationId: string, now: Date) => {
  const sql = getSql();
  const closeDay = closeDaysOf(await loadSettings(sql, organizationId));
  const period = latestClosedPeriod(now, closeDay);
  if (!shouldAutoSettle({ now, period, closeDay, hasFinalRun: false })) {
    return;
  }
  try {
    const settled = await sql.begin(async (tx) => {
      const locked = await tx<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${settlementLockKey(organizationId)}, 0)) AS locked`;
      if (!locked[0]?.locked) {
        return null;
      }
      const final = await tx<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM production.kpi_settlement_runs
          WHERE organization_id = ${organizationId} AND period_month = ${`${period}-01`}::date
            AND finished_at >= ${periodCloseInstant(period, closeDay)}
        ) AS exists
      `;
      if (!shouldAutoSettle({ now, period, closeDay, hasFinalRun: final[0]!.exists })) {
        return null;
      }
      return await settleMonth(tx, organizationId, period, { trigger: "AUTO", runBy: null, reason: null });
    });
    if (settled) {
      blockedLoggedAt.delete(`${organizationId}:${period}`);
      logger.info({ organizationId, period, users: settled.items.length, runId: settled.runId }, "KPI period settled");
    }
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "KPI_TARGETS_MISSING") {
      throw error;
    }
    // PD-066: nothing was written; tried again on the next tick (until the catch-up window ends).
    const key = `${organizationId}:${period}`;
    const last = blockedLoggedAt.get(key);
    if (last === undefined || now.getTime() - last >= blockedLogIntervalMs) {
      blockedLoggedAt.set(key, now.getTime());
      const users = error.details?.users;
      logger.warn(
        { organizationId, period, missing: Array.isArray(users) ? users.length : null },
        "KPI period not settled: some members have no KPI target"
      );
    }
  }
};

/**
 * SPEC §8.3: at 23:59 business time on the period's close day (close-day versions, G15), each organization's period that ends
 * that day is settled automatically (run_by = null). Close day 31 "Cuối tháng" (PD-032) closes on the month's last day
 * (28/29 February, 30 April…): scoring.periodCloseInstant clamps it. The run uses the Khoán rule TOP_UP (PD-066) and
 * records it. Checked every minute, so a worker that was down
 * at 23:59 catches up on its next start (within scoring.autoSettleCatchUpDays). A period is settled
 * automatically only once: any run finished at or after the close (automatic or by an Admin) counts.
 * One instance at a time per organization (transaction-scoped advisory lock shared with manual runs).
 * PD-066: while someone who must have a KPI has none for the period, the run is refused (KPI_TARGETS_MISSING, nothing
 * written): the tick logs a warning (at most hourly) and tries again until the catch-up window ends; the other
 * organizations are not held up.
 */
export const runKpiSettlementTick = async (now = new Date()) => {
  const sql = getSql();
  const organizations = await sql<{ id: string }[]>`SELECT o.id FROM public.organizations o WHERE o.deleted_at IS NULL`;
  for (const organization of organizations) {
    await settleOrganization(organization.id, now);
  }
};

export const startKpiSettlementScheduler = () => {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = () => {
    if (stopped) {
      return;
    }
    runKpiSettlementTick()
      .catch((error: unknown) => logger.error({ err: error }, "KPI settlement tick failed"))
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(tick, intervalMs);
        }
      });
  };
  timer = setTimeout(tick, 20_000);
  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
    return Promise.resolve();
  };
};
