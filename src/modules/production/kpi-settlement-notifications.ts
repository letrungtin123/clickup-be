import { getSql } from "../../db/client.js";
import type { DomainEventEnvelope, DomainEventInput } from "../events/outbox.js";
import { deliverNotifications } from "../notifications/notifications.service.js";

/**
 * KPI_SETTLED notifications (SPEC §8.2, PLAN §8): every settlement run queues one outbox event in its
 * transaction; the worker tells each settled person their result and sends every production ADMIN one
 * summary per run. A run superseded before delivery (its rows were replaced) notifies nobody.
 */

export const kpiSettledEvent = (organizationId: string, runId: string, period: string, actorUserId: string | null): DomainEventInput => ({
  organizationId,
  type: "production.kpi.settled",
  aggregateType: "production_kpi_run",
  aggregateId: runId,
  actorUserId,
  payload: { runId, period }
});

const periodLabel = (period: string) => `${period.slice(5, 7)}/${period.slice(0, 4)}`;
const points = (value: number) => value.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

type RunInfo = { period: string; user_count: number; met_count: number; not_met_count: number };
type SettledRow = {
  user_id: string;
  met: boolean;
  target_points: string | null;
  points_official: string;
  khoan_points_converted: string;
  khoan_money: string;
  total_points: string;
};

export const kpiSettlementNotificationHandlers: Record<string, (event: DomainEventEnvelope) => Promise<void>> = {
  "production.kpi.settled": async (envelope) => {
    const runId = typeof envelope.payload.runId === "string" ? envelope.payload.runId : null;
    if (!runId) {
      return;
    }
    const sql = getSql();
    const run = (
      await sql<RunInfo[]>`
        SELECT to_char(period_month, 'YYYY-MM') AS period, user_count, met_count, not_met_count
        FROM production.kpi_settlement_runs WHERE organization_id = ${envelope.organizationId} AND id = ${runId}
      `
    )[0];
    if (!run || run.user_count === 0) {
      return; // nothing settled → nothing to tell
    }
    const rows = await sql<SettledRow[]>`
      SELECT user_id, met, target_points::text AS target_points, points_official::text AS points_official,
        khoan_points_converted::text AS khoan_points_converted, khoan_money::text AS khoan_money, total_points::text AS total_points
      FROM production.kpi_settlements WHERE organization_id = ${envelope.organizationId} AND run_id = ${runId}
    `;
    if (rows.length === 0 && run.user_count > 0) {
      return; // superseded by a later run of the same period
    }
    const label = periodLabel(run.period);
    for (const row of rows) {
      const target = row.target_points === null ? null : Number(row.target_points);
      const total = Number(row.total_points);
      await deliverNotifications({
        organizationId: envelope.organizationId,
        recipientIds: [row.user_id],
        type: "production.kpi_settled",
        actorUserId: null,
        title: `Chốt KPI kỳ ${label}`,
        body: `${row.met ? "Đạt KPI" : "Chưa đạt KPI"}: ${points(total)}${target === null ? "" : ` / ${points(target)}`} điểm`,
        payload: {
          runId,
          period: run.period,
          points: total,
          target,
          percent: target && target > 0 ? Math.round((total / target) * 10_000) / 100 : null,
          met: row.met,
          pointsOfficial: Number(row.points_official),
          khoanPointsConverted: Number(row.khoan_points_converted),
          khoanMoney: Number(row.khoan_money)
        },
        dedupeKey: `kpi:${runId}:result`
      });
    }
    const admins = await sql<{ user_id: string }[]>`
      SELECT DISTINCT ur.user_id FROM production.user_roles ur
      JOIN public.organization_memberships om
        ON om.organization_id = ur.organization_id AND om.user_id = ur.user_id AND om.deleted_at IS NULL AND om.status = 'active'
      WHERE ur.organization_id = ${envelope.organizationId} AND ur.role_code = 'ADMIN'
    `;
    await deliverNotifications({
      organizationId: envelope.organizationId,
      recipientIds: admins.map((admin) => admin.user_id),
      type: "production.kpi_settled",
      actorUserId: null,
      title: `Đã chốt KPI kỳ ${label}`,
      body: `${run.met_count}/${run.user_count} người đạt KPI`,
      payload: { runId, period: run.period, summary: true, settled: run.user_count, met: run.met_count, notMet: run.not_met_count },
      dedupeKey: `kpi:${runId}:summary`
    });
  }
};
