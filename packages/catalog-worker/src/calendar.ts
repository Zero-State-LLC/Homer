import { calendarPage, calendarStyle } from "./calendar-ui.js";
import { openEventLedger, replayEffectiveHistory } from "@zs-home/event-ledger";
import { projectActivityCalendar, type CalendarOptions } from "@zs-home/projections";
import type { EventLedgerObject } from "@zs-home/event-ledger/worker";
import { adminHeaders } from "./admin-headers.js";
/** The calendar reads the Event Ledger through the environment's ledger binding. */
export interface CalendarBindings {
  EVENT_LEDGER?: DurableObjectNamespace<EventLedgerObject>;
}
export const calendarPaths = new Set([
  "/v1/calendar",
  "/v1/workspace/calendar",
  "/v1/workspace/calendar.css",
]);
export interface CalendarFilters extends CalendarOptions {
  day?: string;
}
function parseFilters(url: URL): CalendarFilters {
  const allowed = ["timeZone", "bucket", "actorId", "actorKind", "projectId", "day"];
  for (const key of url.searchParams.keys())
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
      throw new Error("invalid");
  const get = (key: string) => url.searchParams.get(key) || undefined;
  const filters: CalendarFilters = {
    timeZone: get("timeZone") ?? "America/Los_Angeles",
    bucket: (get("bucket") ?? "day") as CalendarOptions["bucket"],
  };
  new Intl.DateTimeFormat("en", { timeZone: filters.timeZone });
  if (!["day", "week", "month"].includes(filters.bucket)) throw new Error("invalid");
  for (const key of ["actorId", "projectId"] as const) {
    const value = get(key);
    if (value && !(key === "actorId" ? /^actor:[a-z0-9-]+$/ : /^project:[a-z0-9-]+$/).test(value))
      throw new Error("invalid");
    if (value) filters[key] = value;
  }
  const kind = get("actorKind");
  if (kind && !["human", "agent", "system", "unknown", "unattributed"].includes(kind))
    throw new Error("invalid");
  if (kind) filters.actorKind = kind as NonNullable<CalendarOptions["actorKind"]>;
  const day = get("day");
  if (day) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(Date.parse(day)) ||
      new Date(day).toISOString().slice(0, 10) !== day
    )
      throw new Error("invalid");
    filters.day = day;
  }
  return filters;
}
export async function calendarResponse(url: URL, env: CalendarBindings): Promise<Response> {
  if (url.pathname.endsWith(".css")) return calendarStyle();
  const html = url.pathname === "/v1/workspace/calendar";
  const failure = (
    error: string,
    status: number,
    filters: CalendarFilters = { timeZone: "America/Los_Angeles", bucket: "day" },
  ) =>
    html
      ? calendarPage(filters, undefined, error, status)
      : new Response(JSON.stringify({ error }), {
          status,
          headers: adminHeaders("application/json"),
        });
  let filters: CalendarFilters;
  try {
    filters = parseFilters(url);
  } catch {
    return failure("invalid_calendar_filters", 400);
  }
  try {
    if (!env.EVENT_LEDGER) throw new Error("unavailable");
    const ledger = openEventLedger(env.EVENT_LEDGER);
    const head = await ledger.head();
    if (head && (!Number.isSafeInteger(head.sequence) || head.sequence < 1))
      throw new Error("invalid head");
    // Bound the complete prefix, never silently truncate before applying Corrections.
    if (head && head.sequence > 2000) return failure("calendar_history_too_large", 413, filters);
    let events = replayEffectiveHistory(
      await ledger.readHistory({ throughSequence: head?.sequence ?? 0 }),
      head ?? undefined,
    );
    if (filters.day)
      events =
        projectActivityCalendar(events, { ...filters, bucket: "day" }).find(
          (group) => group.key === filters.day,
        )?.events ?? [];
    const buckets = projectActivityCalendar(events, filters);
    const observedEvents = buckets.reduce((count, group) => count + group.events.length, 0);
    if (html) return calendarPage(filters, { buckets, observedEvents, head });
    return new Response(
      JSON.stringify({
        state: observedEvents ? "ready" : "empty",
        head,
        filters,
        observedEvents,
        buckets,
      }),
      { headers: adminHeaders("application/json") },
    );
  } catch {
    return failure("calendar_unavailable", 503, filters);
  }
}
