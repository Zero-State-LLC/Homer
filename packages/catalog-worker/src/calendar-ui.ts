import type { CalendarBucket } from "@zs-home/projections";
import type { TrustedHead } from "@zs-home/event-ledger";
import type { ActivityEvent } from "@zs-home/shared-contracts";
import type { CalendarFilters } from "./calendar.js";
import { adminHeaders } from "./admin-headers.js";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
function link(url: string, label: string): string {
  try {
    if (["http:", "https:"].includes(new URL(url).protocol))
      return `<a href="${escape(url)}" rel="noreferrer">${escape(label)}</a>`;
  } catch {
    /* Invalid source URLs remain text. */
  }
  return escape(label);
}
function activity(event: ActivityEvent, timeZone: string): string {
  const p = event.provenance;
  return `<article><h3>${escape(event.subject)}</h3><p>${event.actor.actorId ? `${escape(event.actor.actorId)} · ${escape(event.actor.actorKind ?? "unknown")}` : "Unattributed"} · Source account: ${escape(event.actor.sourceAccount)}</p><p>Project: ${escape(event.projectId ?? "Unmapped")}</p><p><time datetime="${escape(event.occurredAt)}">${escape(new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "long" }).format(new Date(event.occurredAt)))}</time><br>UTC: ${escape(event.occurredAt)}</p><p>Kind: ${escape(event.kind)}${event.kind.startsWith("work_session.") ? " · Work Session declaration, not proof of performed work." : ""}</p><p>Event Key: ${escape(event.eventKey)}</p><details><summary>Evidence and Provenance</summary><p>${link(p.sourceUrl, "Source link")} · ${escape(p.sourceSystem)} · Source object: ${escape(p.sourceObjectId)}</p><p>Collector: ${escape(p.collector)} ${escape(p.collectorVersion)} · Collected at: ${escape(p.collectedAt)}</p>${(event.evidence ?? []).map((e) => `<p>${link(e.url, e.label)}</p>`).join("")}${event.evidence?.length ? "" : "<p>No additional evidence supplied.</p>"}</details></article>`;
}
export function calendarPage(
  filters: CalendarFilters,
  data?: { buckets: CalendarBucket[]; observedEvents: number; head: TrustedHead | null },
  error?: string,
  status = 200,
): Response {
  const headers = adminHeaders();
  headers.set(
    "Content-Security-Policy",
    headers.get("Content-Security-Policy")!.replace("form-action 'none'", "form-action 'self'"),
  );
  const input = (
    name: "timeZone" | "day" | "actorId" | "projectId",
    label: string,
    type = "text",
  ) =>
    `<label>${label}<input name="${name}" type="${type}" value="${escape(filters[name] ?? "")}"></label>`;
  const select = (name: "bucket" | "actorKind", label: string, values: string[]) =>
    `<div class="field"><label for="calendar-${name}">${label}</label><select id="calendar-${name}" name="${name}">${values.map((value) => `<option value="${value}"${(filters[name] ?? "") === value ? " selected" : ""}>${value || "All"}</option>`).join("")}</select></div>`;
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activity Calendar | Homer</title><link rel="stylesheet" href="/v1/workspace/calendar.css"></head><body><main><header><p>Homer · Workspace</p><nav aria-label="Workspace"><a href="/v1/workspace/calendar">Activity Calendar</a> · <a href="/v1/workspace/fleet">Fleet status</a> · <a href="/v1/workspace/my-setup">My setup</a></nav><h1>Activity Calendar</h1><p>Who did what, when, on which Project, with what evidence.</p></header><form method="get" action="/v1/workspace/calendar"><fieldset><legend>Calendar filters</legend><div class="filters">${input("timeZone", "Display Time Zone")}${select("bucket", "Bucket", ["day", "week", "month"])}${input("day", "Day", "date")}${input("actorId", "Actor ID")}${select("actorKind", "Actor kind", ["", "human", "agent", "system", "unknown", "unattributed"])}${input("projectId", "Project ID")}</div><button type="submit">Apply filters</button> <a href="/v1/workspace/calendar">Clear filters</a></fieldset></form><p>Counts are observed Activity Events, not hours or productivity scores. Coverage depends on configured Collectors and does not represent all work. Work Sessions are declarations, not proof of performed work. Agents and Accountable Humans are distinct; no Accountable Human is inferred.</p><p>Source Freshness: Unknown. Collection checkpoints are not available in this view.</p>${error ? `<section role="alert"><h2>Calendar unavailable</h2><p>${escape(error)}</p></section>` : `<p role="status">${data!.observedEvents} observed Activity Events</p><p>Verified Event Ledger prefix: ${data!.head?.sequence ?? 0}${data!.head ? ` · ${escape(data!.head.entryDigest)}` : ""}</p>${data!.buckets.length ? data!.buckets.map((b) => `<section aria-label="${escape(b.key)}"><h2>${escape(b.key)}</h2>${b.events.map((e) => activity(e, filters.timeZone)).join("")}</section>`).join("") : "<h2>No observed Activity Events</h2><p>No events match these filters in the verified Event Ledger prefix.</p>"}`}</main></body></html>`,
    { status, headers },
  );
}
export function calendarStyle(): Response {
  return new Response(
    `:root{color-scheme:light dark;font:17px/1.6 system-ui,sans-serif}body{margin:0;background:#101a25;color:#eef3fa}main{max-width:1100px;margin:auto;padding:clamp(1rem,4vw,3rem)}a{color:#9dd9ff}fieldset,article{min-width:0;border:1px solid #536b82;border-radius:12px;padding:1rem;margin:1rem 0}article{background:#162638;overflow-wrap:anywhere}h1{font-size:clamp(2rem,6vw,3.5rem);line-height:1.1}h2{color:#b4dfed}.filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}label,.field{display:flex;flex-direction:column}input,select,button{font:inherit;min-height:44px;padding:.45rem;box-sizing:border-box;max-width:100%;border:1px solid #93a8bb;border-radius:5px}button{margin-top:1rem;background:#b4dfed;color:#102332;cursor:pointer}a:focus-visible,input:focus-visible,select:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #ffd477;outline-offset:3px}summary{cursor:pointer;min-height:44px}p{overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap;gap:.6rem}@media(max-width:650px){.filters{grid-template-columns:1fr}}`,
    { headers: adminHeaders("text/css") },
  );
}
