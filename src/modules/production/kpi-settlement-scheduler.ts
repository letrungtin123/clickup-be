import { getSql } from "../../db/client.js";
import { logger } from "../../lib/logger.js";
import { settleMonth, settlementLockKey } from "./kpi-settlement.service.js";
import { latestClosedPeriod, periodCloseInstant, shouldAutoSettle } from "./scoring.js";

const intervalMs = 60_000;
const defaultCloseDay = 25;

/**
 * SPEC §8.3: at 23:59 business time on settings.kpi_close_day, each organization's period that ends
 * that day is settled automatically (run_by = null). Checked every minute, so a worker that was down
 * at 23:59 catches up on its next start (within scoring.autoSettleCatchUpDays). A period is settled
 * automatically only once: any run finished at or after the close (automatic or by an Admin) counts.
 * One instance at a time per organization (transaction-scoped advisory lock shared with manual runs).
 */
export const runKpiSettlementTick = async (now = new Date()) => {
  const sql = getSql();
  const organizations = await sql<{ id: string; close_day: unknown }[]>`
    SELECT o.id, s.value AS close_day
    FROM public.organizations o
    LEFT JOIN production.settings s ON s.organization_id = o.id AND s.key = 'kpi_close_day'
    WHERE o.deleted_at IS NULL
  `;
  for (const organization of organizations) {
    const closeDay = typeof organization.close_day === "number" ? organization.close_day : defaultCloseDay;
    const period = latestClosedPeriod(now, closeDay);
    if (!shouldAutoSettle({ now, period, closeDay, hasFinalRun: false })) {
      continue;
    }
    const settled = await sql.begin(async (tx) => {
      const locked = await tx<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${settlementLockKey(organization.id)}, 0)) AS locked`;
      if (!locked[0]?.locked) {
        return null;
      }
      const final = await tx<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM production.kpi_settlement_runs
          WHERE organization_id = ${organization.id} AND period_month = ${`${period}-01`}::date
            AND finished_at >= ${periodCloseInstant(period, closeDay)}
        ) AS exists
      `;
      if (!shouldAutoSettle({ now, period, closeDay, hasFinalRun: final[0]!.exists })) {
        return null;
      }
      return await settleMonth(tx, organization.id, period, { trigger: "AUTO", runBy: null, reason: null });
    });
    if (settled) {
      logger.info({ organizationId: organization.id, period, users: settled.items.length, runId: settled.runId }, "KPI period settled");
    }
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
