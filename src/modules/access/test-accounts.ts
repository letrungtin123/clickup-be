import type { QuerySql, SqlFragment } from "../../lib/db-types.js";
import type { AccessContext } from "./access-context.js";

/**
 * PD-063 — temporary QA test accounts are invisible to real users.
 *
 * The lead's live QA scripts create short-lived accounts (public.app_users.is_test_account = true) plus the jobs and
 * chat channels they need, and delete them a minute or two later. A viewer who is not a test account never sees those
 * accounts — nor the jobs / channels they created — in any listing (people pickers, member lists, boards, calendars,
 * exports, job and channel lists). A test account sees everyone, test accounts included, so the scripts keep finding
 * each other. Detail endpoints are not filtered.
 */
export type TestAccountViewer = Pick<AccessContext, "isTestAccount">;

/** The viewer is a temporary QA test account (absent = a real account). */
export const viewerIsTestAccount = (viewer: TestAccountViewer) => viewer.isTestAccount === true;

/**
 * SQL predicate on a joined `public.app_users` row (its alias as a fragment, default `au`): the viewer may see that
 * person — `NOT au.is_test_account` for a real viewer, `TRUE` for a test viewer.
 */
export const visibleUserSql = (sql: QuerySql, viewer: TestAccountViewer, appUser: SqlFragment = sql`au`): SqlFragment =>
  viewerIsTestAccount(viewer) ? sql`TRUE` : sql`NOT ${appUser}.is_test_account`;

/**
 * SQL predicate on a user id expression without a joined `app_users` row (e.g. `j.created_by`): the viewer may see
 * what that user owns. A NULL id (creator removed) stays visible.
 */
export const visibleUserIdSql = (sql: QuerySql, viewer: TestAccountViewer, userId: SqlFragment): SqlFragment =>
  viewerIsTestAccount(viewer)
    ? sql`TRUE`
    : sql`NOT EXISTS (SELECT 1 FROM public.app_users test_au WHERE test_au.id = ${userId} AND test_au.is_test_account)`;
